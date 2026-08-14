# app-perf.ps1 - Packaged app performance test: startup / memory / CPU / CDP renderer metrics
# Usage: powershell -ExecutionPolicy Bypass -File scripts\app-perf.ps1
$ErrorActionPreference = 'Stop'

$exe = Join-Path $PSScriptRoot '..\dist\win-unpacked\Desktop Icon Hider.exe'
$perfUserData = Join-Path $env:TEMP 'dih-perf-userdata'
$debugPort = 9333

if (-not (Test-Path $exe)) { Write-Error "exe not found: $exe" }

# Clean leftover test userdata
if (Test-Path $perfUserData) { Remove-Item $perfUserData -Recurse -Force -ErrorAction SilentlyContinue }

# Kill any existing instance (single-instance lock would interfere)
$existing = Get-Process -Name 'Desktop Icon Hider' -ErrorAction SilentlyContinue
if ($existing) {
  Write-Warning "Existing instance running (PID $($existing.Id -join ', ')), stopping it"
  $existing | Stop-Process -Force
  Start-Sleep -Seconds 1
}

$t0 = Get-Date
$p = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$debugPort", "--user-data-dir=$perfUserData" -PassThru
Write-Host "started pid=$($p.Id) at $($t0.ToString('HH:mm:ss.fff'))"

# --- 1. Startup time: poll until main window appears ---
$tWindow = $null
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  $p.Refresh()
  if ($p.HasExited) { Write-Error "app exited early (code $($p.ExitCode))" }
  if ($p.MainWindowHandle -ne 0) { $tWindow = Get-Date; break }
  Start-Sleep -Milliseconds 100
}
if (-not $tWindow) { Write-Error 'Main window did not appear within 30s' }

# Wait for CDP page target (renderer ready)
$cdpReady = $false
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$debugPort/json/list" -UseBasicParsing -TimeoutSec 2
    if ($r.Content -match 'webSocketDebuggerUrl') { $cdpReady = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 200
}
if (-not $cdpReady) { Write-Warning 'CDP page not ready, skipping renderer metrics' }

$startupMs = [int]($tWindow - $t0).TotalMilliseconds
Write-Host "window appeared: $startupMs ms"

# Settle for 5s (icon render + cache load)
Start-Sleep -Seconds 5

# --- 2. Memory & CPU (main process) ---
$p.Refresh()
$mem1 = $p.WorkingSet64 / 1MB
$priv1 = $p.PrivateMemorySize64 / 1MB
$cpu1 = $p.TotalProcessorTime.TotalMilliseconds
$cpuWall1 = (Get-Date)

Start-Sleep -Seconds 8

$p.Refresh()
$mem2 = $p.WorkingSet64 / 1MB
$priv2 = $p.PrivateMemorySize64 / 1MB
$cpu2 = $p.TotalProcessorTime.TotalMilliseconds
$cpuWall2 = (Get-Date)
$cores = (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors
$cpuPct = ($cpu2 - $cpu1) / ($cpuWall2 - $cpuWall1).TotalMilliseconds / $cores * 100
$memPeak = ($p.PeakWorkingSet64 / 1MB)

# Child processes (renderer / gpu / utility) memory
$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.Id)" -ErrorAction SilentlyContinue
$childMem = 0
$childList = @()
foreach ($c in $children) {
  try {
    $cp = Get-Process -Id $c.ProcessId -ErrorAction Stop
    $childMem += $cp.WorkingSet64 / 1MB
    $childList += "$($c.Name):$([int]($cp.WorkingSet64/1MB))MB"
  } catch { }
}

# --- 3. Renderer CDP metrics ---
$cdpOut = @{}
if ($cdpReady) {
  $outFile = Join-Path $env:TEMP 'dih-cdp.json'
  node (Join-Path $PSScriptRoot 'app-cdp-measure.js') --port $debugPort *> $outFile
  if (Test-Path $outFile) {
    try { $cdpOut = Get-Content $outFile -Raw | ConvertFrom-Json } catch { Write-Warning "CDP output parse failed: $_" }
  }
}

# --- 4. Wait for graceful exit (CDP quitApp already triggered) ---
$null = $p.WaitForExit(15000)
if (-not $p.HasExited) {
  Write-Warning 'App did not exit within 15s, force killing (desktop icons may remain hidden)'
  Stop-Process -Id $p.Id -Force
  Start-Sleep -Seconds 2
}

# --- 5. Verify desktop icons restored ---
$desktopOk = & (Join-Path $PSScriptRoot 'check-desktop-icons.ps1')

# --- 6. Output ---
$result = [ordered]@{
  startupToWindowMs      = $startupMs
  steadyWorkingSetMB     = [math]::Round($mem2, 1)
  steadyPrivateMB        = [math]::Round($priv2, 1)
  peakWorkingSetMB       = [math]::Round($memPeak, 1)
  cpuPctAllCores         = [math]::Round($cpuPct, 2)
  childProcessesMB       = [math]::Round($childMem, 1)
  childProcesses         = $childList -join '; '
  desktopIconsRestored   = $desktopOk
  cdp                    = $cdpOut
}
$result | ConvertTo-Json -Depth 5

# Cleanup temp userdata
Remove-Item $perfUserData -Recurse -Force -ErrorAction SilentlyContinue
