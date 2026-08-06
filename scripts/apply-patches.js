// 幂等应用 electron-auto-launch 补丁：
// 原逻辑在 x64 系统写入 HKLM\...\Run（需要管理员权限，普通用户 enable 失败），
// 补丁改为写入 HKCU\...\Run（无需提权）。
// 与 patches/electron-auto-launch+5.0.7.patch 内容一致，npm ci 后可自动恢复。
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'electron-auto-launch', 'dist', 'AutoLaunchWindows.js');

if (!fs.existsSync(target)) {
  console.log('[apply-patches] electron-auto-launch 未安装，跳过');
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');

if (source.includes('hive: Winreg.HKCU')) {
  console.log('[apply-patches] electron-auto-launch 补丁已应用，跳过');
  process.exit(0);
}

const oldHive = "  hive: process.arch === 'x64' ? Winreg.HKLM : Winreg.HKCU,";
const newHive = '  hive: Winreg.HKCU,';
const oldKey = "  key: process.arch === 'x64' ? '\\\\Software\\\\Wow6432Node\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run' : '\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run'";
const newKey = "  key: '\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run'";

if (!source.includes(oldHive) || !source.includes(oldKey)) {
  console.warn('[apply-patches] electron-auto-launch 补丁匹配失败，请手动检查 node_modules/electron-auto-launch/dist/AutoLaunchWindows.js');
  process.exit(1);
}

const patched = source.replace(oldHive, newHive).replace(oldKey, newKey);
fs.writeFileSync(target, patched, 'utf8');
console.log('[apply-patches] electron-auto-launch 补丁已应用');
