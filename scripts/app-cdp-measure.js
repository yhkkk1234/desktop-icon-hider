// app-cdp-measure.js - 通过 CDP 测量打包版应用的渲染层性能
// 由 app-perf.ps1 调用。参数: --port <debug端口>
'use strict';
const http = require('http');

const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const BASE = `http://127.0.0.1:${port}`;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForTarget(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const targets = await getJson('/json/list');
      const page = targets.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* 服务未就绪 */ }
    await sleep(250);
  }
  throw new Error('CDP target not found');
}

let ws = null;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (r.exceptionDetails) {
    throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  }
  return r.result ? r.result.value : undefined;
}

async function main() {
  const target = await waitForTarget();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const out = {};

  // 1. 渲染进程基本信息
  out.renderer = await evaluate(`({
    ua: navigator.userAgent,
    jsHeap: performance.memory ? {
      used: performance.memory.usedJSHeapSize / 1048576,
      total: performance.memory.totalJSHeapSize / 1048576
    } : null,
    bodyChildren: document.body.children.length
  })`);

  // 2. getFiles 冷调用（首次：枚举 + 图标提取/缓存加载）
  let t0 = await evaluate('performance.now()');
  await evaluate('window.api.getFiles()');
  out.getFilesColdMs = await evaluate('performance.now()') - t0;

  // 3. getFiles 热调用（缓存命中）
  t0 = await evaluate('performance.now()');
  const hot = await evaluate('window.api.getFiles().then(f => ({n: f.length, sample: f[0]}))');
  out.getFilesHotMs = await evaluate('performance.now()') - t0;
  out.filesCount = hot.n;

  // 4. 渲染完成度：图标 DOM 数量
  await sleep(1500);
  out.dom = await evaluate(`({
    iconEls: document.querySelectorAll('.icon-item, .desktop-icon, [class*="icon"]').length,
    bodyText: document.body.innerText.length
  })`);

  // 5. getFileIcons IPC（模拟渲染层请求图标数据）
  const files = await evaluate('window.api.getFiles()');
  if (files && files.length) {
    t0 = await evaluate('performance.now()');
    await evaluate('window.api.getFileIcons(' + JSON.stringify(files.slice(0, 30)) + ')');
    out.getFileIcons30Ms = await evaluate('performance.now()') - t0;
  }

  // 6. agent 会话查询 IPC（轮询路径）
  t0 = await evaluate('performance.now()');
  const agent = await evaluate('window.api.getAgentSessions().then(s => ({n: s.length}))').catch(() => null);
  out.getAgentSessionsMs = await evaluate('performance.now()') - t0;

  // 7. 全量渲染快照时间（模拟主渲染流水线）
  out.snapshot = await evaluate(`(async () => {
    const t = performance.now();
    const files = await window.api.getFiles();
    const icons = await window.api.getFileIcons(files.slice(0, 30));
    return { ms: performance.now() - t, files: files.length, icons: Object.keys(icons).length };
  })()`);

  // 8. 优雅退出：fire-and-forget，不等待响应（quitApp 后 renderer 销毁，响应会丢失）
  try {
    ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.evaluate', params: { expression: 'window.api.quitApp()', awaitPromise: true } }));
  } catch (e) { /* 连接可能已关闭 */ }
  await sleep(500);

  console.log(JSON.stringify(out, null, 2));
  try { ws.close(); } catch (e) { /* 忽略 */ }
  // 等待 stdout flush 后自然退出（勿用 process.exit，会截断管道输出）
  await sleep(200);
}

main().catch(e => {
  console.error('CDP measurement failed:', e.message);
  process.exit(1);
});
