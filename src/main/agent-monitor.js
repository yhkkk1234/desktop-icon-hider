// agent-monitor.js - 监控本地 AI agent（harness）正在运行的会话状态
// 架构：harness 适配器接口 + 轮询器。
// 首个实现：opencode（只读 SQLite，~/.local/share/opencode/opencode.db）
// 状态判定原理：会话每次有活动（用户输入/AI 流式输出/工具调用）都会刷新
// session.time_updated；超过活跃阈值视为"静止"。静止后看最后一条 part 类型
// （step-finish = 正常完成一轮，其余 = 被中断），把"完成"与"中断"区分开。
const path = require('path');
const os = require('os');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
// 查询范围：必须显著大于用户实际会话量，否则跑完（不再活跃）的会话会被新会话
// 挤出查询结果 → 快照消失 → 条目被误删。100 条覆盖典型使用（session 查询 ~1ms，
// part 增量缓存机制不受影响；首次批量 IN 全表扫一次 ~100ms，仅启动时一次）
const SESSION_LIMIT = 100;
const DEFAULT_ACTIVE_WINDOW_MS = 120 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2500;
// 最后 part 为 step-finish（AI 完成一轮输出）后的完成确认窗口：
// 超过该时长无新活动 → 直接判定完成，不必等活跃阈值（120s）到期
const STEP_FINISH_CONFIRM_MS = 15 * 1000;
// opencode server 探测端口：4948 = OpenCode Desktop 内置 sidecar；4096 = serve 默认 / TUI 优先端口
const DEFAULT_SERVER_PORTS = [4948, 4096];
const PROBE_CACHE_TTL = 10 * 1000;

// 懒加载 better-sqlite3：Electron 环境下加载编译好的 .node；
// 测试环境（node ABI 不匹配）或未编译时返回 null，适配器降级为空列表
let DatabaseModule = null;
function getDatabaseModule() {
  if (!DatabaseModule) {
    try {
      DatabaseModule = require('better-sqlite3');
    } catch (e) {
      DatabaseModule = null;
    }
  }
  return DatabaseModule;
}

// ============ 纯函数（可单测） ============

/**
 * 判定会话状态：active（活跃中）/ completed（已完成）/ interrupted（被中断）
 * 规则：
 * - 最后 part 是 step-finish（AI 完成一轮输出）且已过确认窗口 → completed（无需等活跃阈值）
 * - 活跃窗口内 → active；窗口外按最后 part 类型区分完成/中断
 * @param {{ timeUpdated: number, lastPartType: ?string }} session 规范化会话
 * @param {number} now 当前时间戳（ms）
 * @param {number} activeWindowMs 活跃判定窗口（ms）
 * @returns {'active'|'completed'|'interrupted'}
 */
function classifySession(session, now, activeWindowMs) {
  if (typeof session.timeUpdated === 'number' && now - session.timeUpdated < activeWindowMs) {
    // 活跃窗口内：step-finish 确认完成；其余视为运行中（含 AI 思考/工具执行间隙）
    if (session.lastPartType === 'step-finish' &&
        now - session.timeUpdated >= STEP_FINISH_CONFIRM_MS) {
      return 'completed';
    }
    return 'active';
  }
  // 静止：最后一条 part 是 step-finish 视为正常完成；其余（text/reasoning/tool
  // 等）视为被中断（Ctrl+C/关闭终端）。无 part 数据的老会话归为已完成。
  if (!session.lastPartType || session.lastPartType === 'step-finish') {
    return 'completed';
  }
  return 'interrupted';
}

/**
 * 显示过滤：运行中的会话始终显示；已完成/中断的会话仅在未标记已读时显示。
 * 注意：渲染端当前使用更精细的规则（活跃全部 + 未读完成最近 10 条，
 * renderer.js getVisibleAgentSessions），此函数保留为通用工具。
 * @param {Array<{id: string, status: string}>} sessions 规范化会话列表
 * @param {string[]} readIds 已读会话 id 列表
 * @returns {Array<{id: string, status: string}>}
 */
function filterVisibleSessions(sessions, readIds) {
  const read = new Set(Array.isArray(readIds) ? readIds : []);
  return sessions.filter((s) => s.status === 'active' || !read.has(s.id));
}

/**
 * 校验会话 id 格式（防注入：id 会拼进命令行）
 * @param {*} id
 * @returns {boolean}
 */
function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/**
 * opencode 数据库默认路径（Windows/Linux/macOS 通用）
 * @returns {string}
 */
function getOpencodeDbPath() {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * 解析 part 表 data 列的 type 字段
 * @param {*} raw JSON 字符串
 * @returns {?string}
 */
function parseLastPartType(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const data = JSON.parse(raw);
    return typeof data.type === 'string' ? data.type : null;
  } catch (e) {
    return null;
  }
}

/**
 * 将 opencode 数据库行规范化（lastPartType 由 listSessions 的缓存填充）
 * @param {*} row
 * @returns {{id: string, title: string, directory: string, agent: string, timeUpdated: number, timeCreated: number, lastPartType: ?string}}
 */
function normalizeOpencodeRow(row) {
  return {
    id: row.id,
    title: row.title || '',
    directory: row.directory || '',
    agent: row.agent || 'default',
    timeUpdated: row.time_updated,
    timeCreated: row.time_created,
    lastPartType: null
  };
}

// ============ opencode 适配器 ============

/**
 * 检测正在使用的 opencode 客户端类型。
 * OpenCode Desktop（Electron 桌面版）进程存在 → 'desktop'，否则 'terminal'。
 * 桌面版支持 opencode:// 深链（open-project/new-session），可直接跳到对应项目窗口。
 * @param {Function} execSyncFn 命令执行函数（测试注入）
 * @returns {'desktop'|'terminal'}
 */
function detectOpencodeClient(execSyncFn = execFileSync) {
  try {
    const out = execSyncFn('tasklist', ['/FI', 'IMAGENAME eq OpenCode.exe', '/NH'], {
      timeout: 5000,
      encoding: 'utf8'
    });
    if (/OpenCode\.exe/i.test(out)) return 'desktop';
  } catch (e) { /* 未找到进程，走终端 */ }
  return 'terminal';
}

// 客户端检测结果缓存（tasklist 启动 ~230ms，点击跳转时同步执行会阻塞主进程）
let clientDetectCache = null;

/**
 * 清空客户端检测缓存（测试用）
 */
function resetClientDetectCache() {
  clientDetectCache = null;
}

// 进程存在性检测缓存（每进程名独立）
const processDetectCaches = new Map(); // name -> { at, found }

/**
 * 异步检测指定进程是否存在（spawn tasklist，不阻塞主进程），结果缓存 5s。
 * opts.noCache=true 时绕过缓存实时查询（点击验证用，~230ms 异步可接受）。
 * @param {string} name 进程映像名（如 'OpenCode.exe' / 'opencode.exe'）
 * @param {Function} spawnFn 进程启动函数（测试注入）
 * @param {{ noCache?: boolean }} opts
 * @returns {Promise<boolean>}
 */
function hasProcessAsync(name, spawnFn = spawn, opts = {}) {
  const now = Date.now();
  const cached = processDetectCaches.get(name);
  if (!opts.noCache && cached && now - cached.at < 5 * 1000) {
    return Promise.resolve(cached.found);
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH'], { windowsHide: true });
    } catch (e) {
      processDetectCaches.set(name, { at: Date.now(), found: false });
      resolve(false);
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => {
      processDetectCaches.set(name, { at: Date.now(), found: false });
      resolve(false);
    });
    child.on('close', () => {
      const found = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out);
      processDetectCaches.set(name, { at: Date.now(), found });
      resolve(found);
    });
  });
}

// opencode 运行状态判定（保守策略：宁可多等也不误锁）
// 确认期 15s：server 探测抖动/进程检测偶发失败不会导致误判"关闭"而锁死列表。
// 配合 5s 检测周期 + 5s 进程缓存 + 实时端口探测，opencode 关闭后 ~20s 内反映
const RUNTIME_CONFIRM_MS = 15 * 1000;
let lastRuntimeSignalAt = 0;

/** 默认端口连接函数（127.0.0.1 快速探测，失败立即返回） */
function defaultConnect(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const finish = (ok) => {
      try { sock.destroy(); } catch (e) { /* 忽略 */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}

/** 实时探测候选端口是否有可达服务（毫秒级，不缓存） */
async function probeAnyPort(connectFn, ports = DEFAULT_SERVER_PORTS) {
  for (const port of ports) {
    if (await connectFn(port, 200)) return true;
  }
  return false;
}

/**
 * 实时判定 opencode 是否在运行（进程 + 端口，无确认期、无进程缓存）。
 * 供"点击条目"时的即时验证：关闭后任意时刻点击都会被拦截，
 * 不受周期检测的 15s 确认期影响。
 * @param {Function} spawnFn 进程启动函数（测试注入）
 * @param {?Function} connectFn 端口连接函数（测试注入）
 * @returns {Promise<boolean>}
 */
async function detectOpencodeRunningNow(spawnFn = spawn, connectFn = defaultConnect) {
  const [desktop, cli] = await Promise.all([
    hasProcessAsync('OpenCode.exe', spawnFn, { noCache: true }),
    hasProcessAsync('opencode.exe', spawnFn, { noCache: true })
  ]);
  if (desktop || cli) return true;
  if (connectFn && (await probeAnyPort(connectFn))) return true;
  return false;
}

/**
 * 判定 opencode 是否在运行（供"关闭时锁定列表"用，周期检测）。
 * 信号源（任一命中即视为运行）：
 * 1. OpenCode.exe 进程（Desktop 版）
 * 2. opencode.exe 进程（CLI / TUI / serve）
 * 3. 实时端口探测（server 可达，毫秒级不缓存，弥补进程缓存滞后）
 * 4. 确认期：信号刚消失 15s 内仍视为运行——探测抖动不误锁
 * @param {Function} spawnFn 进程启动函数（测试注入）
 * @param {?Function} connectFn 端口连接函数（测试注入）
 * @returns {Promise<boolean>}
 */
async function detectOpencodeRunning(spawnFn = spawn, connectFn = defaultConnect) {
  if (await detectOpencodeRunningNow(spawnFn, connectFn)) {
    lastRuntimeSignalAt = Date.now();
    return true;
  }
  return Date.now() - lastRuntimeSignalAt < RUNTIME_CONFIRM_MS;
}

/**
 * 清空运行状态（测试用）
 */
function resetRuntimeSignal() {
  lastRuntimeSignalAt = 0;
  processDetectCaches.clear();
}

/**
 * 异步检测客户端类型（不阻塞主进程），结果缓存 5s。
 * @param {Function} spawnFn 进程启动函数（测试注入）
 * @returns {Promise<'desktop'|'terminal'>}
 */
function detectOpencodeClientAsync(spawnFn = spawn) {
  const now = Date.now();
  if (clientDetectCache && now - clientDetectCache.at < 5 * 1000) {
    return Promise.resolve(clientDetectCache.result);
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn('tasklist', ['/FI', 'IMAGENAME eq OpenCode.exe', '/NH'], { windowsHide: true });
    } catch (e) {
      clientDetectCache = { at: Date.now(), result: 'terminal' };
      resolve('terminal');
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => {
      clientDetectCache = { at: Date.now(), result: 'terminal' };
      resolve('terminal');
    });
    child.on('close', () => {
      const result = /OpenCode\.exe/i.test(out) ? 'desktop' : 'terminal';
      clientDetectCache = { at: Date.now(), result };
      resolve(result);
    });
  });
}

/**
 * 按优先级查找可用终端：PowerShell 7（pwsh）→ Windows PowerShell → cmd（兜底）。
 * 仅在用户没有桌面客户端时使用。
 * @param {Function} execSyncFn 命令执行函数（测试注入）
 * @returns {string} 'pwsh' | 'powershell' | 'cmd'
 */
function findTerminalShell(execSyncFn = execFileSync) {
  for (const name of ['pwsh', 'powershell']) {
    try {
      execSyncFn('where', [name], { stdio: 'ignore', timeout: 5000 });
      return name;
    } catch (e) { /* 未安装，尝试下一个 */ }
  }
  return 'cmd';
}

// 终端检测结果缓存（where 启动也有开销，与客户端检测缓存同理）
let terminalShellCache = null;

/**
 * 异步查找终端（不阻塞主进程），结果缓存 10s。
 * @param {Function} spawnFn 进程启动函数（测试注入）
 * @returns {Promise<string>} 'pwsh' | 'powershell' | 'cmd'
 */
function findTerminalShellAsync(spawnFn = spawn) {
  const now = Date.now();
  if (terminalShellCache && now - terminalShellCache.at < 10 * 1000) {
    return Promise.resolve(terminalShellCache.result);
  }
  const probe = (name) => new Promise((resolve) => {
    let child;
    try {
      child = spawnFn('where', [name], { windowsHide: true });
    } catch (e) {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  return (async () => {
    for (const name of ['pwsh', 'powershell']) {
      if (await probe(name)) {
        terminalShellCache = { at: Date.now(), result: name };
        return name;
      }
    }
    terminalShellCache = { at: Date.now(), result: 'cmd' };
    return 'cmd';
  })();
}

/**
 * 清空终端检测缓存（测试用）
 */
function resetTerminalShellCache() {
  terminalShellCache = null;
}

/**
 * 用 server 的权威状态校准会话状态（方案 A 核心）。
 * - busy / retry → active（服务端确认正在运行/重试中，覆盖推断）
 * - idle → 服务端确认没在跑：按最后 part 类型判 completed / interrupted
 * - server 无该会话记录 → null（不覆盖，保留 DB 推断）
 * @param {{id: string, status: string, lastPartType: ?string}} session
 * @param {Map<string, string>} serverStatuses sessionID → 'busy'|'idle'|'retry'
 * @returns {?string} 覆盖后的状态；null 表示不覆盖
 */
function applyServerStatus(session, serverStatuses) {
  if (!serverStatuses || serverStatuses.size === 0) return null;
  const serverState = serverStatuses.get(session.id);
  if (!serverState) return null;
  if (serverState === 'busy' || serverState === 'retry') return 'active';
  if (serverState === 'idle') {
    if (!session.lastPartType || session.lastPartType === 'step-finish') return 'completed';
    return 'interrupted';
  }
  return null;
}

/**
 * 从 SSE 数据块中提取 JSON 事件列表（纯函数，可单测）。
 * SSE 格式：多行 `data: {...}`，空行分隔事件。
 * @param {string} chunk 流数据块
 * @returns {Array<Object>}
 */
function parseSSEChunk(chunk) {
  const events = [];
  for (const block of chunk.split(/\r?\n\r?\n/)) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()));
      } catch (e) { /* 忽略非 JSON 数据 */ }
    }
  }
  return events;
}

/**
 * opencode server 状态提供器：探测本地 server（desktop 4948 / TUI·serve 4096），
 * 订阅其 SSE 事件流（/event），从 `session.status` 事件获取权威运行状态（busy/idle/retry）。
 * 实测结论：/session/status HTTP 接口在 serve 实例下返回空，不可依赖；
 * SSE 事件流是可靠通道，且实时推送（busy→idle 零延迟，免轮询）。
 * - 认证：环境变量 OPENCODE_SERVER_PASSWORD/USERNAME（与 desktop 同源）；无密码 → 免认证
 * - 探测结果缓存；断线自动重连（指数退避）；全部失败 → 空 Map（上层回落 DB 推断模式）
 * @param {{ ports?: number[], username?: string, password?: string, fetchFn?: Function, connectFn?: Function }} options
 * @returns {{ getStatuses: Function, invalidateCache: Function }}
 */
function createOpencodeServerStatusProvider(options = {}) {
  const ports = Array.isArray(options.ports) ? options.ports : DEFAULT_SERVER_PORTS;
  const username = typeof options.username === 'string' ? options.username
    : process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  const password = typeof options.password === 'string' ? options.password
    : (typeof process.env.OPENCODE_SERVER_PASSWORD === 'string' ? process.env.OPENCODE_SERVER_PASSWORD : null);
  const fetchFn = options.fetchFn || ((url, init) => globalThis.fetch(url, init));
  const connectFn = options.connectFn || defaultConnect;

  let probeCache = null; // { at, baseUrls }
  let probing = false;
  let disposed = false;
  let statusMap = new Map(); // sessionID → 'busy'|'idle'|'retry'（SSE 实时累计）
  let sseControllers = new Map(); // base → AbortController（每 server 独立连接）

  function authHeaders() {
    if (!password) return undefined;
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  /** 探测可达的 opencode server 端口（/global/health 验证，排除端口被无关程序占用） */
  async function probeBaseUrls() {
    const now = Date.now();
    if (probeCache && now - probeCache.at < PROBE_CACHE_TTL) return probeCache.baseUrls;
    const baseUrls = [];
    for (const port of ports) {
      const reachable = await connectFn(port, 300);
      if (!reachable) continue;
      try {
        const res = await fetchFn(`http://127.0.0.1:${port}/global/health`, {
          headers: authHeaders(),
          signal: AbortSignal.timeout(1500)
        });
        if (res && res.ok) {
          const json = await res.json();
          if (json && json.healthy === true) baseUrls.push(`http://127.0.0.1:${port}`);
        }
      } catch (e) { /* 不是 opencode server，跳过 */ }
    }
    probeCache = { at: Date.now(), baseUrls };
    return baseUrls;
  }

  /** 订阅单个 server 的 SSE 事件流（断线指数退避重连，按 base 去重） */
  async function connectSSE(base, attempt = 0) {
    if (sseControllers.has(base)) return;
    const ctrl = new AbortController();
    sseControllers.set(base, ctrl);
    try {
      const res = await fetchFn(`${base}/event`, { headers: authHeaders(), signal: ctrl.signal });
      // 认证失败/服务异常（401 等）：不无谓重连，等探测缓存过期后重新探测
      if (!res || !res.ok) return;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (!disposed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = parseSSEChunk(buffer);
        buffer = '';
        for (const ev of events) {
          if (ev.type === 'session.status' && ev.properties && ev.properties.sessionID && ev.properties.status) {
            statusMap.set(ev.properties.sessionID, ev.properties.status.type);
          } else if (ev.type === 'session.idle' && ev.properties && ev.properties.sessionID) {
            statusMap.set(ev.properties.sessionID, 'idle');
          }
        }
      }
    } catch (e) { /* 连接中断，走重连 */ } finally {
      sseControllers.delete(base);
    }
    if (disposed) return;
    if (attempt >= 5) {
      // 连续重连失败（server 已下线或换了端口）：清除探测缓存触发重新探测
      probeCache = null;
      ensureConnected();
      return;
    }
    // 指数退避重连（1s 起，上限 30s）；server 若已下线，重连失败静默
    const delay = Math.min(1000 * (2 ** attempt), 30000);
    setTimeout(() => {
      if (!disposed) connectSSE(base, attempt + 1);
    }, delay);
  }

  /** 确保已探测并订阅（幂等，探测缓存期内只执行一次） */
  async function ensureConnected() {
    if (probing) return;
    probing = true;
    try {
      const baseUrls = await probeBaseUrls();
      for (const base of baseUrls) {
        connectSSE(base);
      }
    } finally {
      probing = false;
    }
  }

  /**
   * 获取当前已知的会话状态（同步读内存，SSE 事件持续更新）
   * @returns {Map<string, string>} sessionID → 'busy'|'idle'|'retry'
   */
  function getStatuses() {
    ensureConnected(); // 触发一次订阅（幂等；异步完成后状态陆续到达）
    return statusMap;
  }

  return {
    getStatuses,
    /** 最近一次探测（缓存有效期内）是否有可达 server */
    isReachable() {
      return !!(probeCache && probeCache.baseUrls.length > 0);
    },
    /** 停止订阅与重连（应用退出/测试清理用） */
    dispose() {
      disposed = true;
      probeCache = null;
      for (const ctrl of sseControllers.values()) {
        try { ctrl.abort(); } catch (e) { /* 忽略 */ }
      }
      sseControllers.clear();
    },
    invalidateCache: () => {
      probeCache = null;
      for (const ctrl of sseControllers.values()) {
        try { ctrl.abort(); } catch (e) { /* 忽略 */ }
      }
      sseControllers.clear();
      statusMap = new Map();
      ensureConnected();
    }
  };
}

/**
 * 创建 opencode harness 适配器（依赖注入便于测试）
 * @param {{ dbPath?: string, Database?: Function, spawnFn?: Function, shellFn?: Function, statusProvider?: Object }} options
 *   shellFn：electron shell.openExternal（打开 opencode:// 深链），由主进程注入
 *   statusProvider：createOpencodeServerStatusProvider 产物，用于 server 权威状态校准
 * @returns {{ id: string, displayName: string, listSessions: Function, openSession: Function, getServerStatuses: Function }}
 */
function createOpencodeAdapter(options = {}) {
  const dbPath = options.dbPath || getOpencodeDbPath();
  const DB = options.Database || getDatabaseModule();
  const spawnFn = options.spawnFn || spawn;
  const shellFn = options.shellFn || null;
  const statusProvider = options.statusProvider || null;
  let db = null;
  let lastError = null;
  let stmtSession = null;
  let stmtBatchPart = null;
  let stmtSinglePart = null;
  // last_part 缓存：静止会话的 timeUpdated 不变 → 不必重查 part 表。
  // part 表无 (session_id, time_created) 索引，直接子查询需全表扫描（11 万行），
  // 实测原查询单次 700ms，会阻塞主进程导致 UI 卡顿。
  const lastPartCache = new Map(); // id -> { timeUpdated, data }
  let batchLoaded = false;

  function getStatements() {
    if (stmtSession) return { stmtSession, stmtBatchPart, stmtSinglePart };
    stmtSession = db.prepare(
      `SELECT s.id, s.title, s.directory, s.agent, s.time_created, s.time_updated
       FROM session s
       WHERE s.time_archived IS NULL
       ORDER BY s.time_updated DESC
       LIMIT ?`
    );
    // 首次全量：一条 IN + GROUP BY 取全部会话的最后 part（一次全表扫描 ~90ms，仅启动时一次）
    const ph = new Array(SESSION_LIMIT).fill('?').join(',');
    stmtBatchPart = db.prepare(
      `SELECT p.session_id AS sid, p.data AS data
       FROM part p
       JOIN (SELECT session_id, MAX(time_created) AS mt FROM part
             WHERE session_id IN (${ph}) GROUP BY session_id) m
         ON p.session_id = m.session_id AND p.time_created = m.mt`
    );
    // 增量：单个会话的最后 part（命中页缓存，毫秒级）
    stmtSinglePart = db.prepare(
      'SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 1'
    );
    return { stmtSession, stmtBatchPart, stmtSinglePart };
  }

  function openDb() {
    if (db) return true;
    if (!DB) {
      lastError = 'better-sqlite3 未加载（原生模块缺失）';
      return false;
    }
    try {
      if (!DB) return false;
      db = new DB(dbPath, { readonly: true, fileMustExist: true });
      return true;
    } catch (e) {
      lastError = e.message;
      return false;
    }
  }

  function closeDb() {
    if (db) {
      try { db.close(); } catch (e) { /* 忽略 */ }
      db = null;
      stmtSession = null;
      stmtBatchPart = null;
      stmtSinglePart = null;
    }
  }

  return {
    id: 'opencode',
    displayName: 'opencode',
    lastError,

    /** 只读查询最近活跃会话（含静止的已完成会话，由渲染端按已读过滤）。
     * 性能：session 表查询 <1ms；part 表仅对 timeUpdated 变化的会话增量查询，
     * 静止会话（绝大多数）直接命中缓存。 */
    listSessions() {
      if (!openDb()) return [];
      try {
        const { stmtSession: ss, stmtBatchPart: bp, stmtSinglePart: sp } = getStatements();
        const rows = ss.all(SESSION_LIMIT);

        // 找出 last_part 缓存失效的会话（timeUpdated 变化或首次出现）
        const stale = rows.filter(r => {
          const cached = lastPartCache.get(r.id);
          return !cached || cached.timeUpdated !== r.time_updated;
        });

        const partData = new Map();
        if (!batchLoaded) {
          // 首次：批量查询，一次扫全表
          const batchRows = bp.all(...rows.map(r => r.id));
          for (const p of batchRows) partData.set(p.sid, p.data);
          batchLoaded = true;
        } else {
          // 增量：只查变化会话（通常 1-3 个）
          for (const r of stale) {
            const p = sp.get(r.id);
            partData.set(r.id, p ? p.data : null);
          }
        }

        // 回填缓存（未变化会话沿用旧值），并清理已不在结果中的会话
        const activeIds = new Set();
        for (const r of rows) {
          activeIds.add(r.id);
          const cached = lastPartCache.get(r.id);
          lastPartCache.set(r.id, {
            timeUpdated: r.time_updated,
            data: partData.has(r.id) ? partData.get(r.id) : (cached ? cached.data : null)
          });
        }
        for (const key of lastPartCache.keys()) {
          if (!activeIds.has(key)) lastPartCache.delete(key);
        }

        return rows.map(r => {
          const normalized = normalizeOpencodeRow(r);
          const cached = lastPartCache.get(r.id);
          normalized.lastPartType = parseLastPartType(cached ? cached.data : null);
          return normalized;
        });
      } catch (e) {
        // 表结构变化/DB 被占用等：降级为空列表，下次轮询重试
        lastError = e.message;
        closeDb();
        return [];
      }
    },

    /**
     * 跳转到指定会话：优先跟随正在使用的客户端。
     * - 检测到 OpenCode Desktop → opencode://open-project 深链（打开对应项目窗口，
     *   桌面端会话列表可见）；desktop 深链不支持直达指定会话，这是官方能力上限
     * - 否则 → 新终端窗口（pwsh 优先，无则 powershell/cmd）运行 `opencode -s <id>`
     * 客户端检测为异步（spawn tasklist），不阻塞主进程
     * @returns {Promise<{ ok: boolean, target?: string, error?: string }>}
     */
    async openSession(session) {
      if (!session || !isValidSessionId(session.id)) return { ok: false, error: '无效的会话 id' };
      const cwd = typeof session.directory === 'string' && session.directory ? session.directory : os.homedir();

      // 桌面客户端优先：深链打开对应项目窗口
      if (shellFn && (await detectOpencodeClientAsync(spawnFn)) === 'desktop') {
        try {
          const url = 'opencode://open-project?directory=' + encodeURIComponent(cwd);
          shellFn(url);
          return { ok: true, target: 'desktop' };
        } catch (e) {
          // 深链失败则降级终端
        }
      }

      // 终端方案：pwsh / powershell / cmd，新控制台窗口（Electron 主进程无控制台，
      // spawn 控制台程序会自动分配新窗口），-NoExit 保持窗口不退
      try {
        const shell = await findTerminalShellAsync(spawnFn);
        const cmd = `opencode -s ${session.id}`;
        if (shell === 'cmd') {
          const child = spawnFn('cmd.exe', ['/k', cmd], { cwd, windowsHide: false, detached: true });
          child.on('error', () => { /* 打开终端失败静默 */ });
          child.unref();
        } else {
          const child = spawnFn(shell, ['-NoExit', '-Command', cmd], { cwd, windowsHide: false, detached: true });
          child.on('error', () => { /* 打开终端失败静默 */ });
          child.unref();
        }
        return { ok: true, target: 'terminal', shell };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    /**
     * 取 server 权威状态（busy/idle/retry → 状态覆盖表）。
     * 由 AgentMonitor 轮询时调用；server 不可达或未配置时返回空 Map（纯 DB 推断模式）。
     * @returns {Promise<Map<string, string>>}
     */
    async getServerStatuses() {
      if (!statusProvider || typeof statusProvider.getStatuses !== 'function') return new Map();
      try {
        const statuses = await statusProvider.getStatuses();
        return statuses || new Map();
      } catch (e) {
        return new Map();
      }
    }
  };
}

// ============ 轮询器 ============

/**
 * 会话监控器：按固定周期轮询所有适配器，计算状态，推送变化
 */
class AgentMonitor {
  /**
   * @param {{ adapters: Array, activeWindowMs?: number, intervalMs?: number, now?: Function, onUpdate?: Function }} options
   */
  constructor(options = {}) {
    this.adapters = options.adapters || [];
    this.activeWindowMs = options.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS;
    this.intervalMs = options.intervalMs || DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now || (() => Date.now());
    this.onUpdate = options.onUpdate || (() => {});
    this.timer = null;
    this.snapshot = [];
    this.lastSignature = null;
  }

  /** 开始轮询 */
  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  /** 停止轮询 */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行一次轮询并推送快照。
   * 流程：适配器查询（同步）→ server 权威状态校准（异步，可选）→ diff 推送。
   * polling 标志防止上一轮异步校准未完成时下一轮重叠执行。
   */
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = this.now();
      const merged = [];
      const calibrators = [];
      for (const adapter of this.adapters) {
        try {
          const sessions = adapter.listSessions();
          for (const s of sessions) {
            merged.push({
              id: s.id,
              harness: adapter.id,
              harnessName: adapter.displayName || adapter.id,
              title: s.title,
              directory: s.directory,
              agent: s.agent,
              timeUpdated: s.timeUpdated,
              timeCreated: s.timeCreated,
              lastPartType: s.lastPartType,
              status: classifySession(s, now, this.activeWindowMs)
            });
          }
          if (typeof adapter.getServerStatuses === 'function') {
            calibrators.push(adapter);
          }
        } catch (e) {
          // 单个适配器异常不影响其他适配器
        }
      }

      // server 权威状态校准：busy/retry → active；idle → 按 lastPartType 判完成/中断
      for (const adapter of calibrators) {
        try {
          const serverStatuses = await adapter.getServerStatuses();
          if (!serverStatuses || serverStatuses.size === 0) continue;
          for (const s of merged) {
            if (s.harness !== adapter.id) continue;
            const override = applyServerStatus(s, serverStatuses);
            if (override) s.status = override;
          }
        } catch (e) { /* 校准失败不影响整体 */ }
      }

      this.snapshot = merged;
      // 快照无变化（静止状态）时跳过推送。签名只含稳定字段（不含 timeUpdated），
      // 运行中的会话 timeUpdated 每轮刷新但不触发推送；状态/集合变化才推送
      const signature = JSON.stringify(merged.map(s => [
        s.id, s.harness, s.status, s.title, s.directory, s.agent
      ]));
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        this.onUpdate(merged, now);
      }
    } finally {
      this.polling = false;
    }
  }

  /** 最近一次快照 */
  getSnapshot() {
    return this.snapshot;
  }
}

module.exports = {
  AgentMonitor,
  applyServerStatus,
  classifySession,
  createOpencodeAdapter,
  createOpencodeServerStatusProvider,
  detectOpencodeClient,
  detectOpencodeClientAsync,
  detectOpencodeRunning,
  detectOpencodeRunningNow,
  filterVisibleSessions,
  findTerminalShell,
  findTerminalShellAsync,
  getOpencodeDbPath,
  hasProcessAsync,
  isValidSessionId,
  normalizeOpencodeRow,
  parseLastPartType,
  parseSSEChunk,
  probeAnyPort,
  resetClientDetectCache,
  resetRuntimeSignal,
  resetTerminalShellCache,
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SERVER_PORTS,
  RUNTIME_CONFIRM_MS,
  STEP_FINISH_CONFIRM_MS
};
