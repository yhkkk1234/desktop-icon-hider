# hardware-sampler.ps1 - resident hardware sampling process
# Spawned by the main process. Every 5s prints one line `DATA: {json}` to stdout.
# Data sources:
#   1. Windows performance counters (Get-Counter): CPU / GPU engine / VRAM usage
#   2. LibreHardwareMonitorLib (3rd-party, MPL-2.0, https://github.com/LibreHardwareMonitor/LibreHardwareMonitor):
#      real fan RPM and temperatures. DLL dir comes from env DIH_HW_LHM_DIR.
#      Falls back gracefully when unavailable (hw=false).
# NOTE: Reading motherboard sensors usually requires administrator rights. Under
#       normal privileges only some sensors (e.g. GPU fan/temp) are readable.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$outPrefix = 'DATA: '
$sampleIntervalSec = 5

function Write-Data($obj) {
  try {
    $json = $obj | ConvertTo-Json -Compress -Depth 4
    [Console]::Out.WriteLine($outPrefix + $json)
  } catch {
    [Console]::Out.WriteLine($outPrefix + '{}')
  }
}

# ---------- LibreHardwareMonitor init (best effort) ----------
$lhmDir = $env:DIH_HW_LHM_DIR
$lhmComputer = $null
$lhmReady = $false

if ($lhmDir -and (Test-Path (Join-Path $lhmDir 'LibreHardwareMonitorLib.dll'))) {
  try {
    Add-Type -Path (Join-Path $lhmDir 'LibreHardwareMonitorLib.dll')
    $lhmComputer = New-Object LibreHardwareMonitor.Hardware.Computer
    $lhmComputer.IsCpuEnabled = $true
    $lhmComputer.IsGpuEnabled = $true
    $lhmComputer.IsMotherboardEnabled = $true
    $lhmComputer.IsMemoryEnabled = $true
    $lhmComputer.Open()
    $lhmReady = $true
  } catch {
    $lhmReady = $false
  }
}

# Collect LHM sensors (fan / temperature / GPU memory)
function Get-LhmSensors {
  $fans = @()
  $temps = @()
  $gpuMemUsed = $null
  $gpuMemTotal = $null
  $gpuLoad = $null

  if (-not $lhmReady -or -not $lhmComputer) {
    return @{ fans = $fans; temps = $temps; gpuMemUsed = $gpuMemUsed; gpuMemTotal = $gpuMemTotal; gpuLoad = $gpuLoad }
  }

  foreach ($hw in $lhmComputer.Hardware) {
    $hw.Update()
    foreach ($sensor in $hw.Sensors) {
      $value = $null
      try { $value = $sensor.Value } catch { }
      if ($null -eq $value) { continue }
      try {
        if ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Fan -and $value -gt 0) {
          $fans += [pscustomobject]@{ n = $sensor.Name; r = [int][math]::Round($value) }
        } elseif ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Temperature) {
          $temps += [pscustomobject]@{ n = $sensor.Name; c = [int][math]::Round($value) }
        } elseif ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Data) {
          # 仅认 GPU 显存数据传感器（此前任何名字含 Memory 的传感器都被误当显存）
          if ($sensor.Name -match '^GPU Memory') {
            $valMB = [int][math]::Round($value / 1MB)
            if ($sensor.Name -match 'Total') {
              $gpuMemTotal = $valMB
            } elseif ($sensor.Name -match 'Used|Usage') {
              $gpuMemUsed = $valMB
            }
          }
        } elseif ($sensor.SensorType -eq [LibreHardwareMonitor.Hardware.SensorType]::Load -and $sensor.Name -match 'GPU') {
          $gpuLoad = [int][math]::Round($value)
        }
      } catch { }
    }
  }

  # Prefer CPU fan, then GPU fan (foreach to avoid hashtable pipeline unwrapping)
  if ($fans.Count -gt 0) {
    $cpuFan = $null
    $gpuFan = $null
    foreach ($f in $fans) {
      if ($f.n -match 'CPU' -and ($null -eq $cpuFan -or $f.r -gt $cpuFan.r)) { $cpuFan = $f }
      if ($f.n -match 'GPU' -and ($null -eq $gpuFan -or $f.r -gt $gpuFan.r)) { $gpuFan = $f }
    }
    $fans = @()
    if ($cpuFan) { $fans += $cpuFan }
    if ($gpuFan -and -not ($cpuFan -and $cpuFan.n -eq $gpuFan.n)) { $fans += $gpuFan }
  }

  return @{ fans = $fans; temps = $temps; gpuMemUsed = $gpuMemUsed; gpuMemTotal = $gpuMemTotal; gpuLoad = $gpuLoad }
}

# ---------- Static info (queried once) ----------
$gpuNameCache = $null
function Get-GpuName {
  if ($null -ne $script:gpuNameCache) { return $script:gpuNameCache }
  try {
    $vc = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($vc -and $vc.Name) { $script:gpuNameCache = [string]$vc.Name }
  } catch { }
  if (-not $script:gpuNameCache) { $script:gpuNameCache = '' }
  return $script:gpuNameCache
}

# ---------- Combined counter sampling (grouped Get-Counter calls) ----------
# Returns a hashtable with cpu / mem / gpu / vramUsed. Counters are grouped by
# availability domain so a missing counter family does not wipe the others:
#   group A (always present): CPU utility + committed memory
#   group B (WDDM GPU counters): GPU engine + adapter memory - absent on RDP/VM
# Each Get-Counter call waits its default 1s sample interval.
$cpuPrevRaw = $null
function Get-CpuSmooth {
  param([double]$raw)
  $usage = $null
  if ($null -ne $script:cpuPrevRaw) {
    $usage = [math]::Round((0.6 * $raw + 0.4 * $script:cpuPrevRaw), 1)
  }
  $script:cpuPrevRaw = $raw
  if ($null -eq $usage) { $usage = [math]::Round($raw, 1) }
  return $usage
}

function Get-OneCounterGroup {
  param([string[]]$Paths)
  try {
    return @(Get-Counter -Counter $Paths -ErrorAction Stop).CounterSamples
  } catch {
    return @()
  }
}

function Get-CombinedCounters {
  $result = @{ cpu = $null; mem = $null; gpu = $null; vramUsed = $null }

  # Group A: CPU + memory (all environments)
  foreach ($s in (Get-OneCounterGroup @(
      '\Processor Information(_Total)\% Processor Utility',
      '\Memory\% Committed Bytes In Use'
    ))) {
    $path = [string]$s.Path
    if ($path -match 'Processor Information') {
      $result.cpu = Get-CpuSmooth -raw $s.CookedValue
    } elseif ($path -match 'Memory') {
      $result.mem = [math]::Round($s.CookedValue, 1)
    }
  }

  # Group B: GPU engine + adapter memory (WDDM only; missing on RDP/VM -> degrade alone)
  $gpuSamples = @(Get-OneCounterGroup @(
      '\GPU Engine(*)\Utilization Percentage',
      '\GPU Adapter Memory(*)\Dedicated Usage'
    ))

  $byLuid = @{}
  $vramByLuid = @{}
  foreach ($s in $gpuSamples) {
    $path = [string]$s.Path
    $parts = $s.InstanceName -split '_'
    $luidIdx = [array]::IndexOf($parts, 'luid')
    $luid = ''
    # LUID = luid + HighPart + LowPart (two hex segments). Previously only the
    # HighPart was kept: dual-GPU machines (both HighPart=0) were merged into one
    # bucket, mixing the two adapters' data.
    if ($luidIdx -ge 0 -and ($luidIdx + 2) -lt $parts.Length) {
      $luid = ($parts[($luidIdx)..($luidIdx + 2)]) -join '_'
    }
    if ($path -match 'GPU Engine') {
      if ($s.CookedValue -gt 0 -and $luid) {
        if (-not $byLuid.ContainsKey($luid)) { $byLuid[$luid] = 0.0 }
        if ($s.CookedValue -gt $byLuid[$luid]) { $byLuid[$luid] = $s.CookedValue }
      }
    } elseif ($path -match 'GPU Adapter Memory') {
      $val = [int][math]::Round($s.CookedValue / 1MB)
      if ($val -gt 0 -and $luid) {
        if (-not $vramByLuid.ContainsKey($luid)) { $vramByLuid[$luid] = 0 }
        if ($val -gt $vramByLuid[$luid]) { $vramByLuid[$luid] = $val }
      }
    }
  }
  if ($byLuid.Count -gt 0) {
    # Busiest GPU load; VRAM also taken from that adapter (matched by max-load
    # LUID, not the first adapter in enumeration order).
    $busiestLuid = ''
    $busiestVal = -1.0
    foreach ($k in $byLuid.Keys) {
      if ($byLuid[$k] -gt $busiestVal) { $busiestVal = $byLuid[$k]; $busiestLuid = $k }
    }
    $result.gpu = [int][math]::Round($busiestVal)
    if ($vramByLuid.ContainsKey($busiestLuid)) { $result.vramUsed = $vramByLuid[$busiestLuid] }
  }
  if ($null -eq $result.vramUsed -and $vramByLuid.Count -gt 0) {
    $maxVal = 0
    foreach ($item in $vramByLuid.Values) { if ($item -gt $maxVal) { $maxVal = $item } }
    $result.vramUsed = $maxVal
  }
  return $result
}

# ---------- Main loop ----------
$script:gpuName = Get-GpuName

while ($true) {
  $row = @{
    ts = [int][DateTimeOffset]::Now.ToUnixTimeSeconds()
    hw = $lhmReady
    gpuName = $script:gpuName
  }

  $ctr = Get-CombinedCounters
  $row.cpu = $ctr.cpu
  $row.mem = $ctr.mem
  $row.gpu = $ctr.gpu
  $row.vramUsed = $ctr.vramUsed
  $row.vramTotal = $null

  $lhm = Get-LhmSensors
  $row.fans = $lhm.fans
  $row.temps = $lhm.temps
  if ($null -eq $row.gpu -and $null -ne $lhm.gpuLoad) { $row.gpu = $lhm.gpuLoad }
  if ($null -eq $row.vramUsed -and $null -ne $lhm.gpuMemUsed) { $row.vramUsed = $lhm.gpuMemUsed }
  if ($null -eq $row.vramTotal -and $null -ne $lhm.gpuMemTotal) { $row.vramTotal = $lhm.gpuMemTotal }

  # VRAM total fallback: Win32_VideoController.AdapterRAM (may be inaccurate > 4GB)
  # Cached: vramTotal is a static hardware property, query it only once (-1 = queried,
  # no usable value). Avoids an expensive WMI Get-CimInstance every round (was a major
  # CPU cost of this sampler process). NOTE: keep this file pure ASCII - PS 5.1 parses
  # no-BOM files as ANSI/GBK and UTF-8 CJK comments break the script.
  if ($null -eq $row.vramTotal -and $null -eq $script:vramTotalCache) {
    $script:vramTotalCache = -1
    try {
      $vc = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($vc -and $vc.AdapterRAM -gt 0) {
        $script:vramTotalCache = [int][math]::Round([double]$vc.AdapterRAM / 1MB)
      }
    } catch { }
  }
  if ($null -eq $row.vramTotal -and $script:vramTotalCache -gt 0) {
    $row.vramTotal = $script:vramTotalCache
  }

  Write-Data $row
  Start-Sleep -Seconds $sampleIntervalSec
}
