// agent-monitor.js - 监控本地 AI agent（harness）正在运行的会话状态
// 架构：harness 适配器接口 + 轮询器。支持的 harness（未安装时适配器静默降级为空列表）：
// - opencode：只读 SQLite，~/.local/share/opencode/opencode.db
// - ZCode：只读 SQLite，~/.zcode/cli/db/db.sqlite（schema 与 opencode 同族，复用同一工厂）
// - Antigravity（谷歌反重力）：~/.gemini/antigravity/conversations/ 每会话一个 SQLite
// - Codex：~/.codex/state_*.sqlite 的 threads 表 + rollout JSONL 尾行
// - Claude Code：~/.claude/projects/**/*.jsonl 转录文件
// - dsh（DeepSeek Harness）：~/.dsh 投影缓存 JSON + 转录 mtime
// 状态判定原理：会话每次有活动（用户输入/AI 流式输出/工具调用）都会刷新
// 会话的最后活动时间（DB time_updated 或文件 mtime）；超过活跃阈值视为"静止"。
// 静止后看最后一条记录的类型（回合正常结束 = completed，其余 = interrupted），
// 把"完成"与"中断"区分开。各适配器把自家数据源映射到该统一语义。
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

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
// idle 覆盖时间窗：SSE 的 idle 记录只在事件后该时长内覆盖 DB 推断（保留 busy→idle 零延迟），
// 超过则视为"旧记录"不覆盖——会话曾在 serve 上跑完、之后切到其他端继续时不会被污染
const IDLE_OVERRIDE_WINDOW_MS = 60 * 1000;
// opencode server 探测端口：4096 = `opencode serve` 默认端口。
// 注意：OpenCode Desktop 的 sidecar 端口为随机（listen(0)）且带随机密码（randomUUID），
// 外部应用无法连接（实测 /global/health 返回 401）——SSE 校准通道仅对自跑 serve 生效，
// 实际主通道是 DB 推断（time_updated + last part）。
const DEFAULT_SERVER_PORTS = [4096];
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
    let settled = false;
    const finish = (found) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      processDetectCaches.set(name, { at: Date.now(), found });
      resolve(found);
    };
    // 挂起保护：tasklist 异常挂起时强制结束，避免 Promise 永不 settle、
    // 周期轮询持续叠加新进程（进程泄漏）
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch (e) { /* 忽略 */ }
      finish(false);
    }, 3000);
    if (child.stdout) child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => finish(false));
    child.on('close', () => {
      const found = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out);
      finish(found);
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
 * 用 server 的权威状态校准会话状态（方案 A 核心）。
 * - busy / retry → active（服务端确认正在运行/重试中，覆盖推断）
 * - idle → 服务端确认没在跑：按最后 part 类型判 completed / interrupted。
 *   仅"新鲜"的 idle 记录覆盖（事件时间 ≤ IDLE_OVERRIDE_WINDOW_MS）——旧 idle 记录
 *   （会话曾在 serve 上跑完、之后切到其他端继续）不覆盖，保留 DB 推断，避免状态污染
 * - server 无该会话记录 → null（不覆盖，保留 DB 推断）
 * @param {{id: string, status: string, lastPartType: ?string}} session
 * @param {Map<string, string|{status: string, at: number}>} serverStatuses
 *   sessionID → 'busy'|'idle'|'retry'（旧格式字符串）或 {status, at}（SSE 事件带时间戳）
 * @returns {?string} 覆盖后的状态；null 表示不覆盖
 */
function applyServerStatus(session, serverStatuses) {
  if (!serverStatuses || serverStatuses.size === 0) return null;
  const record = serverStatuses.get(session.id);
  if (!record) return null;
  // 兼容旧格式字符串（视为新鲜记录，保持历史行为）
  const serverState = typeof record === 'string' ? record : record.status;
  const at = typeof record === 'string' ? 0 : (record.at || 0);
  if (serverState === 'busy' || serverState === 'retry') return 'active';
  if (serverState === 'idle') {
    // 旧 idle 记录（超过时间窗）：不覆盖，保留 DB 推断
    if (at > 0 && Date.now() - at > IDLE_OVERRIDE_WINDOW_MS) return null;
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
 * opencode server 状态提供器：探测本地 `opencode serve`（默认 4096，可配置端口），
 * 订阅其 SSE 事件流（/event），从 `session.status` 事件获取权威运行状态（busy/idle/retry）。
 * 实测结论：/session/status HTTP 接口在 serve 实例下返回空，不可依赖；
 * SSE 事件流是可靠通道，且实时推送（busy→idle 零延迟，免轮询）。
 * - 认证：环境变量 OPENCODE_SERVER_PASSWORD/USERNAME；无密码 → 免认证。
 *   桌面端 sidecar 的密码是 randomUUID（端口也随机），外部不可连接——校准仅对自跑 serve 生效，
 *   desktop/TUI 场景自动回落纯 DB 推断模式（主通道）
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
  let statusMap = new Map(); // sessionID → { status: 'busy'|'idle'|'retry', at }（SSE 实时累计，带事件时间戳）
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
      const applyEvents = (events) => {
        for (const ev of events) {
          if (ev.type === 'session.status' && ev.properties && ev.properties.sessionID && ev.properties.status) {
            statusMap.set(ev.properties.sessionID, { status: ev.properties.status.type, at: Date.now() });
          } else if (ev.type === 'session.idle' && ev.properties && ev.properties.sessionID) {
            statusMap.set(ev.properties.sessionID, { status: 'idle', at: Date.now() });
          }
        }
      };
      let buffer = '';
      while (!disposed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件可能被 TCP 拆包：保留最后一个空行之后的不完整块，与下一个 chunk
        // 拼接后再解析（直接清空会把半个 data:{...} 永久丢弃，状态校准偶发失效）
        let cut = -1;
        const idxLF = buffer.lastIndexOf('\n\n');
        const idxCRLF = buffer.lastIndexOf('\r\n\r\n');
        if (idxLF >= 0) cut = idxLF + 2;
        if (idxCRLF >= 0 && idxCRLF + 4 > cut) cut = idxCRLF + 4;
        let parseable = buffer;
        let tail = '';
        if (cut > 0) {
          parseable = buffer.slice(0, cut);
          tail = buffer.slice(cut);
        }
        applyEvents(parseSSEChunk(parseable));
        buffer = tail;
      }
      // 流结束：解析缓冲区残留的最后一个（可能无空行结尾的）事件块
      if (!disposed && buffer.trim()) {
        applyEvents(parseSSEChunk(buffer));
        buffer = '';
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
 * @param {{ dbPath?: string, Database?: Function, statusProvider?: Object }} options
 *   statusProvider：createOpencodeServerStatusProvider 产物，用于 server 权威状态校准
 * @returns {{ id: string, displayName: string, listSessions: Function, getServerStatuses: Function }}
 */
// ============ 通用 SQLite 会话适配器（opencode / ZCode 共用） ============
// 两者 schema 同族：session(id,title,directory[,agent],time_created,time_updated,
// time_archived[,task_type]) + part(session_id,time_created,data JSON 含 type 字段，
// step-finish = AI 完成一轮输出)。差异仅在库路径 / 列清单 / 过滤条件。

/**
 * 创建通用 SQLite 会话适配器（依赖注入便于测试）
 * @param {{ id?: string, displayName?: string, dbPath?: string, sessionColumns?: string,
 *   sessionFilter?: string, Database?: ?Function, statusProvider?: ?Object }} options
 *   Database：显式传入（含 null=禁用）时尊重调用方；未传时自动加载 better-sqlite3
 * @returns {{ id: string, displayName: string, lastError: string,
 *   listSessions: Function, getServerStatuses: Function, setStatusProvider: Function }}
 */
function createSqliteSessionAdapter(options = {}) {
  const adapterId = options.id || 'opencode';
  const displayName = options.displayName || adapterId;
  const dbPath = options.dbPath || getOpencodeDbPath();
  // 查询列清单：zcode 无 agent 列，由调用方自定义
  const sessionColumns = options.sessionColumns ||
    's.id, s.title, s.directory, s.agent, s.time_created, s.time_updated';
  // 追加过滤条件（如 zcode 隐藏内部子代理会话）
  const sessionFilter = options.sessionFilter || '';
  const DB = Object.prototype.hasOwnProperty.call(options, 'Database') ? options.Database : getDatabaseModule();
  let statusProvider = options.statusProvider || null;
  let db = null;
  let lastError = null;
  let stmtSession = null;
  let stmtSinglePart = null;
  // last_part 缓存：静止会话的 timeUpdated 不变 → 不必重查 part 表。
  // part 表无 (session_id, time_created) 索引时直接子查询需全表扫描（11 万行），
  // 实测原查询单次 700ms，会阻塞主进程导致 UI 卡顿。
  const lastPartCache = new Map(); // id -> { timeUpdated, data }
  let batchLoaded = false;

  function getStatements() {
    if (stmtSession) return { stmtSession, stmtSinglePart };
    stmtSession = db.prepare(
      `SELECT ${sessionColumns}
       FROM session s
       WHERE s.time_archived IS NULL ${sessionFilter}
       ORDER BY s.time_updated DESC
       LIMIT ?`
    );
    // 增量：单个会话的最后 part（命中页缓存，毫秒级）
    stmtSinglePart = db.prepare(
      'SELECT data FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT 1'
    );
    return { stmtSession, stmtSinglePart };
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
      stmtSinglePart = null;
    }
  }

  /** 首次全量：一条 IN + GROUP BY 取全部会话的最后 part（一次全表扫描，仅启动时一次）。
   * 占位符按实际行数构建——固定上限个占位符在会话数不足时会因绑定参数数量
   * 不匹配抛错（better-sqlite3 严格校验），导致适配器永远返回空列表。 */
  function queryBatchParts(rows) {
    const partData = new Map();
    if (rows.length === 0) return partData;
    const ph = new Array(rows.length).fill('?').join(',');
    const stmt = db.prepare(
      `SELECT p.session_id AS sid, p.data AS data
       FROM part p
       JOIN (SELECT session_id, MAX(time_created) AS mt FROM part
             WHERE session_id IN (${ph}) GROUP BY session_id) m
         ON p.session_id = m.session_id AND p.time_created = m.mt`
    );
    for (const p of stmt.all(...rows.map(r => r.id))) partData.set(p.sid, p.data);
    return partData;
  }

  return {
    id: adapterId,
    displayName,
    get lastError() {
      return lastError;
    },

    /** 只读查询最近活跃会话（含静止的已完成会话，由渲染端按已读过滤）。
     * 性能：session 表查询 <1ms；part 表仅对 timeUpdated 变化的会话增量查询，
     * 静止会话（绝大多数）直接命中缓存。 */
    listSessions() {
      if (!openDb()) return [];
      try {
        const { stmtSession: ss, stmtSinglePart: sp } = getStatements();
        const rows = ss.all(SESSION_LIMIT);

        // 找出 last_part 缓存失效的会话（timeUpdated 变化或首次出现）
        const stale = rows.filter(r => {
          const cached = lastPartCache.get(r.id);
          return !cached || cached.timeUpdated !== r.time_updated;
        });

        let partData;
        if (!batchLoaded) {
          // 首次：批量查询，一次扫全表
          partData = queryBatchParts(rows);
          batchLoaded = true;
        } else {
          // 增量：只查变化会话（通常 1-3 个）
          partData = new Map();
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
    },

    /**
     * 运行时替换 server 状态提供器（设置中修改端口/密码后重建，旧 SSE 连接由调用方释放）。
     * @param {?Object} provider createOpencodeServerStatusProvider 产物或 null
     */
    setStatusProvider(provider) {
      statusProvider = provider || null;
    }
  };
}

/**
 * 创建 opencode 适配器（只读 SQLite，详见通用工厂注释）
 * @param {{ dbPath?: string, Database?: ?Function, statusProvider?: ?Object }} options
 */
function createOpencodeAdapter(options = {}) {
  return createSqliteSessionAdapter({
    id: 'opencode',
    displayName: 'opencode',
    dbPath: options.dbPath || getOpencodeDbPath(),
    ...(Object.prototype.hasOwnProperty.call(options, 'Database') ? { Database: options.Database } : {}),
    statusProvider: options.statusProvider
  });
}

// ============ ZCode 适配器 ============
// ZCode 的会话库与 opencode 同族（session/part 表、step-finish part 类型、
// epoch 毫秒时间戳、WAL 只读安全），直接复用通用 SQLite 工厂。差异：
// - 路径：~/.zcode/cli/db/db.sqlite（ZCODE_HOME 环境变量可覆盖根目录）
// - session 无 agent 列
// - session.task_type 区分主会话（interactive）与内部子代理（subagent_child）：
//   子代理的 title 是原始任务 prompt，全部展示会刷屏，一律隐藏

/**
 * ZCode 会话数据库路径
 * @returns {string}
 */
function getZcodeDbPath() {
  const envHome = process.env.ZCODE_HOME && String(process.env.ZCODE_HOME).trim();
  return path.join(envHome || path.join(os.homedir(), '.zcode'), 'cli', 'db', 'db.sqlite');
}

/**
 * 创建 ZCode 适配器（依赖注入便于测试）
 * @param {{ dbPath?: string, Database?: ?Function }} options
 * @returns {{ id: string, displayName: string, lastError: string, listSessions: Function }}
 */
function createZcodeAdapter(options = {}) {
  return createSqliteSessionAdapter({
    id: 'zcode',
    displayName: 'ZCode',
    dbPath: options.dbPath || getZcodeDbPath(),
    sessionColumns: 's.id, s.title, s.directory, s.time_created, s.time_updated',
    sessionFilter: 'AND s.task_type = \'interactive\'',
    ...(Object.prototype.hasOwnProperty.call(options, 'Database') ? { Database: options.Database } : {})
  });
}

// ============ DeepSeek Harness (dsh) 适配器 ============
// 数据源（纯 JSON + 文件 stat，零原生依赖；未安装/未运行时降级为空列表）：
// - <home>/storages/session_projcache.json：会话投影缓存，由运行中的 harness 实时写入
//   （实测毫秒级更新）。含 identity.cwd/createdAt、title、goal.phase、
//   sessionStats.openStep/pendingCalls、sessionListMetadata.lastPromptAt。
// - <home>/sessions/<项目目录编码>/<会话id>/session.jsonl.zstd：会话转录文件，
//   mtime 即该会话最后活动时间（等价于 opencode 的 time_updated）。
// 状态判定优先级：openStep/pendingCalls（正在执行）→ goal.phase
// （complete/blocked/paused）→ 转录 mtime 新鲜度兜底 → completed。
const DEFAULT_DSH_WEB_PORT = 3080;
// 投影缓存 mtime 在 harness 运行期间持续刷新；超过该时长未写入视为 harness 已停止
const DSH_PROJCACHE_ACTIVE_MS = 60 * 1000;

/**
 * dsh 数据目录：DSH_HOME 环境变量优先，否则 ~/.dsh
 * @returns {string}
 */
function getDshHomePath() {
  return (process.env.DSH_HOME && String(process.env.DSH_HOME).trim())
    ? String(process.env.DSH_HOME).trim()
    : path.join(os.homedir(), '.dsh');
}

/**
 * 解析 dsh 投影缓存 JSON 内容 → 规范化会话行（纯函数，可单测）。
 * 只取组件需要的最小字段；timeUpdated 由 createDshAdapter 按转录文件补齐。
 * @param {string} raw session_projcache.json 内容
 * @returns {Array<{id: string, title: string, directory: string, timeCreated: number,
 *   openStep: ?Object, pendingCalls: Object, goalPhase: ?string, lastPromptAt: number}>}
 */
function parseDshProjection(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return [];
  }
  const table = data && data.tables && data.tables.sessions;
  if (!table || typeof table !== 'object') return [];
  const rows = [];
  for (const [id, entry] of Object.entries(table)) {
    if (!entry || typeof entry !== 'object' || !entry.identity) continue;
    const r = entry.rows || {};
    const stats = r.sessionStats && r.sessionStats.val ? r.sessionStats.val : null;
    const goal = r.goal && r.goal.val ? r.goal.val : null;
    const listMeta = r.sessionListMetadata && r.sessionListMetadata.val
      ? r.sessionListMetadata.val : null;
    rows.push({
      id,
      title: r.title && r.title.val ? String(r.title.val) : '',
      directory: typeof entry.identity.cwd === 'string' ? entry.identity.cwd : '',
      timeCreated: Number.isFinite(entry.identity.createdAt) ? entry.identity.createdAt : 0,
      openStep: stats ? stats.openStep : null,
      pendingCalls: stats && stats.pendingCalls && typeof stats.pendingCalls === 'object'
        ? stats.pendingCalls : {},
      goalPhase: goal && goal.goal ? goal.goal.phase : null,
      lastPromptAt: listMeta && Number.isFinite(listMeta.lastPromptAt) ? listMeta.lastPromptAt : 0
    });
  }
  return rows;
}

/**
 * 判定 dsh 会话状态：active（运行中）/ completed（已完成）/ interrupted（被中断/停滞）
 * 优先级：
 * - openStep 非空或 pendingCalls 非空 → active（harness 正在执行 LLM/工具步骤）
 * - goal.phase complete → completed；blocked/paused → interrupted
 * - 转录 mtime 在活跃窗口内 → active（无 goal 会话/回合间隙的兜底）
 * - goal 为 active 但已停止 → interrupted（未完成即停，如杀进程/手动中断）
 * - 其余 → completed
 * @param {{openStep: ?Object, pendingCalls: Object, goalPhase: ?string, timeUpdated: number}} session
 * @param {number} now 当前时间戳（ms）
 * @param {number} activeWindowMs 活跃判定窗口（ms）
 * @returns {'active'|'completed'|'interrupted'}
 */
function classifyDshSession(session, now, activeWindowMs) {
  if (session.openStep ||
      (session.pendingCalls && Object.keys(session.pendingCalls).length > 0)) {
    return 'active';
  }
  if (session.goalPhase === 'complete') return 'completed';
  if (session.goalPhase === 'blocked' || session.goalPhase === 'paused') return 'interrupted';
  if (typeof session.timeUpdated === 'number' && now - session.timeUpdated < activeWindowMs) {
    return 'active';
  }
  if (session.goalPhase === 'active') return 'interrupted';
  return 'completed';
}

/**
 * 判定 dsh 是否在运行：web 端口可达，或投影缓存仍在持续写入
 * （headless/纯 CLI 模式无 web 服务，但 harness 运行期间投影缓存照样刷新）。
 * @param {number} port web 端口（默认 3080）
 * @param {?Function} connectFn 端口连接函数（测试注入）
 * @param {?Function} statFn 文件 stat 函数（测试注入）
 * @param {?string} home 自定义数据目录（空 = DSH_HOME/~/.dsh）
 * @returns {Promise<boolean>}
 */
async function detectDshRunning(port = DEFAULT_DSH_WEB_PORT, connectFn = defaultConnect, statFn = fs.statSync, home) {
  if (connectFn) {
    try {
      if (await connectFn(port, 300)) return true;
    } catch (e) { /* 继续文件检测 */ }
  }
  try {
    const h = typeof home === 'string' && home.trim() ? home.trim() : getDshHomePath();
    const st = statFn(path.join(h, 'storages', 'session_projcache.json'));
    return st && Date.now() - st.mtimeMs < DSH_PROJCACHE_ACTIVE_MS;
  } catch (e) {
    return false;
  }
}

/**
 * 创建 dsh harness 适配器（依赖注入便于测试）
 * @param {{ home?: string, activeWindowMs?: number, now?: Function,
 *   readFileSync?: Function, statSync?: Function, readdirSync?: Function }} options
 *   home：dsh 数据目录，空 = DSH_HOME/~/.dsh；fs 三件套仅测试注入
 * @returns {{ id: string, displayName: string, lastError: string,
 *   listSessions: Function, getServerStatuses: Function, setHome: Function }}
 */
function createDshAdapter(options = {}) {
  const readFileSync = options.readFileSync || ((p) => fs.readFileSync(p, 'utf8'));
  const statSync = options.statSync || fs.statSync;
  const readdirSync = options.readdirSync || fs.readdirSync;
  const nowFn = options.now || (() => Date.now());
  let home = typeof options.home === 'string' && options.home.trim() ? options.home.trim() : '';
  const activeWindowMs = options.activeWindowMs || DEFAULT_ACTIVE_WINDOW_MS;
  let lastError = null;

  function homePath() {
    return home || getDshHomePath();
  }

  /**
   * 扫描 sessions 根目录，建立 会话id → session.jsonl.zstd 绝对路径 映射。
   * 目录名是项目路径的编码形式，不依赖编码规则，按"id 目录下找转录文件"反查即可。
   * @param {string} sessionsRoot
   * @returns {Map<string, string>}
   */
  function scanSessionTranscripts(sessionsRoot) {
    const map = new Map();
    let projects;
    try {
      projects = readdirSync(sessionsRoot, { withFileTypes: true });
    } catch (e) {
      return map;
    }
    for (const proj of projects) {
      if (!proj.isDirectory()) continue;
      let sessionDirs;
      try {
        sessionDirs = readdirSync(path.join(sessionsRoot, proj.name), { withFileTypes: true });
      } catch (e) {
        continue;
      }
      for (const sd of sessionDirs) {
        if (!sd.isDirectory()) continue;
        map.set(sd.name, path.join(sessionsRoot, proj.name, sd.name, 'session.jsonl.zstd'));
      }
    }
    return map;
  }

  return {
    id: 'dsh',
    displayName: 'DeepSeek Harness',
    get lastError() {
      return lastError;
    },

    /**
     * 只读查询 dsh 会话（投影缓存 + 转录文件 mtime）。
     * 会话量小（个位数到几十），全量重扫成本可忽略（readdir/stat 微秒级）。
     * @returns {Array<Object>} 规范化会话行（含 status，供轮询器直接使用）
     */
    listSessions() {
      lastError = null;
      const h = homePath();
      let raw;
      try {
        raw = readFileSync(path.join(h, 'storages', 'session_projcache.json'));
      } catch (e) {
        lastError = e.message;
        return [];
      }
      const rows = parseDshProjection(raw);
      if (rows.length === 0) return rows;
      const transcripts = scanSessionTranscripts(path.join(h, 'sessions'));
      const now = nowFn();
      for (const r of rows) {
        const tp = transcripts.get(r.id);
        if (tp) {
          try {
            r.timeUpdated = statSync(tp).mtimeMs;
          } catch (e) {
            r.timeUpdated = r.lastPromptAt || r.timeCreated;
          }
        } else {
          r.timeUpdated = r.lastPromptAt || r.timeCreated;
        }
        r.status = classifyDshSession(r, now, activeWindowMs);
      }
      // 与 opencode 适配器一致：最后活动时间倒序（活跃会话居顶）
      rows.sort((a, b) => b.timeUpdated - a.timeUpdated);
      return rows;
    },

    /**
     * dsh 无 server 校准通道（状态由投影缓存实时反映），返回空 Map
     * @returns {Promise<Map>}
     */
    async getServerStatuses() {
      return new Map();
    },

    /**
     * 运行时替换数据目录（设置中修改后生效，无需重启）
     * @param {string} newHome 空 = 默认（DSH_HOME/~/.dsh）
     */
    setHome(newHome) {
      home = typeof newHome === 'string' && newHome.trim() ? newHome.trim() : '';
    }
  };
}

// ============ Antigravity（谷歌反重力）适配器 ============
// 数据源：~/.gemini/antigravity/conversations/<会话uuid>.db —— 每个会话一个独立
// SQLite 库（10-30MB）。库内 steps 表无时间戳列、BLOB 为 protobuf（无正式 schema）：
// - 活跃度：db 文件 mtime 即该会话最后活动时间（实测与写入精确同步）
// - 状态：steps 末行 status —— 3=步骤完成（主流终态，非活跃会话的末行几乎都是
//   (15,3)）/ 9=运行中瞬态 / 2,6,7=异常态（疑似错误或取消）。映射为统一 part
//   类型后走共享 classifySession
// - 标题（尽力而为回退链）：brain/<uuid>/implementation_plan.md.metadata.json 的
//   summary → trajectory_metadata_blob 明文扫描出的工作区目录名 + 时间 → uuid
// 性能：每轮仅 stat 全部库文件（个位数，微秒级），mtime 未变的库直接命中内存
// 缓存，稳态零 SQLite 打开。只解析最近 mtime 的 30 个库，更老的会话库不碰。
const ANTIGRAVITY_CONVERSATION_LIMIT = 30;

/**
 * Antigravity 数据目录
 * @returns {string}
 */
function getAntigravityHomePath() {
  return path.join(os.homedir(), '.gemini', 'antigravity');
}

/**
 * steps 末行 status → 统一 part 类型语义（供 classifySession）：
 * 3（完成）→ step-finish；9（运行中）→ step-start；2/6/7（异常态）→ error；
 * 未知/无 steps → null（老会话语义 = 已完成）
 * @param {?number} status
 * @returns {?string}
 */
function mapAntigravityStepStatus(status) {
  if (status === 3) return 'step-finish';
  if (status === 9) return 'step-start';
  if (status === 2 || status === 6 || status === 7) return 'error';
  return null;
}

/**
 * 从 protobuf BLOB 中明文扫描 file:/// 工作区 URI（protobuf 文本字段是明文字节，
 * 无正式 schema，按 latin1 逐字节扫描避免多字节字符被截断）
 * @param {Buffer} blob
 * @returns {?string} 形如 f:/MyGame01 的路径；未找到返回 null
 */
function extractWorkspaceUri(blob) {
  if (!blob || !blob.length) return null;
  const m = /file:\/\/\/[A-Za-z]:[A-Za-z0-9%./_+-]+/.exec(blob.toString('latin1'));
  if (!m) return null;
  // 尾部点号多为 protobuf 后续字段的字节（0x2E 恰是 '.'），剪掉；Windows 路径本身不能以点结尾
  const raw = m[0].slice('file:///'.length).replace(/\.+$/, '');
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

/** 短日期时间（用于标题回退，纯数字避免 locale 差异） */
function formatShortDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 创建 Antigravity 适配器（依赖注入便于测试）
 * @param {{ home?: string, Database?: ?Function, readdirSync?: Function,
 *   statSync?: Function, readFileSync?: Function }} options
 * @returns {{ id: string, displayName: string, lastError: string, listSessions: Function }}
 */
function createAntigravityAdapter(options = {}) {
  const DB = Object.prototype.hasOwnProperty.call(options, 'Database') ? options.Database : getDatabaseModule();
  const readdirSync = options.readdirSync || fs.readdirSync;
  const statSync = options.statSync || fs.statSync;
  const readFileSync = options.readFileSync || ((p) => fs.readFileSync(p, 'utf8'));
  let home = typeof options.home === 'string' && options.home.trim() ? options.home.trim() : '';
  let lastError = null;
  // uuid → { mtimeMs, row }：mtime 未变不重开库（稳态零 SQLite 打开）
  const cache = new Map();

  function homePath() {
    return home || getAntigravityHomePath();
  }

  /** 读取 brain 计划摘要作为标题（尽力而为，任何失败返回 null） */
  function readBrainSummary(uuid) {
    try {
      const meta = JSON.parse(readFileSync(
        path.join(homePath(), 'brain', uuid, 'implementation_plan.md.metadata.json')));
      const summary = meta && typeof meta.summary === 'string' ? meta.summary.trim() : '';
      return summary ? summary.slice(0, 80) : null;
    } catch (e) {
      return null;
    }
  }

  /** 打开单个会话库解析：末步 status + 工作区路径（blob 不变，有旧值时不重查） */
  function parseConversationDb(file, prevDirectory) {
    let db = null;
    try {
      db = new DB(file, { readonly: true, fileMustExist: true });
      const last = db.prepare('SELECT status FROM steps ORDER BY idx DESC LIMIT 1').get();
      let directory = prevDirectory || '';
      if (!directory) {
        try {
          const row = db.prepare('SELECT data FROM trajectory_metadata_blob WHERE id = \'main\'').get();
          directory = row ? (extractWorkspaceUri(row.data) || '') : '';
        } catch (e) { /* 无 blob 表时保持空 */ }
      }
      return { lastPartType: mapAntigravityStepStatus(last ? last.status : null), directory };
    } finally {
      if (db) {
        try { db.close(); } catch (e) { /* 忽略 */ }
      }
    }
  }

  return {
    id: 'antigravity',
    displayName: 'Antigravity',
    get lastError() {
      return lastError;
    },

    /**
     * 只读查询 Antigravity 会话（conversations 目录 mtime + 增量开库）。
     * @returns {Array<Object>} 规范化会话行（无自带 status，由轮询器用共享规则判定）
     */
    listSessions() {
      lastError = null;
      const convRoot = path.join(homePath(), 'conversations');
      let names;
      try {
        names = readdirSync(convRoot);
      } catch (e) {
        lastError = e.message; // 未安装/目录不存在 → 静默空列表
        return [];
      }
      const dbs = [];
      for (const name of names) {
        if (!name.endsWith('.db')) continue;
        try {
          const st = statSync(path.join(convRoot, name));
          dbs.push({ uuid: name.slice(0, -3), file: path.join(convRoot, name), mtimeMs: st.mtimeMs });
        } catch (e) { /* 文件竞争消失，跳过 */ }
      }
      dbs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const top = dbs.slice(0, ANTIGRAVITY_CONVERSATION_LIMIT);
      const rows = [];
      for (const info of top) {
        const cached = cache.get(info.uuid);
        if (cached && cached.mtimeMs === info.mtimeMs) {
          rows.push(cached.row);
          continue;
        }
        try {
          const parsed = parseConversationDb(info.file, cached ? cached.row.directory : '');
          const folder = parsed.directory.split(/[\\/]/).filter(Boolean).pop() || '';
          const title = readBrainSummary(info.uuid) ||
            (folder ? `${folder} · ${formatShortDateTime(info.mtimeMs)}`
              : `Antigravity ${info.uuid.slice(0, 8)}`);
          const row = {
            id: info.uuid,
            title,
            directory: parsed.directory,
            timeUpdated: info.mtimeMs,
            // 库内无创建时间，用 mtime 近似（渲染端保留期只看 timeUpdated）
            timeCreated: info.mtimeMs,
            lastPartType: parsed.lastPartType
          };
          cache.set(info.uuid, { mtimeMs: info.mtimeMs, row });
          rows.push(row);
        } catch (e) {
          // 单个库解析失败（占用/表结构变化/原生模块缺失）：沿用旧缓存，无缓存则跳过
          if (cached) rows.push(cached.row);
        }
      }
      // 清理已不在结果中的缓存（会话被删除/跌出最近范围）
      const alive = new Set(top.map(d => d.uuid));
      for (const key of cache.keys()) {
        if (!alive.has(key)) cache.delete(key);
      }
      rows.sort((a, b) => b.timeUpdated - a.timeUpdated);
      return rows;
    }
  };
}

// ============ Codex 适配器 ============
// 数据源：~/.codex/state_*.sqlite 的 threads 表（id/title/cwd/updated_at[_ms]/
// archived/rollout_path；实测 updated_at 与 rollout 尾行 completed_at 精确同步）。
// threads 无 status 列：活跃 = updated_at 在活跃窗口内；回合是否正常结束看
// rollout JSONL 尾行（event_msg + payload.type=task_complete → 等价 step-finish）。
// state 库不存在时（旧版本）回退扫描 sessions/YYYY/MM/DD/rollout-*.jsonl。
// 注意 cwd 形如 \\?\F:\xx（Windows 扩展长度路径前缀），展示前需剥离。

/**
 * Codex 数据目录
 * @returns {string}
 */
function getCodexHomePath() {
  return path.join(os.homedir(), '.codex');
}

/**
 * 剥离 Windows 扩展长度路径前缀（\\?\）
 * @param {string} cwd
 * @returns {string}
 */
function stripExtendedPathPrefix(cwd) {
  if (typeof cwd !== 'string') return '';
  return cwd.replace(/^\\\\\?\\/, '');
}

/**
 * 读文件切片：start >= 0 时从偏移 start 读 length 字节；start < 0 时从文件尾部
 * 往回取 |start| 字节（length 忽略）。大 JSONL 只解析首/尾记录时使用，
 * 避免整文件读入（转录可达数十 MB）。
 * @param {string} file
 * @param {number} start
 * @param {number} length
 * @returns {Buffer}
 */
function defaultReadFileSlice(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const from = start < 0 ? Math.max(0, size + start) : Math.min(start, size);
    const len = Math.min(start < 0 ? size - from : length, size - from);
    if (len <= 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 解析 rollout JSONL 尾部文本的最后一条完整记录 → 统一 part 类型。
 * @param {string} text 尾部字节文本（首行可能不完整，会被丢弃）
 * @returns {?string} 'step-finish'（task_complete）| 'tool'（回合未完成）| null（无记录）
 */
function parseCodexTail(text) {
  if (!text) return null;
  // 从尾行向前找第一条可解析记录；被截断的首行 JSON.parse 失败会被自然跳过
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === 'event_msg' && obj.payload &&
          obj.payload.type === 'task_complete') {
        return 'step-finish';
      }
      return 'tool';
    } catch (e) { /* 半行/非 JSON 继续向前找 */ }
  }
  return null;
}

/**
 * 创建 Codex 适配器（依赖注入便于测试）
 * @param {{ home?: string, Database?: ?Function, readdirSync?: Function,
 *   statSync?: Function, readFileSlice?: Function }} options
 * @returns {{ id: string, displayName: string, lastError: string, listSessions: Function }}
 */
function createCodexAdapter(options = {}) {
  const DB = Object.prototype.hasOwnProperty.call(options, 'Database') ? options.Database : getDatabaseModule();
  const readdirSync = options.readdirSync || fs.readdirSync;
  const statSync = options.statSync || fs.statSync;
  const readFileSlice = options.readFileSlice || defaultReadFileSlice;
  let home = typeof options.home === 'string' && options.home.trim() ? options.home.trim() : '';
  let db = null;
  let stmtThreads = null;
  let lastError = null;
  // id → { updatedAt, lastPartType }：rollout 尾行只在会话更新后重读
  const tailCache = new Map();

  function homePath() {
    return home || getCodexHomePath();
  }

  /** 选版本号最高的 state_*.sqlite（state_4/state_5 并存时取新，兼容未来版本） */
  function findStateDb() {
    let entries;
    try {
      entries = readdirSync(homePath());
    } catch (e) {
      return null;
    }
    let best = null;
    let bestVer = -1;
    for (const name of entries) {
      const m = /^state_(\d+)\.sqlite$/.exec(name);
      if (!m) continue;
      const ver = parseInt(m[1], 10);
      if (ver > bestVer) {
        bestVer = ver;
        best = path.join(homePath(), name);
      }
    }
    return best;
  }

  function openDb(statePath) {
    if (db) return true;
    if (!DB) {
      lastError = 'better-sqlite3 未加载（原生模块缺失）';
      return false;
    }
    try {
      db = new DB(statePath, { readonly: true, fileMustExist: true });
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
      stmtThreads = null;
    }
  }

  /** threads 行时间：优先毫秒列，缺失时秒列 ×1000 */
  function rowTimeUpdated(r) {
    if (Number.isFinite(r.updated_at_ms) && r.updated_at_ms > 0) return r.updated_at_ms;
    return Number.isFinite(r.updated_at) ? r.updated_at * 1000 : 0;
  }

  /** rollout 尾行 → part 类型（带 updatedAt 缓存，未更新的会话不重读文件） */
  function lastPartTypeOf(r) {
    const updatedAt = rowTimeUpdated(r);
    const cached = tailCache.get(r.id);
    if (cached && cached.updatedAt === updatedAt) return cached.lastPartType;
    let lastPartType = null;
    if (typeof r.rollout_path === 'string' && r.rollout_path) {
      try {
        lastPartType = parseCodexTail(readFileSlice(r.rollout_path, -4096, 0).toString('utf8'));
      } catch (e) { /* 文件被移动/删除 → null（按老会话处理） */ }
    }
    tailCache.set(r.id, { updatedAt, lastPartType });
    return lastPartType;
  }

  /** 回退：扫描 sessions/YYYY/MM/DD/rollout-*.jsonl（无 state 库的旧版本，
   * 标题/目录尽力而为——文件名时间戳当标题，cwd 缺失为空） */
  function scanRollouts() {
    const sessionsRoot = path.join(homePath(), 'sessions');
    const found = [];
    try {
      for (const year of readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!year.isDirectory()) continue;
        for (const month of readdirSync(path.join(sessionsRoot, year.name), { withFileTypes: true })) {
          if (!month.isDirectory()) continue;
          const daysRoot = path.join(sessionsRoot, year.name, month.name);
          for (const day of readdirSync(daysRoot, { withFileTypes: true })) {
            if (!day.isDirectory()) continue;
            const filesRoot = path.join(daysRoot, day.name);
            for (const f of readdirSync(filesRoot)) {
              if (!f.endsWith('.jsonl')) continue;
              const file = path.join(filesRoot, f);
              try {
                found.push({ file, mtimeMs: statSync(file).mtimeMs });
              } catch (e) { /* 文件竞争消失，跳过 */ }
            }
          }
        }
      }
    } catch (e) {
      lastError = e.message;
      return [];
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const rows = [];
    for (const f of found.slice(0, SESSION_LIMIT)) {
      const base = path.basename(f.file, '.jsonl');
      // 文件名内嵌完整会话 uuid（时间戳本身含 -，不能按 - 切分）
      const idMatch = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(base);
      const tsMatch = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/.exec(base);
      let lastPartType = null;
      try {
        lastPartType = parseCodexTail(readFileSlice(f.file, -4096, 0).toString('utf8'));
      } catch (e) { /* 读取失败按老会话处理 */ }
      rows.push({
        id: idMatch ? idMatch[0] : base,
        title: tsMatch ? tsMatch[1] : base.slice(0, 80),
        directory: '',
        timeUpdated: f.mtimeMs,
        timeCreated: f.mtimeMs,
        lastPartType
      });
    }
    return rows;
  }

  return {
    id: 'codex',
    displayName: 'Codex',
    get lastError() {
      return lastError;
    },

    /**
     * 只读查询 Codex 会话（state 库 threads 表 + rollout 尾行）。
     * @returns {Array<Object>} 规范化会话行（无自带 status，由轮询器用共享规则判定）
     */
    listSessions() {
      lastError = null;
      const statePath = findStateDb();
      if (!statePath) return scanRollouts();
      if (!openDb(statePath)) return [];
      try {
        if (!stmtThreads) {
          try {
            stmtThreads = db.prepare(
              `SELECT id, title, first_user_message, cwd, created_at, created_at_ms,
                      updated_at, updated_at_ms, rollout_path
               FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?`);
          } catch (e) {
            // 旧版本无 *_ms 列：补 NULL 保持行结构一致
            stmtThreads = db.prepare(
              `SELECT id, title, first_user_message, cwd, created_at, NULL AS created_at_ms,
                      updated_at, NULL AS updated_at_ms, rollout_path
               FROM threads WHERE archived = 0 ORDER BY updated_at DESC LIMIT ?`);
          }
        }
        const rows = stmtThreads.all(SESSION_LIMIT);
        return rows.map(r => ({
          id: r.id,
          title: String(r.title || r.first_user_message || '').slice(0, 80),
          directory: stripExtendedPathPrefix(r.cwd),
          timeUpdated: rowTimeUpdated(r),
          timeCreated: Number.isFinite(r.created_at_ms) && r.created_at_ms > 0
            ? r.created_at_ms
            : (Number.isFinite(r.created_at) ? r.created_at * 1000 : 0),
          lastPartType: lastPartTypeOf(r)
        }));
      } catch (e) {
        lastError = e.message;
        closeDb();
        return [];
      }
    }
  };
}

// ============ Claude Code 适配器 ============
// 数据源：~/.claude/projects/<项目路径编码>/<会话uuid>.jsonl（官方标准布局）。
// 每行 JSON 自带 sessionId/cwd/timestamp；回合结束标记 = type:'result' 行
// （subtype success=正常完成，error_*=异常）；文件 mtime 即最后活动时间。
// 不支持 oh-my-opencode 的 transcripts/ 变体：无完成标记，静止会话会全部
// 误判为"被中断"，不纳入监控。

const CLAUDE_HEAD_BYTES = 16384;
const CLAUDE_TAIL_BYTES = 4096;

/**
 * Claude Code 数据目录
 * @returns {string}
 */
function getClaudeHomePath() {
  return path.join(os.homedir(), '.claude');
}

/**
 * 解析 jsonl 头部行数组 → 会话元信息（纯函数，可单测）。
 * 标题优先 summary 行，其次首条用户消息文本；工具结果/系统注入（< 开头）跳过。
 * @param {string[]} lines
 * @returns {{sessionId: string, cwd: string, title: string, timeCreated: number}}
 */
function parseClaudeHead(lines) {
  const out = { sessionId: '', cwd: '', title: '', timeCreated: 0 };
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const s = typeof line === 'string' ? line.trim() : '';
    if (!s) continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch (e) {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (!out.sessionId && typeof obj.sessionId === 'string') out.sessionId = obj.sessionId;
    if (!out.cwd && typeof obj.cwd === 'string') out.cwd = obj.cwd;
    if (!out.timeCreated && typeof obj.timestamp === 'string') {
      const t = Date.parse(obj.timestamp);
      if (Number.isFinite(t)) out.timeCreated = t;
    }
    if (!out.title) {
      if (obj.type === 'summary' && typeof obj.summary === 'string' && obj.summary.trim()) {
        out.title = obj.summary.trim();
      } else if (obj.type === 'user' && obj.message) {
        const content = obj.message.content;
        const text = typeof content === 'string' ? content
          : Array.isArray(content)
            ? content.filter(c => c && c.type === 'text' && typeof c.text === 'string')
              .map(c => c.text).join(' ')
            : '';
        const trimmed = text.trim();
        if (trimmed && !trimmed.startsWith('<')) out.title = trimmed;
      }
    }
    if (out.sessionId && out.cwd && out.title && out.timeCreated) break;
  }
  out.title = out.title.slice(0, 80);
  return out;
}

/**
 * 解析 jsonl 尾部文本最后一条完整记录 → 统一 part 类型（纯函数，可单测）。
 * @param {string} text 尾部字节文本（首行可能不完整，会被丢弃）
 * @returns {?string} 'step-finish'（result/success）| 'error'（result/error_*）| 'tool'
 */
function parseClaudeTail(text) {
  if (!text) return null;
  // 从尾行向前找第一条可解析记录；被截断的首行 JSON.parse 失败会被自然跳过
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === 'result') {
        return obj.subtype === 'success' ? 'step-finish' : 'error';
      }
      return 'tool';
    } catch (e) { /* 半行/非 JSON 继续向前找 */ }
  }
  return null;
}

/**
 * 创建 Claude Code 适配器（依赖注入便于测试）
 * @param {{ home?: string, readdirSync?: Function, statSync?: Function,
 *   readFileSlice?: Function }} options
 * @returns {{ id: string, displayName: string, lastError: string, listSessions: Function }}
 */
function createClaudeAdapter(options = {}) {
  const readdirSync = options.readdirSync || fs.readdirSync;
  const statSync = options.statSync || fs.statSync;
  const readFileSlice = options.readFileSlice || defaultReadFileSlice;
  let home = typeof options.home === 'string' && options.home.trim() ? options.home.trim() : '';
  let lastError = null;
  // 文件路径 → { mtimeMs, row }：mtime 未变不重读文件
  const cache = new Map();

  function homePath() {
    return home || getClaudeHomePath();
  }

  return {
    id: 'claude',
    displayName: 'Claude Code',
    get lastError() {
      return lastError;
    },

    /**
     * 只读查询 Claude Code 会话（projects 目录扫描 + 首/尾增量解析）。
     * @returns {Array<Object>} 规范化会话行（无自带 status，由轮询器用共享规则判定）
     */
    listSessions() {
      lastError = null;
      const projectsRoot = path.join(homePath(), 'projects');
      let projectDirs;
      try {
        projectDirs = readdirSync(projectsRoot, { withFileTypes: true });
      } catch (e) {
        lastError = e.message; // 未安装/目录不存在 → 静默空列表
        return [];
      }
      const files = [];
      for (const pd of projectDirs) {
        if (!pd.isDirectory()) continue;
        let entries;
        try {
          entries = readdirSync(path.join(projectsRoot, pd.name));
        } catch (e) {
          continue;
        }
        for (const name of entries) {
          if (!name.endsWith('.jsonl')) continue;
          const file = path.join(projectsRoot, pd.name, name);
          try {
            files.push({ file, projName: pd.name, mtimeMs: statSync(file).mtimeMs });
          } catch (e) { /* 文件竞争消失，跳过 */ }
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const top = files.slice(0, SESSION_LIMIT);
      const rows = [];
      for (const f of top) {
        const cached = cache.get(f.file);
        if (cached && cached.mtimeMs === f.mtimeMs) {
          rows.push(cached.row);
          continue;
        }
        try {
          const headText = readFileSlice(f.file, 0, CLAUDE_HEAD_BYTES).toString('utf8');
          const headLines = headText.split('\n');
          if (headLines.length > 1) headLines.pop(); // 末行可能被截断
          const head = parseClaudeHead(headLines);
          const tailText = readFileSlice(f.file, -CLAUDE_TAIL_BYTES, 0).toString('utf8');
          const row = {
            id: head.sessionId || path.basename(f.file, '.jsonl'),
            title: head.title || f.projName,
            directory: head.cwd,
            timeUpdated: f.mtimeMs,
            timeCreated: head.timeCreated || f.mtimeMs,
            lastPartType: parseClaudeTail(tailText)
          };
          cache.set(f.file, { mtimeMs: f.mtimeMs, row });
          rows.push(row);
        } catch (e) {
          // 单文件解析失败：沿用旧缓存，无缓存则跳过
          if (cached) rows.push(cached.row);
        }
      }
      // 清理已不在结果中的缓存（会话文件被删除/跌出最近范围）
      const alive = new Set(top.map(f => f.file));
      for (const key of cache.keys()) {
        if (!alive.has(key)) cache.delete(key);
      }
      rows.sort((a, b) => b.timeUpdated - a.timeUpdated);
      return rows;
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
              // 适配器可自带状态判定（如 dsh 的 goal.phase/openStep 规则），
              // 缺省回落到统一的 classifySession（opencode 语义）
              status: s.status || classifySession(s, now, this.activeWindowMs)
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
  classifyDshSession,
  createAntigravityAdapter,
  createClaudeAdapter,
  createCodexAdapter,
  createDshAdapter,
  createOpencodeAdapter,
  createOpencodeServerStatusProvider,
  createZcodeAdapter,
  defaultReadFileSlice,
  detectDshRunning,
  detectOpencodeRunning,
  detectOpencodeRunningNow,
  extractWorkspaceUri,
  filterVisibleSessions,
  getAntigravityHomePath,
  getClaudeHomePath,
  getCodexHomePath,
  getDshHomePath,
  getOpencodeDbPath,
  getZcodeDbPath,
  hasProcessAsync,
  isValidSessionId,
  mapAntigravityStepStatus,
  normalizeOpencodeRow,
  parseClaudeHead,
  parseClaudeTail,
  parseCodexTail,
  parseDshProjection,
  parseLastPartType,
  parseSSEChunk,
  probeAnyPort,
  resetRuntimeSignal,
  stripExtendedPathPrefix,
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_DSH_WEB_PORT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SERVER_PORTS,
  ANTIGRAVITY_CONVERSATION_LIMIT,
  DSH_PROJCACHE_ACTIVE_MS,
  IDLE_OVERRIDE_WINDOW_MS,
  RUNTIME_CONFIRM_MS,
  STEP_FINISH_CONFIRM_MS
};
