// native-build.js - 取代 npm 对根包 binding.gyp 的隐式 `node-gyp rebuild`
//
// 为什么需要这个脚本：仓库根有 binding.gyp，npm 因此会在 install 阶段自动跑一次
// `node-gyp rebuild`。而 node-gyp 默认生成的工程目标 Windows SDK 版本是它内置的版本
// （实测 10.0.26100），未必等于本机装了的那个；binding.gyp 用 win_sdk_version 变量
// 指定目标版本，但写死任何值都会在另一半机器上以 MSB8036 失败
// （作者本机只装了 10.0.16299，GitHub runner 上只有新版）。
// 所以这里探测本机已装的最高版本 SDK，再通过 GYP_DEFINES 传给 node-gyp。
//
// 失败时不阻断 npm install：没有原生模块时应用会降级为 emoji 图标
// （见 src/main/desktop-api.js 的兜底），只是想跑起来的人不该因为缺编译器就连依赖都装不上。
// 发布打包走 build-native.ps1，那条路径是显式失败，不会静默漏掉原生模块。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SDK_INCLUDE_DIR = 'C:\\Program Files (x86)\\Windows Kits\\10\\Include';

/** 本机已安装的 Windows SDK 版本，按版本号从高到低 */
function installedSdkVersions() {
  try {
    return fs.readdirSync(SDK_INCLUDE_DIR)
      .filter((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i];
        }
        return 0;
      });
  } catch (e) {
    return [];
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[native-build] 非 Windows 平台，跳过原生模块编译');
    return;
  }
  if (!fs.existsSync(path.join(ROOT, 'binding.gyp'))) return;

  const nodeGyp = path.join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
  if (!fs.existsSync(nodeGyp)) {
    console.log('[native-build] 未安装 node-gyp（可能用了 --omit=dev），跳过原生模块编译');
    return;
  }

  const sdkVersions = installedSdkVersions();
  const chosen = sdkVersions[0];
  const env = { ...process.env };
  if (chosen) {
    env.GYP_DEFINES = `${env.GYP_DEFINES ? env.GYP_DEFINES + ' ' : ''}win_sdk_version=${chosen}`;
  }
  console.log(`[native-build] 探测到 Windows SDK: ${sdkVersions.length ? sdkVersions.join(', ') : '（无）'}`);
  if (chosen) console.log(`[native-build] 使用 SDK ${chosen} 编译 icon_extractor（可用 GYP_DEFINES 覆盖）`);

  const r = spawnSync(process.execPath, [nodeGyp, 'rebuild'], { cwd: ROOT, stdio: 'inherit', env });
  if (r.status === 0) {
    console.log('[native-build] 原生模块 icon_extractor 编译完成');
    return;
  }

  console.warn('');
  console.warn('[native-build] 原生模块编译失败。应用仍可启动，但桌面图标会退化为 emoji 占位。');
  console.warn('  排查方向：');
  console.warn('    1) 需要 Visual Studio Build Tools + Windows SDK（见 README「系统要求」）');
  console.warn(`    2) 本机探测到的 SDK：${sdkVersions.length ? sdkVersions.join(', ') : '无'}`);
  console.warn('       若与实际不符，可手动指定版本后重试：');
  console.warn('       PowerShell:  $env:GYP_DEFINES=\'win_sdk_version=<版本>\'; npm run rebuild-native');
  console.warn('    3) 只想先跑起来：npm install --ignore-scripts');
  console.warn('');
}

try {
  main();
} catch (e) {
  console.warn('[native-build] 跳过原生模块编译：', e.message);
}
