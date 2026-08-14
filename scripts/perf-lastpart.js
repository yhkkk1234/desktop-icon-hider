// perf-lastpart.js - 增量 last-part 查询耗时分布（agent-monitor 轮询路径）
'use strict';
const { DatabaseSync } = require('node:sqlite');
const os = require('os');
const path = require('path');
const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const stmtSession = db.prepare(
  `SELECT s.id, s.time_updated FROM session s
   WHERE s.time_archived IS NULL ORDER BY s.time_updated DESC LIMIT 100`
);
const stmtSinglePart = db.prepare(
  'SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 1'
);
const rows = stmtSession.all();
const times = [];
let worst = null;
for (const r of rows) {
  const t0 = process.hrtime.bigint();
  stmtSinglePart.get(r.id);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  times.push(ms);
  if (!worst || ms > worst.ms) worst = { id: r.id, ms };
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`sessions: ${times.length}`);
console.log(`avg: ${avg.toFixed(2)} ms  min: ${times[0].toFixed(2)}  p50: ${times[Math.floor(times.length / 2)].toFixed(2)}  p95: ${times[Math.floor(times.length * 0.95)].toFixed(2)}  max: ${times[times.length - 1].toFixed(2)}`);
console.log(`worst: ${worst.id} = ${worst.ms.toFixed(2)} ms`);

// 该会话有多少 part 行（解释 worst 是否因行数多）
const worstId = worst.id;
const partCount = db.prepare('SELECT COUNT(*) AS n FROM part WHERE session_id = ?').get(worstId);
console.log(`worst session part rows: ${partCount.n}`);
const allCounts = db.prepare(
  'SELECT session_id, COUNT(*) AS n FROM part GROUP BY session_id ORDER BY n DESC LIMIT 5'
).all();
console.log('top5 part-heavy sessions:', JSON.stringify(allCounts));
db.close();
