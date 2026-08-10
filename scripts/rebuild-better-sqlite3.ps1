# rebuild-better-sqlite3.ps1 - 为 Electron 编译 better-sqlite3（只读查询 opencode.db 用）
# 为什么不用 electron-rebuild：
#   本机仅安装 Windows SDK 10.0.16299，而 node-gyp 检测到 VS2026 后会生成
#   WindowsTargetPlatformVersion=10.0.26100.0 的 vcxproj（注册表残留 SDK 信息），
#   MSBuild 编译必然失败（MSB8036）。这里用 msbuild 参数覆盖 SDK 版本绕过。
# 幂等：better-sqlite3 未安装时静默跳过。

$ErrorActionPreference = 'Stop'
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bsDir = Join-Path $PSScriptRoot '..\node_modules\better-sqlite3'
$sdkVer = '10.0.16299.0'

if (-not (Test-Path (Join-Path $bsDir 'binding.gyp'))) {
  Write-Host '==> better-sqlite3 未安装，跳过。'
  exit 0
}

Write-Host '==> Building better-sqlite3 for Electron...'

# 1. 获取 Electron 版本，node-gyp configure 时下载对应头文件
$electronVersion = node -e "const path=require('path');console.log(require(path.join(process.argv[1], '..', 'node_modules', 'electron', 'package.json')).version)" $PSScriptRoot 2>$null
if (-not $electronVersion) {
  Write-Error '无法读取 Electron 版本'
}
Write-Host "    Electron version: $electronVersion"

# 2. 清理旧构建产物，避免残留 vcxproj
Remove-Item -Recurse -Force (Join-Path $bsDir 'build') -ErrorAction SilentlyContinue

# 3. configure：生成带 Electron 头文件的 vcxproj（SDK 版本是错的 26100，稍后覆盖）
Push-Location $bsDir
try {
  & node-gyp configure --target=$electronVersion --arch=x64 --dist-url=https://electronjs.org/headers
  if ($LASTEXITCODE -ne 0) {
    Write-Error "node-gyp configure failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

# 4. MSBuild 编译，用参数覆盖 SDK 版本
$msbuild = Get-ChildItem 'F:\Program Files (x86)\Microsoft Visual Studio\*\BuildTools\MSBuild\Current\Bin\MSBuild.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $msbuild) {
  $msbuild = Get-ChildItem 'F:\Program Files\Microsoft Visual Studio\*\*\MSBuild\Current\Bin\MSBuild.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $msbuild) {
  $msbuild = Get-ChildItem 'C:\Program Files (x86)\Microsoft Visual Studio\*\BuildTools\MSBuild\Current\Bin\MSBuild.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $msbuild) {
  $msbuild = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio\*\*\MSBuild\Current\Bin\MSBuild.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $msbuild) {
  Write-Error '未找到 MSBuild.exe'
}

& $msbuild.FullName (Join-Path $bsDir 'build\binding.sln') `
  /p:Configuration=Release /p:Platform=x64 `
  /p:WindowsTargetPlatformVersion=$sdkVer `
  /clp:Verbosity=minimal /nologo /nodeReuse:false
if ($LASTEXITCODE -ne 0) {
  Write-Error "MSBuild failed with exit code $LASTEXITCODE"
}

$nodeFile = Join-Path $bsDir 'build\Release\better_sqlite3.node'
if (-not (Test-Path $nodeFile)) {
  Write-Error '编译产物 better_sqlite3.node 不存在'
}
Write-Host '==> better-sqlite3 built successfully.'
