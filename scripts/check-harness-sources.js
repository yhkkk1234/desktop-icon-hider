// check-harness-sources.js - harness 数据源体检（升级 harness 后跑一次）
//
// 背景：本组件的每个 harness 适配器都读对方私有的落盘格式（投影缓存 JSON、
// 转录文件名、SQLite schema），对方升级即可让适配器静默失效——典型症状是
// "组件还在、列表却冻在升级当天"。本脚本把"适配器依赖了哪些格式假设"逐条
// 打印出来，让升级后的第一次排查不用再读一遍 harness 源码。
//
// 用法：node scripts/check-harness-sources.js
// 退出码：0 = 全部正常；1 = 有需要人工确认的漂移
const fs = require('fs');
const path = require('path');

const {
  DSH_TESTED_CACHE_VERSION,
  createAntigravityAdapter,
  createClaudeAdapter,
  createCodexAdapter,
  createDshAdapter,
  createOpencodeAdapter,
  createZcodeAdapter,
  getDshHomePath
} = require('../src/main/agent-monitor');

const problems = [];

/** 打印一条体检结果；level = 'ok' | 'warn' | 'fail' */
function report(level, label, detail) {
  const mark = level === 'ok' ? '  OK  ' : level === 'warn' ? ' WARN ' : ' FAIL ';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  if (level !== 'ok') problems.push(`${label}${detail ? ' — ' + detail : ''}`);
}

/** 安全列举目录；失败 → 空数组 */
function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
}

/** 文件 mtime（ms）；不可得 → null */
function mtimeOf(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (e) {
    return null;
  }
}

/** 人类可读时间 */
function when(ms) {
  return ms === null || ms === undefined ? '未知' : new Date(ms).toISOString();
}

// ============ dsh：逐条验收适配器依赖的格式假设 ============
// 假设清单（改动 agent-monitor.js 的 dsh 适配器时同步更新这里）：
// 1. 投影缓存新布局目录 storages/session_projcache/sessions/<id>.json 存在
// 2. 该目录内记录的 version ≤ DSH_TESTED_CACHE_VERSION（domain spec 版本）
// 3. 记录结构仍是 {version, record:{identity, rows}}
// 4. 转录文件名匹配 session[.v<N>].jsonl[.zstd]
// 5. 适配器能列出会话，且最新活动时间不落后于最新转录（否则缓存没覆盖全）
function checkDsh() {
  console.log('\n=== dsh（DeepSeek Harness）===');
  const home = getDshHomePath();
  console.log(`数据目录: ${home}${fs.existsSync(home) ? '' : '（不存在 → 视为未安装）'}`);

  const cacheRoot = path.join(home, 'storages', 'session_projcache');
  const perRecordDir = path.join(cacheRoot, 'sessions');
  const legacyFile = path.join(home, 'storages', 'session_projcache.json');

  // 假设 1 + 2 + 3：投影缓存
  const cacheFiles = readdirSafe(perRecordDir).filter(e => e.name.endsWith('.json'));
  const legacyMtime = mtimeOf(legacyFile);
  if (cacheFiles.length > 0) {
    report('ok', '投影缓存（新布局 per-record）', `${cacheFiles.length} 条记录，目录 ${when(mtimeOf(perRecordDir))}`);
    const versions = new Map();
    let malformed = 0;
    for (const f of cacheFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(perRecordDir, f.name), 'utf8'));
        versions.set(data.version, (versions.get(data.version) || 0) + 1);
        if (!data.record || !data.record.identity || !data.record.rows) malformed++;
      } catch (e) {
        malformed++;
      }
    }
    console.log(`        domain 版本分布: ${[...versions].map(([v, n]) => `v${v}×${n}`).join(', ') || '无'}`);
    const maxVer = Math.max(0, ...[...versions.keys()].map(Number).filter(Number.isFinite));
    if (maxVer > DSH_TESTED_CACHE_VERSION) {
      report('fail', 'domain 版本高于已适配版本',
        `磁盘 v${maxVer} > 适配 v${DSH_TESTED_CACHE_VERSION}：布局/字段可能已变，请对照 dsh-session-projection-cache 的 spec`);
    } else {
      report('ok', 'domain 版本在已适配范围', `磁盘 v${maxVer} ≤ 适配 v${DSH_TESTED_CACHE_VERSION}`);
    }
    report(malformed === 0 ? 'ok' : 'warn', '记录结构 {version, record:{identity, rows}}',
      malformed === 0 ? '全部解析通过' : `${malformed} 条解析失败/结构变化`);
    if (legacyMtime !== null) {
      console.log(`        旧单文件仍留存（${when(legacyMtime)} 最后写入）—— 适配器只在上述目录缺失时才读它`);
    }
  } else if (legacyMtime !== null) {
    report('warn', '投影缓存退回旧布局（单文件）',
      `未找到 ${perRecordDir}；若 harness 已升级，说明缓存又换位置了`);
  } else {
    report('ok', '未安装 dsh（无需适配）', '既无新布局目录也无旧单文件');
  }

  // 假设 4：转录文件名 + 假设 5：覆盖度
  const sessionsRoot = path.join(home, 'sessions');
  const generations = new Map();
  const transcriptIds = new Set();
  let newestTranscript = null;
  for (const proj of readdirSafe(sessionsRoot)) {
    if (!proj.isDirectory()) continue;
    const projDir = path.join(sessionsRoot, proj.name);
    for (const sd of readdirSafe(projDir)) {
      if (!sd.isDirectory()) continue;
      transcriptIds.add(sd.name);
      const dir = path.join(projDir, sd.name);
      for (const f of readdirSafe(dir)) {
        const m = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(f.name);
        if (!m) continue;
        const gen = m[1] === undefined ? 0 : Number(m[1]);
        generations.set(gen, (generations.get(gen) || 0) + 1);
        const mt = mtimeOf(path.join(dir, f.name));
        if (mt !== null && (newestTranscript === null || mt > newestTranscript)) newestTranscript = mt;
      }
    }
  }
  if (transcriptIds.size === 0) {
    report('ok', '转录文件名（session[.v<N>].jsonl[.zstd]）', '无会话目录，跳过');
  } else {
    const genList = [...generations].sort((a, b) => a[0] - b[0])
      .map(([g, n]) => `v${g}×${n}`).join(', ');
    console.log(`        转录格式代号分布: ${genList}`);
    report(generations.size > 0 ? 'ok' : 'fail', '转录文件名可被正则匹配',
      generations.size > 0 ? `${transcriptIds.size} 个会话目录` : '全部不匹配 → 适配器取不到活动时间');
  }

  // 端到端：适配器实际输出
  const adapter = createDshAdapter({ home: process.env.DSH_HOME ? home : '' });
  const rows = adapter.listSessions();
  const newestRow = rows.length ? Math.max(...rows.map(r => r.timeUpdated || 0)) : null;
  report(adapter.lastError === null ? 'ok' : 'warn', '适配器 lastError', adapter.lastError || '无');
  report(rows.length > 0 ? 'ok' : (fs.existsSync(home) ? 'warn' : 'ok'), '适配器列出会话',
    `${rows.length} 条，最新活动 ${when(newestRow)}`);
  if (rows.length > 0 && newestTranscript !== null && newestRow !== null && newestTranscript > newestRow + 60000) {
    report('fail', '缓存未覆盖最新转录',
      `最新转录 ${when(newestTranscript)} 比最新缓存行 ${when(newestRow)} 更新 → 会漏掉活跃会话`);
  } else if (rows.length > 0) {
    report('ok', '缓存覆盖度', '最新转录已被缓存覆盖');
  }
}

// ============ 其余 harness：只看"能否列出会话"（对方 schema 变化同样在此暴露）============
const OTHER_ADAPTERS = [
  ['opencode', createOpencodeAdapter],
  ['ZCode', createZcodeAdapter],
  ['Antigravity', createAntigravityAdapter],
  ['Codex', createCodexAdapter],
  ['Claude Code', createClaudeAdapter]
];

function checkOthers() {
  console.log('\n=== 其他 harness（未安装时静默为空列表，属正常）===');
  for (const [label, factory] of OTHER_ADAPTERS) {
    let adapter;
    try {
      adapter = factory();
    } catch (e) {
      report('warn', `${label} 适配器构造失败`, e.message);
      continue;
    }
    let rows = [];
    try {
      rows = adapter.listSessions();
    } catch (e) {
      report('warn', `${label} listSessions 抛错`, e.message);
      continue;
    }
    const newest = rows.length ? Math.max(...rows.map(r => r.timeUpdated || 0)) : null;
    const err = adapter.lastError;
    // 空列表 + ENOENT = 未安装（设计上的静默降级）；其他错误才值得看
    if (rows.length === 0 && err && /ENOENT/.test(err)) {
      report('ok', `${label}`, '未安装（目录不存在，正常降级）');
      continue;
    }
    const level = err && rows.length === 0 ? 'warn' : 'ok';
    report(level, `${label}`, `${rows.length} 条，最新活动 ${when(newest)}`
      + (err ? `，lastError=${err}` : ''));
  }
}

console.log('harness 数据源体检（升级 harness 后跑一次；关键格式假设见本文件注释）');
checkDsh();
checkOthers();

console.log('\n===== 结论 =====');
if (problems.length === 0) {
  console.log('全部正常：适配器依赖的格式假设仍然成立。');
  process.exit(0);
}
console.log(`有 ${problems.length} 项需要人工确认：`);
for (const p of problems) console.log(`  - ${p}`);
console.log('\n处理方向：对照对应 harness 包的 README/源码确认新格式，再更新适配器与'
  + '\n本脚本的假设清单（agent-monitor.js 的 dsh 适配器注释里列了已知的两代布局）。');
process.exit(1);
