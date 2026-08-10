# build-native.ps1 - 重新编译原生模块（icon_extractor.node）
# 处理两个环境兼容问题：
#   1. 本机仅安装 Windows SDK 10.0.16299，node-gyp 默认生成 10.0.26100.0 项目
#   2. node-addon-api 的 nothing.gyp 未指定 SDK 版本
# 该脚本幂等，可在 npm install 之后安全运行。

$ErrorActionPreference = 'Stop'
$sdkVer = '10.0.16299.0'

Write-Host "==> Building native module (icon_extractor.node)..."

# 1. node-addon-api: 确保 nothing target 使用本机 SDK 版本
$nodeApiGyp = Join-Path $PSScriptRoot 'node_modules\node-addon-api\node_api.gyp'
if (Test-Path $nodeApiGyp) {
  $gyp = Get-Content $nodeApiGyp -Raw
  if ($gyp -notmatch 'msvs_windows_target_platform_version') {
    Write-Host '==> Patching node-addon-api/node_api.gyp with Windows SDK version...'
    $patched = $gyp -replace "( 'type': 'static_library',)", @"
`$1
      'configurations': {
        'Debug': { 'msvs_windows_target_platform_version': '$sdkVer' },
        'Release': { 'msvs_windows_target_platform_version': '$sdkVer' }
      }
"@
    Set-Content -LiteralPath $nodeApiGyp -Value $patched -Encoding UTF8
  }
}

# 2. 清理旧的 vcxproj（可能残留错误 SDK 版本），强制重新生成
Get-ChildItem (Join-Path $PSScriptRoot 'build') -Filter '*.vcxproj' -Recurse -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# 3. 编译
Push-Location $PSScriptRoot
try {
  & npm run rebuild-native
  if ($LASTEXITCODE -ne 0) {
    Write-Error "node-gyp rebuild failed with exit code $LASTEXITCODE"
  }
  Write-Host '==> Native module built successfully.'
} finally {
  Pop-Location
}

# 4. 准备性能监控所需的三方库（LibreHardwareMonitorLib + HidSharp，MPL-2.0）
#    用于读取真实风扇转速/温度，随应用打包到 native/hardware/（electron-builder extraResources）。
Write-Host "==> Preparing hardware monitor libraries (LibreHardwareMonitorLib)..."
$hwDir = Join-Path $PSScriptRoot 'native\hardware'
New-Item -ItemType Directory -Force -Path $hwDir | Out-Null
$pkgTmp = Join-Path $env:TEMP 'dih-nuget'
New-Item -ItemType Directory -Force -Path $pkgTmp | Out-Null

function Get-NugetLib {
  param([string]$PkgName, [string]$Version, [string]$DllName, [string]$TargetLib)
  $zip = Join-Path $pkgTmp "$PkgName.$Version.zip"
  $dir = Join-Path $pkgTmp "$PkgName.$Version"
  try {
    if (-not (Test-Path $zip)) {
      Invoke-WebRequest "https://www.nuget.org/api/v2/package/$PkgName/$Version" -OutFile $zip -UseBasicParsing
    }
    if (-not (Test-Path $dir)) {
      Expand-Archive $zip $dir -Force
    }
    $src = Join-Path $dir $TargetLib
    if (Test-Path $src) {
      Copy-Item $src (Join-Path $hwDir $DllName) -Force
      Write-Host "    + $DllName"
    } else {
      Write-Warning "    - 未找到 $TargetLib（$PkgName）"
    }
  } catch {
    Write-Warning "    - 下载/解压 $PkgName 失败: $($_.Exception.Message)"
  }
}

Get-NugetLib 'LibreHardwareMonitorLib' '0.9.4' 'LibreHardwareMonitorLib.dll' 'lib\net472\LibreHardwareMonitorLib.dll'
Get-NugetLib 'HidSharp' '2.1.0' 'HidSharp.dll' 'lib\net35\HidSharp.dll'

# 采样脚本一并放入资源目录（打包后 PowerShell 只能读取真实文件，不能读取 asar 内文件）
Copy-Item (Join-Path $PSScriptRoot 'src\main\hardware-sampler.ps1') (Join-Path $hwDir 'hardware-sampler.ps1') -Force
Write-Host '==> Hardware monitor libraries ready.'

# 5. better-sqlite3（agent 监控组件读 opencode.db 用）
& (Join-Path $PSScriptRoot 'scripts\rebuild-better-sqlite3.ps1')
