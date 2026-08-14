// perf-benchmark.js - 桌面图标隐藏应用核心路径性能基准
// 运行：node scripts/perf-benchmark.js
// 覆盖：原生图标提取（单/批量）、icon-cache 序列化、desktop-api 批量提取、
//       agent 监控轮询 SQL（3.3GB opencode.db，node:sqlite 直读）、快照推送序列化
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const nativePath = path.join(ROOT, 'build', 'Release', 'icon_extractor.node');

const results = [];
function record(name, ms, note = '') {
  results.push({ name, ms: Math.round(ms * 100) / 100, note });
  console.log(`${name.padEnd(52)} ${ms.toFixed(2).padStart(9)} ms  ${note}`);
}
function bench(name, fn, iterations = 1) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  record(`${name} (avg of ${iterations})`, avg, `min=${times[0].toFixed(2)} max=${times[times.length - 1].toFixed(2)}`);
  return { avg, min: times[0], max: times[times.length - 1] };
}

// ============ 1. 原生模块加载 ============
let iconExtractor = null;
{
  const t0 = Date.now();
  iconExtractor = require(nativePath);
  record('native module load', Date.now() - t0);
}

// ============ 2. 测试文件集：真实桌面 + 系统路径 ============
const desktop = path.join(os.homedir(), 'Desktop');
let desktopFiles = [];
try { desktopFiles = fs.readdirSync(desktop).map(f => path.join(desktop, f)); } catch (e) { /* 忽略 */ }
const sysFiles = [
  'C:\\Windows\\System32\\notepad.exe',
  'C:\\Windows\\System32\\cmd.exe',
  'C:\\Windows\\System32\\calc.exe',
  'C:\\Windows\\explorer.exe',
  'C:\\Windows\\System32\\shell32.dll',
  'C:\\Windows\\System32\\mspaint.exe',
  'C:\\Windows\\System32\\taskmgr.exe',
  'C:\\Windows\\System32\\regedit.exe',
  'C:\\Windows\\System32\\write.exe',
  'C:\\Windows\\System32\\snippingtool.exe',
  'C:\\Windows\\System32\\powershell.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
];
const allFiles = [...desktopFiles.slice(0, 60), ...sysFiles];
console.log(`\n== 测试文件集: 桌面 ${desktopFiles.length} 项 + 系统 ${sysFiles.length} 项`);

// ============ 3. 单图标提取（冷） ============
if (iconExtractor && sysFiles.length) {
  // 预热（首次调用含 GDI+ 初始化）
  iconExtractor.extractIcon(sysFiles[0]);
  const r = bench('extractIcon 单文件（冷）', () => iconExtractor.extractIcon(sysFiles[0]), 10);
  const iconLen = (iconExtractor.extractIcon(sysFiles[0]) || '').length;
  record('单图标 base64 数据大小', iconLen / 10, `${Math.round(iconLen / 1024)} KB (注: 值为数据大小字节/10 仅用于展示)`);
}

// ============ 4. 批量图标提取 ============
if (iconExtractor) {
  // 预热
  iconExtractor.extractIconsBatch(allFiles.slice(0, 8));
  bench('extractIconsBatch 8 个', () => iconExtractor.extractIconsBatch(allFiles.slice(0, 8)), 5);
  bench('extractIconsBatch 20 个', () => iconExtractor.extractIconsBatch(allFiles.slice(0, 20)), 3);
  bench('extractIconsBatch 60 个（桌面满载）', () => iconExtractor.extractIconsBatch(allFiles.slice(0, 60)), 2);
}

// ============ 5. 全屏检测 ============
if (iconExtractor && typeof iconExtractor.isFullscreenAppForeground === 'function') {
  iconExtractor.isFullscreenAppForeground();
  bench('isFullscreenAppForeground', () => iconExtractor.isFullscreenAppForeground(''), 50);
}

// ============ 6. icon-cache JSON 序列化/解析 ============
{
  // 模拟 200 个图标的缓存（每个 ~20KB base64）
  const fake = {};
  for (let i = 0; i < 200; i++) fake[`C:\\fake\\icon-${i}.exe`] = 'data:image/png;base64,' + 'A'.repeat(20000);
  const json = JSON.stringify(fake);
  record('icon-cache 序列化 (200 图标)', bench('', () => JSON.stringify(fake), 20).avg, `${Math.round(json.length / 1024)} KB`);
  record('icon-cache 解析 (200 图标)', bench('', () => JSON.parse(json), 20).avg);
  record('icon-cache 写盘 200 图标', bench('', () => { const f = path.join(os.tmpdir(), `dih-cache-${Date.now()}.json`); fs.writeFileSync(f, json); fs.unlinkSync(f); }, 5).avg);
}

// ============ 7. desktop-api 批量路径（含缓存命中） ============
{
  const api = require(path.join(ROOT, 'src', 'main', 'desktop-api.js'));
  const fakeFiles = Array.from({ length: 30 }, (_, i) => ({ path: `C:\\fake\\file-${i}.exe`, isDirectory: false }));
  (async () => {
    // 冷路径：缓存为空 → 原生提取失败（fake 路径）→ emoji 回退
    const t0 = Date.now();
    await api.getFileIcons(fakeFiles);
    record('desktop-api getFileIcons 30 个（缓存空/回退）', Date.now() - t0);
    // 热路径：全部命中缓存
    const t1 = Date.now();
    await api.getFileIcons(fakeFiles);
    record('desktop-api getFileIcons 30 个（缓存命中）', Date.now() - t1);
    api.clearIconCache();
    summarize();
  })();
}

// ============ 8. agent 监控轮询 SQL（3.3GB opencode.db） ============
{
  const dbCandidates = [
    path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  ];
  const dbPath = dbCandidates.find(p => fs.existsSync(p));
  if (!dbPath) {
    console.log('\n== 未找到 opencode.db，跳过 agent 轮询基准 ==');
    return;
  }
  console.log(`\n== opencode.db: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });

    // 与 agent-monitor.js 完全相同的三条语句
    const stmtSession = db.prepare(
      `SELECT s.id, s.title, s.directory, s.agent, s.time_created, s.time_updated
       FROM session s
       WHERE s.time_archived IS NULL
       ORDER BY s.time_updated DESC
       LIMIT ?`
    );
    const ph = new Array(100).fill('?').join(',');
    const stmtBatchPart = db.prepare(
      `SELECT p.session_id AS sid, p.data AS data
       FROM part p
       JOIN (SELECT session_id, MAX(time_created) AS mt FROM part
             WHERE session_id IN (${ph}) GROUP BY session_id) m
         ON p.session_id = m.session_id AND p.time_created = m.mt`
    );
    const stmtSinglePart = db.prepare(
      'SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 1'
    );

    // 冷启动首轮：session + 批量 last-part（一次全表扫描，仅启动时一次）
    const t0 = Date.now();
    const rows = stmtSession.all(100);
    const ids = rows.map(r => r.id);
    const batchRows = stmtBatchPart.all(...ids);
    record('首轮轮询（session + 批量 last-part 全表扫）', Date.now() - t0, `${rows.length} 会话 / ${batchRows.length} part`);

    // 稳态轮询：无变化会话 → 只有 session 查询（lastPartCache 全命中）
    let total = 0;
    const N = 10;
    for (let i = 0; i < N; i++) {
      const t1 = Date.now();
      stmtSession.all(100);
      total += Date.now() - t1;
    }
    record(`稳态轮询（缓存命中, avg of ${N}）`, total / N);

    // 增量路径：1 个变化会话 → 单条 last part 查询
    const t2 = Date.now();
    const id0 = ids[0];
    for (let i = 0; i < 5; i++) stmtSinglePart.get(id0);
    record('增量 last-part 查询（1 会话）', (Date.now() - t2) / 5);

    // 快照签名计算（模拟 onUpdate 推送前开销）
    const t3 = Date.now();
    const sig = JSON.stringify(rows.map(r => ({ id: r.id, t: r.time_updated })));
    record('快照签名序列化', Date.now() - t3, `${sig.length} 字节`);
    db.close();
  } catch (e) {
    console.log('   node:sqlite 不可用或查询失败:', e.message);
  }
}

function summarize() {
  console.log('\n==================== 汇总 ====================');
  const slow = results.filter(r => r.ms > 100);
  if (slow.length) {
    console.log('⚠ 超过 100ms 的路径:');
    for (const r of slow) console.log(`   ${r.name}: ${r.ms} ms`);
  } else {
    console.log('✅ 所有路径均在 100ms 内');
  }
}
