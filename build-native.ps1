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
