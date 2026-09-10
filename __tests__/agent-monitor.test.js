// agent-monitor.test.js - agent 会话监控模块单元测试
const {
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
  detectDshRunning,
  extractWorkspaceUri,
  filterVisibleSessions,
  getDshHomePath,
  getOpencodeDbPath,
  getZcodeDbPath,
  isValidSessionId,
  mapAntigravityStepStatus,
  parseClaudeHead,
  parseClaudeTail,
  parseCodexTail,
  parseDshCacheRecord,
  parseDshProjection,
  parseLastPartType,
  parseSSEChunk,
  stripExtendedPathPrefix,
  DEFAULT_ACTIVE_WINDOW_MS,
  DEFAULT_DSH_WEB_PORT
} = require('../src/main/agent-monitor');

const NOW = 1786342368000;
const ACTIVE_MS = 120 * 1000;

describe('classifySession', () => {
  it('step-finish 未过确认窗口（<15s）→ active', () => {
    const s = { timeUpdated: NOW - 5000, lastPartType: 'step-finish' };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('active');
  });

  it('step-finish 已过确认窗口（≥15s）→ completed（无需等活跃阈值）', () => {
    const s = { timeUpdated: NOW - 20 * 1000, lastPartType: 'step-finish' };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('活跃窗口内中途 part（text）→ active', () => {
    const s = { timeUpdated: NOW - 5000, lastPartType: 'text' };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('active');
  });

  it('活跃窗口边缘 step-finish（已过确认窗口）→ completed', () => {
    const s = { timeUpdated: NOW - ACTIVE_MS + 1, lastPartType: 'step-finish' };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('静止且最后是 step-finish → completed', () => {
    const s = { timeUpdated: NOW - 10 * 60 * 1000, lastPartType: 'step-finish' };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('静止且无 part 数据（老会话）→ completed', () => {
    const s = { timeUpdated: NOW - 10 * 60 * 1000, lastPartType: null };
    expect(classifySession(s, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('静止且最后是中途 part（text/reasoning/tool）→ interrupted', () => {
    for (const type of ['text', 'reasoning', 'tool', 'step-start']) {
      const s = { timeUpdated: NOW - 10 * 60 * 1000, lastPartType: type };
      expect(classifySession(s, NOW, ACTIVE_MS)).toBe('interrupted');
    }
  });
});

describe('filterVisibleSessions', () => {
  const sessions = [
    { id: 'a', status: 'active' },
    { id: 'b', status: 'completed' },
    { id: 'c', status: 'interrupted' },
    { id: 'd', status: 'completed' }
  ];

  it('活跃会话始终显示，即使已读', () => {
    const visible = filterVisibleSessions(sessions, ['a']);
    expect(visible.map(s => s.id)).toContain('a');
  });

  it('已读的非活跃会话被隐藏', () => {
    const visible = filterVisibleSessions(sessions, ['b', 'c']);
    const ids = visible.map(s => s.id);
    expect(ids).toContain('a');
    expect(ids).toContain('d');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
  });

  it('空已读列表 → 全部显示', () => {
    const visible = filterVisibleSessions(sessions, []);
    expect(visible).toHaveLength(4);
  });

  it('readIds 非数组时容错', () => {
    expect(filterVisibleSessions(sessions, null)).toHaveLength(4);
    expect(filterVisibleSessions(sessions, undefined)).toHaveLength(4);
  });

  it('已读后重新活跃的会话恢复显示', () => {
    const stale = [{ id: 'x', status: 'completed' }];
    expect(filterVisibleSessions(stale, ['x'])).toHaveLength(0);
    const resumed = [{ id: 'x', status: 'active' }];
    expect(filterVisibleSessions(resumed, ['x'])).toHaveLength(1);
  });
});

describe('isValidSessionId', () => {
  it('合法 id（ses_ 前缀 + 字母数字）', () => {
    expect(isValidSessionId('ses_015dabbdbffe3At0qBgwQasb5C')).toBe(true);
  });

  it('非法输入（命令注入/非字符串）', () => {
    expect(isValidSessionId('x & echo pwned')).toBe(false);
    expect(isValidSessionId('a;rm -rf')).toBe(false);
    expect(isValidSessionId('a|b')).toBe(false);
    expect(isValidSessionId('../../etc')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(123)).toBe(false);
    expect(isValidSessionId('a b')).toBe(false);
  });
});

describe('parseLastPartType', () => {
  it('解析 JSON 中的 type 字段', () => {
    expect(parseLastPartType('{"type":"step-finish"}')).toBe('step-finish');
  });

  it('非法 JSON / 无 type → null', () => {
    expect(parseLastPartType('not json')).toBe(null);
    expect(parseLastPartType('{"a":1}')).toBe(null);
    expect(parseLastPartType(null)).toBe(null);
    expect(parseLastPartType(undefined)).toBe(null);
    expect(parseLastPartType(42)).toBe(null);
  });
});

describe('getOpencodeDbPath', () => {
  it('位于用户目录 .local/share/opencode', () => {
    const p = getOpencodeDbPath();
    expect(p).toContain('.local');
    expect(p).toContain('share');
    expect(p).toContain('opencode');
    expect(p.endsWith('opencode.db')).toBe(true);
  });
});

describe('detectOpencodeRunning', () => {
  const { detectOpencodeRunning, detectOpencodeRunningNow, hasProcessAsync, resetRuntimeSignal, RUNTIME_CONFIRM_MS } = require('../src/main/agent-monitor');

  beforeEach(() => resetRuntimeSignal());

  // 按进程名返回 tasklist 输出的 spawn mock（同步触发回调，兼容 fake timers）
  function tasklistSpawn(processes = []) {
    return (...args) => {
      const filter = args[1] && args[1][1]; // ['/FI', 'IMAGENAME eq X', '/NH']
      const name = filter ? filter.replace('IMAGENAME eq ', '') : '';
      const found = processes.includes(name);
      return {
        stdout: {
          on: (ev, cb) => {
            if (ev === 'data') cb(Buffer.from(found ? name + '  123 Console  1  10,000 K' : 'INFO: No tasks', 'utf8'));
          }
        },
        on: (ev, cb) => {
          if (ev === 'close') cb(0);
        }
      };
    };
  }

  it('Desktop 进程存在 → 运行中', async () => {
    expect(await detectOpencodeRunning(tasklistSpawn(['OpenCode.exe']))).toBe(true);
  });

  it('CLI/TUI 进程（opencode.exe）存在 → 运行中', async () => {
    expect(await detectOpencodeRunning(tasklistSpawn(['opencode.exe']))).toBe(true);
  });

  it('无进程但 server 可达（实时端口探测）→ 运行中', async () => {
    expect(await detectOpencodeRunning(tasklistSpawn([]), async () => true)).toBe(true);
  });

  it('无任何信号 + 确认期内 → 仍视为运行（防误锁）', async () => {
    const spawn = tasklistSpawn(['OpenCode.exe']);
    expect(await detectOpencodeRunning(spawn, async () => false)).toBe(true); // 记录信号
    // 模拟信号消失：换成无进程 spawn + 端口不通，确认期 15s 内
    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.now() + 8 * 1000);
      expect(await detectOpencodeRunning(tasklistSpawn([]), async () => false)).toBe(true);
      jest.setSystemTime(Date.now() + 10 * 1000); // 累计 18s > 15s
      expect(await detectOpencodeRunning(tasklistSpawn([]), async () => false)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('确认期常量为 15s', () => {
    expect(RUNTIME_CONFIRM_MS).toBe(15000);
  });

  it('detectOpencodeRunningNow 无缓存实时判定：无进程+端口不通 → false（不受确认期影响）', async () => {
    // 先让周期检测记录信号（确认期内）
    expect(await detectOpencodeRunning(tasklistSpawn(['OpenCode.exe']), async () => false)).toBe(true);
    // 实时判定不受确认期影响：进程消失 + 端口不通 → 立即 false
    expect(await detectOpencodeRunningNow(tasklistSpawn([]), async () => false)).toBe(false);
  });

  it('detectOpencodeRunningNow 绕过进程缓存：desktop 刚关闭 5s 缓存内也能判定 false', async () => {
    // 第一次：进程存在 → 缓存 true
    expect(await hasProcessAsync('OpenCode.exe', tasklistSpawn(['OpenCode.exe']))).toBe(true);
    // 进程消失后：缓存命中仍 true（周期检测会这样）
    expect(await hasProcessAsync('OpenCode.exe', tasklistSpawn([]))).toBe(true);
    // 但实时判定（noCache）能立即发现 false
    expect(await detectOpencodeRunningNow(tasklistSpawn([]), async () => false)).toBe(false);
  });

  it('detectOpencodeRunningNow 进程或端口任一存在 → true', async () => {
    expect(await detectOpencodeRunningNow(tasklistSpawn(['OpenCode.exe']), async () => false)).toBe(true);
    expect(await detectOpencodeRunningNow(tasklistSpawn([]), async () => true)).toBe(true);
  });

  it('hasProcessAsync 结果缓存 10s', async () => {
    let spawns = 0;
    const spawnFn = (...args) => {
      spawns++;
      return {
        stdout: { on: (ev, cb) => { if (ev === 'data') setTimeout(() => cb(Buffer.from('opencode.exe  123', 'utf8')), 0); } },
        on: (ev, cb) => { if (ev === 'close') setTimeout(cb, 0); }
      };
    };
    expect(await hasProcessAsync('opencode.exe', spawnFn)).toBe(true);
    expect(await hasProcessAsync('opencode.exe', spawnFn)).toBe(true);
    expect(spawns).toBe(1);
  });
});

describe('createOpencodeAdapter', () => {
  it('DB 不可用（未加载原生模块）时降级为空列表', () => {
    const adapter = createOpencodeAdapter({ Database: null });
    expect(adapter.listSessions()).toEqual([]);
  });

  it('listSessions 查询异常时降级为空列表并恢复可用', () => {
    const failingDb = {
      prepare: () => {
        throw new Error('database is locked');
      }
    };
    const adapter = createOpencodeAdapter({ Database: function FakeDb() { return failingDb; } });
    expect(adapter.listSessions()).toEqual([]);
    // 下次轮询继续重试（不再抛错）
    expect(adapter.listSessions()).toEqual([]);
  });
});

describe('applyServerStatus', () => {
  const base = { id: 'ses_x', status: 'completed', lastPartType: 'step-finish' };

  it('busy → active（权威覆盖推断）', () => {
    const statuses = new Map([['ses_x', 'busy']]);
    expect(applyServerStatus(base, statuses)).toBe('active');
  });

  it('retry → active（重试中仍在运行）', () => {
    const statuses = new Map([['ses_x', 'retry']]);
    expect(applyServerStatus(base, statuses)).toBe('active');
  });

  it('idle + step-finish → completed', () => {
    const statuses = new Map([['ses_x', 'idle']]);
    expect(applyServerStatus(base, statuses)).toBe('completed');
  });

  it('idle + 中途 part（tool/text）→ interrupted', () => {
    const statuses = new Map([['ses_x', 'idle']]);
    expect(applyServerStatus({ ...base, lastPartType: 'tool' }, statuses)).toBe('interrupted');
    expect(applyServerStatus({ ...base, lastPartType: 'text' }, statuses)).toBe('interrupted');
  });

  it('server 无该会话记录 → null（保留 DB 推断）', () => {
    const statuses = new Map([['ses_other', 'busy']]);
    expect(applyServerStatus(base, statuses)).toBe(null);
  });

  it('空 Map / 无 statuses → null', () => {
    expect(applyServerStatus(base, new Map())).toBe(null);
    expect(applyServerStatus(base, null)).toBe(null);
    expect(applyServerStatus(base, undefined)).toBe(null);
  });

  it('对象记录：新鲜 idle（事件 5s 前）→ 覆盖 completed', () => {
    const statuses = new Map([['ses_x', { status: 'idle', at: Date.now() - 5000 }]]);
    expect(applyServerStatus(base, statuses)).toBe('completed');
    expect(applyServerStatus({ ...base, lastPartType: 'tool' }, statuses)).toBe('interrupted');
  });

  it('对象记录：旧 idle（事件 2 分钟前）→ null（不覆盖，保留 DB 推断）', () => {
    const statuses = new Map([['ses_x', { status: 'idle', at: Date.now() - 120000 }]]);
    expect(applyServerStatus(base, statuses)).toBe(null);
    expect(applyServerStatus({ ...base, lastPartType: 'tool' }, statuses)).toBe(null);
  });

  it('对象记录：旧 busy 始终覆盖 → active（强信号不看时间）', () => {
    const statuses = new Map([['ses_x', { status: 'busy', at: Date.now() - 3600000 }]]);
    expect(applyServerStatus(base, statuses)).toBe('active');
  });
});

describe('parseSSEChunk', () => {
  it('解析单事件 / 多事件 / 非 JSON 容错', () => {
    const chunk = [
      'data: {"type":"server.connected","properties":{}}',
      '',
      'data: {"type":"session.status","properties":{"sessionID":"ses_1","status":{"type":"busy"}}}',
      '',
      'data: not-json',
      ''
    ].join('\n');
    const events = parseSSEChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('server.connected');
    expect(events[1].properties.status.type).toBe('busy');
  });

  it('空数据 / 无 data 行 → 空数组', () => {
    expect(parseSSEChunk('')).toEqual([]);
    expect(parseSSEChunk('event: foo\nid: 1\n\n')).toEqual([]);
  });

  it('跨块数据（前块无结尾空行）也能解析', () => {
    expect(parseSSEChunk('data: {"a":1}\n\n')).toHaveLength(1);
  });
});

describe('createOpencodeServerStatusProvider', () => {
  // SSE 流 mock：返回带 ReadableStream body 的响应
  function sseResponse(events) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const ev of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }
        controller.close();
      }
    });
    return { ok: true, body };
  }

  function makeFetch({ health = true, events = [] } = {}) {
    return async (url, init) => {
      if (url.endsWith('/global/health')) {
        return { ok: true, json: async () => ({ healthy: health, version: '1.18.15' }) };
      }
      if (url.endsWith('/event')) {
        return sseResponse(events);
      }
      return { ok: false };
    };
  }

  const liveProviders = [];
  function trackedProvider(options) {
    const p = createOpencodeServerStatusProvider(options);
    liveProviders.push(p);
    return p;
  }
  afterEach(() => {
    while (liveProviders.length) liveProviders.pop().dispose();
  });

  it('探测链：4948 不可达 → 4096 可达，SSE 订阅后返回 busy/idle 状态', async () => {
    const provider = trackedProvider({ 
      connectFn: async (port) => port === 4096,
      fetchFn: makeFetch({
        events: [
          { type: 'server.connected', properties: {} },
          { type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } },
          { type: 'session.status', properties: { sessionID: 'ses_2', status: { type: 'idle' } } }
        ]
      })
    });
    provider.getStatuses();
    // 等待 SSE 流异步送达
    await new Promise(r => setTimeout(r, 50));
    const statuses = provider.getStatuses();
    expect(statuses.get('ses_1').status).toBe('busy');
    expect(statuses.get('ses_2').status).toBe('idle');
    expect(typeof statuses.get('ses_1').at).toBe('number');
  });

  it('health 验证排除端口被无关程序占用', async () => {
    const provider = trackedProvider({ 
      connectFn: async () => true,
      fetchFn: makeFetch({ health: false })
    });
    provider.getStatuses();
    await new Promise(r => setTimeout(r, 50));
    expect(provider.getStatuses().size).toBe(0);
  });

  it('全部端口不可达 → 空 Map（纯 DB 模式）', async () => {
    const provider = trackedProvider({ 
      connectFn: async () => false,
      fetchFn: makeFetch()
    });
    provider.getStatuses();
    await new Promise(r => setTimeout(r, 50));
    expect(provider.getStatuses().size).toBe(0);
  });

  it('认证：设置了密码时带 Basic Auth，未设置时无 Authorization', async () => {
    const authCalls = [];
    const noAuthCalls = [];
    const withAuth = trackedProvider({ 
      username: 'opencode',
      password: 'secret123',
      connectFn: async () => true,
      fetchFn: async (url, init) => {
        authCalls.push({ url, headers: init && init.headers });
        return { ok: false };
      }
    });
    withAuth.getStatuses();
    await new Promise(r => setTimeout(r, 20));
    const expected = 'Basic ' + Buffer.from('opencode:secret123').toString('base64');
    expect(authCalls.some(c => c.url.includes('/global/health') && c.headers && c.headers.Authorization === expected)).toBe(true);

    const noAuth = trackedProvider({ 
      username: 'opencode',
      password: '', // 空字符串 = 无认证（显式覆盖环境变量）
      connectFn: async () => true,
      fetchFn: async (url, init) => {
        noAuthCalls.push({ url, headers: init && init.headers });
        return { ok: false };
      }
    });
    noAuth.getStatuses();
    await new Promise(r => setTimeout(r, 20));
    expect(noAuthCalls.some(c => c.url.includes('/global/health') && c.headers && c.headers.Authorization)).toBe(false);
  });

  it('server 返回 401 → 不订阅，状态保持空（回落）', async () => {
    const provider = trackedProvider({ 
      connectFn: async () => true,
      fetchFn: async (url) => {
        if (url.endsWith('/global/health')) return { ok: true, json: async () => ({ healthy: true }) };
        return { ok: false }; // /event 401
      }
    });
    provider.getStatuses();
    await new Promise(r => setTimeout(r, 50));
    expect(provider.getStatuses().size).toBe(0);
  });

  it('探测结果缓存：缓存有效期内不重复 connect', async () => {
    let connects = 0;
    const provider = trackedProvider({ 
      // 默认端口列表（4096）可达：一次探测 = 1 次 connect
      connectFn: async () => { connects++; return true; },
      fetchFn: makeFetch({ events: [{ type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } }] })
    });
    provider.getStatuses();
    await new Promise(r => setTimeout(r, 30));
    provider.getStatuses();
    await new Promise(r => setTimeout(r, 30));
    expect(connects).toBe(1); // 缓存期内第二次调用不重新探测
  });
});

describe('AgentMonitor', () => {
  it('adapter 提供 server 状态时覆盖推断（busy 覆盖 / idle 覆盖）', async () => {
    const adapter = {
      id: 'opencode',
      displayName: 'opencode',
      listSessions: () => [
        { id: 's1', title: 'T', directory: 'F:/p', agent: 'build', timeUpdated: NOW - 600000, lastPartType: 'tool' },
        { id: 's2', title: 'T2', directory: 'F:/p2', agent: 'plan', timeUpdated: NOW - 600000, lastPartType: 'step-finish' },
        { id: 's3', title: 'T3', directory: 'F:/p3', agent: 'build', timeUpdated: NOW - 3000, lastPartType: 'text' }
      ],
      getServerStatuses: async () => new Map([
        ['s1', 'busy'],   // 推断 interrupted → 覆盖 active
        ['s2', 'idle'],   // 推断 completed → 保持 completed
        ['s3', 'idle']    // 推断 active → 覆盖 interrupted（idle + text）
      ])
    };
    const monitor = new AgentMonitor({
      adapters: [adapter],
      activeWindowMs: ACTIVE_MS,
      now: () => NOW
    });
    await monitor.poll();
    const snap = monitor.getSnapshot();
    expect(snap.find(s => s.id === 's1').status).toBe('active');
    expect(snap.find(s => s.id === 's2').status).toBe('completed');
    expect(snap.find(s => s.id === 's3').status).toBe('interrupted');
  });

  it('server 状态为空时保持 DB 推断', async () => {
    const adapter = {
      id: 'opencode',
      displayName: 'opencode',
      listSessions: () => [
        { id: 's1', title: 'T', directory: 'F:/p', agent: 'build', timeUpdated: NOW - 600000, lastPartType: 'tool' }
      ],
      getServerStatuses: async () => new Map()
    };
    const monitor = new AgentMonitor({ adapters: [adapter], activeWindowMs: ACTIVE_MS, now: () => NOW });
    await monitor.poll();
    expect(monitor.getSnapshot()[0].status).toBe('interrupted');
  });

  it('旧 idle 记录不覆盖 DB 推断（跨端继续会话不污染状态）', async () => {
    const adapter = {
      id: 'opencode',
      displayName: 'opencode',
      listSessions: () => [
        // s1: 最近活跃（timeUpdated 新鲜）→ DB 推断 active；但 serve 上有 2 分钟前的旧 idle 记录
        { id: 's1', title: 'T', directory: 'F:/p', agent: 'build', timeUpdated: NOW - 3000, lastPartType: 'text' }
      ],
      getServerStatuses: async () => new Map([
        ['s1', { status: 'idle', at: NOW - 120000 }]
      ])
    };
    const monitor = new AgentMonitor({ adapters: [adapter], activeWindowMs: ACTIVE_MS, now: () => NOW });
    await monitor.poll();
    expect(monitor.getSnapshot()[0].status).toBe('active');
  });

  it('start 后立即轮询，快照变化时推送（含状态判定），停止后不再轮询', () => {
    jest.useFakeTimers();
    try {
      let data = [
        { id: 's1', title: 'T', directory: 'F:/p', agent: 'build', timeUpdated: NOW - 3000, lastPartType: 'step-finish' },
        { id: 's2', title: 'T2', directory: 'F:/p2', agent: 'plan', timeUpdated: NOW - 600000, lastPartType: 'tool' }
      ];
      const adapter = {
        id: 'opencode',
        displayName: 'opencode',
        listSessions: () => data
      };
      const updates = [];
      const monitor = new AgentMonitor({
        adapters: [adapter],
        activeWindowMs: ACTIVE_MS,
        intervalMs: 2500,
        now: () => NOW,
        onUpdate: (sessions) => updates.push(sessions)
      });
      monitor.start();
      expect(updates).toHaveLength(1);
      expect(updates[0].map(s => s.status)).toEqual(['active', 'interrupted']);
      expect(updates[0][0].harness).toBe('opencode');
      expect(updates[0][0].harnessName).toBe('opencode');

      // 快照无变化 → 不推送
      jest.advanceTimersByTime(2500);
      expect(updates).toHaveLength(1);

      // 快照变化（新会话出现）→ 推送
      data = [
        { id: 's1', title: 'T', directory: 'F:/p', agent: 'build', timeUpdated: NOW - 3000, lastPartType: 'step-finish' },
        { id: 's2', title: 'T2', directory: 'F:/p2', agent: 'plan', timeUpdated: NOW - 600000, lastPartType: 'tool' },
        { id: 's3', title: 'T3', directory: 'F:/p3', agent: 'build', timeUpdated: NOW - 5000, lastPartType: 'text' }
      ];
      jest.advanceTimersByTime(2500);
      expect(updates).toHaveLength(2);
      expect(updates[1]).toHaveLength(3);

      monitor.stop();
      jest.advanceTimersByTime(10000);
      expect(updates).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('单个适配器异常不影响整体', () => {
    const bad = { id: 'bad', listSessions: () => { throw new Error('boom'); } };
    const good = {
      id: 'good',
      displayName: 'Good',
      listSessions: () => [{ id: 'g1', title: '', directory: '', agent: 'build', timeUpdated: NOW, lastPartType: 'step-finish' }]
    };
    const monitor = new AgentMonitor({
      adapters: [bad, good],
      activeWindowMs: ACTIVE_MS,
      now: () => NOW
    });
    monitor.poll();
    expect(monitor.getSnapshot()).toHaveLength(1);
    expect(monitor.getSnapshot()[0].harness).toBe('good');
  });

  it('默认活跃窗口为 120 秒', () => {
    expect(DEFAULT_ACTIVE_WINDOW_MS).toBe(120000);
  });
});

// ============ dsh（DeepSeek Harness）适配器 ============

describe('getDshHomePath', () => {
  const OLD_HOME = process.env.DSH_HOME;

  afterEach(() => {
    if (OLD_HOME === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = OLD_HOME;
  });

  it('DSH_HOME 优先', () => {
    process.env.DSH_HOME = 'D:/custom-dsh';
    expect(getDshHomePath()).toBe('D:/custom-dsh');
  });

  it('未设置时回落 ~/.dsh', () => {
    delete process.env.DSH_HOME;
    expect(getDshHomePath()).toContain('.dsh');
  });
});

describe('parseDshProjection', () => {
  const PROJ = JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: {
      sessions: {
        's1': {
          identity: { createdAt: 1000, cwd: 'F:\\Proj' },
          rows: {
            sessionStats: { ver: 1, seq: 10, val: { openStep: { turn: 1, step: 2 }, pendingCalls: {} } },
            title: { ver: 1, seq: 10, val: '任务A' },
            goal: { ver: 4, seq: 10, val: { goal: { phase: 'active', id: 'g1' } } },
            sessionListMetadata: { ver: 1, seq: 10, val: { blank: false, lastPromptAt: 5000 } }
          }
        },
        's2': {
          identity: { createdAt: 2000, cwd: 'F:\\Proj2' },
          rows: {
            sessionStats: { ver: 1, seq: 5, val: { openStep: null, pendingCalls: {} } },
            goal: { ver: 4, seq: 5, val: { goal: { phase: 'complete' } } }
          }
        },
        's3': {
          identity: { createdAt: 3000, cwd: 'F:\\Proj3' },
          rows: { goal: { ver: 4, seq: 1, val: { goal: { phase: 'blocked' } } } }
        }
      }
    }
  });

  it('解析投影缓存为规范化会话行', () => {
    const rows = parseDshProjection(PROJ);
    expect(rows).toHaveLength(3);
    const s1 = rows.find(r => r.id === 's1');
    expect(s1.title).toBe('任务A');
    expect(s1.directory).toBe('F:\\Proj');
    expect(s1.timeCreated).toBe(1000);
    expect(s1.openStep).toEqual({ turn: 1, step: 2 });
    expect(s1.goalPhase).toBe('active');
    expect(s1.lastPromptAt).toBe(5000);
    expect(rows.find(r => r.id === 's2').goalPhase).toBe('complete');
    expect(rows.find(r => r.id === 's3').goalPhase).toBe('blocked');
  });

  it('无 goal / 无 stats 的会话容错（字段缺省）', () => {
    const rows = parseDshProjection(JSON.stringify({
      tables: { sessions: { s9: { identity: { cwd: 'C:\\x' }, rows: {} } } }
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].goalPhase).toBeNull();
    expect(rows[0].openStep).toBeNull();
    expect(rows[0].title).toBe('');
  });

  it('非法输入 → 空数组', () => {
    expect(parseDshProjection(null)).toEqual([]);
    expect(parseDshProjection('not json')).toEqual([]);
    expect(parseDshProjection(JSON.stringify({ tables: {} }))).toEqual([]);
  });

  it('goal 行新形状（stateVersion 6：current.goal.phase）', () => {
    const rows = parseDshProjection(JSON.stringify({
      tables: {
        sessions: {
          s1: {
            identity: { cwd: 'C:\\x' },
            rows: {
              goal: { ver: 6, seq: 9, val: { current: { goal: { phase: 'paused' } }, seenGoalIds: [], failure: null } }
            }
          }
        }
      }
    }));
    expect(rows[0].goalPhase).toBe('paused');
  });

  it('goal 行无 goal / 结构未知 → goalPhase 为 null（不抛错）', () => {
    const phaseOf = (val) => parseDshProjection(JSON.stringify({
      tables: { sessions: { s1: { identity: { cwd: 'C:\\x' }, rows: { goal: { ver: 6, val } } } } }
    }))[0].goalPhase;
    expect(phaseOf({ current: null, seenGoalIds: [], failure: null })).toBeNull();
    expect(phaseOf(null)).toBeNull();
    expect(phaseOf({ current: { goal: {} } })).toBeNull();
    expect(phaseOf({ current: { goal: { phase: 42 } } })).toBeNull();
  });
});

describe('parseDshCacheRecord', () => {
  /** 每会话一文件记录（domain v4+）：{version, record:{identity, rows}} */
  const rec = (rows, version = 7, identity = { formatVersion: 3, createdAt: 7000, cwd: 'F:\\Proj' }) =>
    JSON.stringify({ version, record: { identity, rows } });

  it('解析记录为规范化行（id 取自文件名）', () => {
    const row = parseDshCacheRecord('session-abc', rec({
      title: { ver: 1, seq: 34, val: '新布局任务' },
      sessionStats: { ver: 1, seq: 34, val: { openStep: { turn: 1, step: 3 }, pendingCalls: { c1: 1 } } },
      goal: { ver: 6, seq: 34, val: { current: { goal: { phase: 'complete' } }, seenGoalIds: [], failure: null } },
      sessionListMetadata: { ver: 1, seq: 34, val: { blank: false, lastPromptAt: 8000 } }
    }));
    expect(row.id).toBe('session-abc');
    expect(row.title).toBe('新布局任务');
    expect(row.directory).toBe('F:\\Proj');
    expect(row.timeCreated).toBe(7000);
    expect(row.openStep).toEqual({ turn: 1, step: 3 });
    expect(row.goalPhase).toBe('complete');
    expect(row.lastPromptAt).toBe(8000);
    expect(row.cacheVersion).toBe(7); // 供漂移告警比对
  });

  it('结构不可用 → null（坏 JSON / 缺 record / 缺 identity / 空 id）', () => {
    expect(parseDshCacheRecord('s1', 'not json')).toBeNull();
    expect(parseDshCacheRecord('s1', JSON.stringify({ tables: {} }))).toBeNull();
    expect(parseDshCacheRecord('s1', JSON.stringify({ record: { rows: {} } }))).toBeNull();
    expect(parseDshCacheRecord('', rec({}))).toBeNull();
    expect(parseDshCacheRecord('s1', null)).toBeNull();
  });
});

describe('classifyDshSession', () => {
  const NOW = 10000000;
  const ACTIVE_MS = 120 * 1000;

  it('openStep 非空 → active（即使 goal 已 complete，如目标完成后继续工作）', () => {
    const s = { openStep: { turn: 1, step: 1 }, pendingCalls: {}, goalPhase: 'complete', timeUpdated: NOW - 600000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('active');
  });

  it('pendingCalls 非空 → active', () => {
    const s = { openStep: null, pendingCalls: { x: 1 }, goalPhase: 'active', timeUpdated: NOW - 600000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('active');
  });

  it('goal complete → completed（无需等待活跃窗口）', () => {
    const s = { openStep: null, pendingCalls: {}, goalPhase: 'complete', timeUpdated: NOW - 5000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('goal blocked/paused → interrupted', () => {
    for (const phase of ['blocked', 'paused']) {
      const s = { openStep: null, pendingCalls: {}, goalPhase: phase, timeUpdated: NOW - 5000 };
      expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('interrupted');
    }
  });

  it('活跃窗口内（转录文件在写）→ active（无 goal 会话/回合间隙兜底）', () => {
    const s = { openStep: null, pendingCalls: {}, goalPhase: null, timeUpdated: NOW - 3000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('active');
  });

  it('goal 为 active 但已停止（杀进程/手动中断）→ interrupted', () => {
    const s = { openStep: null, pendingCalls: {}, goalPhase: 'active', timeUpdated: NOW - 600000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('interrupted');
  });

  it('无 goal 且已静止 → completed', () => {
    const s = { openStep: null, pendingCalls: {}, goalPhase: null, timeUpdated: NOW - 600000 };
    expect(classifyDshSession(s, NOW, ACTIVE_MS)).toBe('completed');
  });
});

describe('createDshAdapter', () => {
  const path = require('path');
  const home = 'C:/fake-dsh';
  /** 新布局（每会话一文件）投影缓存目录 */
  const cacheDir = (h) => path.join(h, 'storages', 'session_projcache', 'sessions');

  /** 每会话一文件的记录内容（domain v4+） */
  function cacheRecord(identity, rows, version = 7) {
    return JSON.stringify({ version, record: { identity, rows } });
  }

  /** 构造注入式假文件系统：dirs = Map<目录路径, 子项名数组>；mtimes = [[路径, mtimeMs]]；
   *  projRaw = 注册在 home 的旧布局单文件；projRaws = 任意路径 → 内容（覆盖 projRaw）。
   *  mtimes 里出现的路径会自动补进其父目录的列举结果，因此转录文件的每一代都能被扫到；
   *  readCount 用于断言 mtime 缓存命中后不再重复读文件。 */
  function makeFs({ dirs, projRaw, projRaws, mtimes }) {
    const files = new Map();
    if (projRaw !== undefined) {
      files.set(path.join(home, 'storages', 'session_projcache.json'), projRaw);
    }
    if (projRaws) {
      for (const [p, raw] of Object.entries(projRaws)) files.set(p, raw);
    }
    const statTimes = new Map(mtimes || []);
    const dirEntries = new Map();
    for (const [p, names] of (dirs || new Map())) dirEntries.set(p, [...names]);
    for (const p of statTimes.keys()) {
      const parent = path.dirname(p);
      if (!dirEntries.has(parent)) dirEntries.set(parent, []);
      const base = path.basename(p);
      if (!dirEntries.get(parent).includes(base)) dirEntries.get(parent).push(base);
    }
    const fake = {
      readCount: 0,
      readFileSync(p) {
        fake.readCount += 1;
        if (!files.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return files.get(p);
      },
      statSync(p) {
        if (!statTimes.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return { mtimeMs: statTimes.get(p) };
      },
      readdirSync(p) {
        if (!dirEntries.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return dirEntries.get(p).map(name => ({ name, isDirectory: () => true }));
      }
    };
    return fake;
  }

  const PROJ = JSON.stringify({
    tables: {
      sessions: {
        's1': {
          identity: { createdAt: 1000, cwd: 'F:\\Proj' },
          rows: {
            sessionStats: { ver: 1, val: { openStep: null, pendingCalls: {} } },
            title: { ver: 1, val: '任务A' },
            goal: { ver: 4, val: { goal: { phase: 'complete' } } }
          }
        },
        's2': {
          identity: { createdAt: 2000, cwd: 'F:\\Proj2' },
          rows: {
            sessionStats: { ver: 1, val: { openStep: { turn: 1, step: 9 }, pendingCalls: {} } },
            title: { ver: 1, val: '任务B' }
          }
        }
      }
    }
  });

  it('listSessions 返回规范化行并带状态（mtime 新鲜度 + 状态判定）', () => {
    const fsx = makeFs({
      dirs: new Map([
        [path.join(home, 'sessions'), ['proj1', 'proj2']],
        [path.join(home, 'sessions', 'proj1'), ['s1']],
        [path.join(home, 'sessions', 'proj2'), ['s2']]
      ]),
      projRaw: PROJ,
      mtimes: [
        [path.join(home, 'sessions', 'proj1', 's1', 'session.jsonl.zstd'), NOW - 600000],
        [path.join(home, 'sessions', 'proj2', 's2', 'session.jsonl.zstd'), NOW - 3000]
      ]
    });
    const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(2);
    // 最后活动倒序：s2（活跃）居顶
    expect(rows[0].id).toBe('s2');
    expect(rows[0].status).toBe('active');
    expect(rows[0].timeUpdated).toBe(NOW - 3000);
    expect(rows[1].id).toBe('s1');
    expect(rows[1].status).toBe('completed');
    expect(rows[1].timeUpdated).toBe(NOW - 600000);
  });

  it('投影缓存缺失/非法 → 空列表（降级，不抛错）', () => {
    // 文件存在但内容非法
    const bad = makeFs({ dirs: new Map(), projRaw: 'not json' });
    const adapterBad = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...bad });
    expect(adapterBad.listSessions()).toEqual([]);
    // 文件缺失（读失败记录 lastError，下次轮询重试）
    const missing = makeFs({ dirs: new Map() });
    const adapterMissing = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...missing });
    expect(adapterMissing.listSessions()).toEqual([]);
    expect(typeof adapterMissing.lastError).toBe('string');
  });

  it('无转录文件时用 createdAt 兜底 timeUpdated', () => {
    const fsx = makeFs({ dirs: new Map([[path.join(home, 'sessions'), []]]), projRaw: PROJ });
    const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(2);
    // s1/s2 都无转录文件：timeUpdated 回落 createdAt（1000/2000）
    expect(rows.find(r => r.id === 's1').timeUpdated).toBe(1000);
    expect(rows.find(r => r.id === 's2').timeUpdated).toBe(2000);
    // s1 goal complete → completed；s2 openStep 非空 → active（不受时间兜底影响）
    expect(rows.find(r => r.id === 's1').status).toBe('completed');
    expect(rows.find(r => r.id === 's2').status).toBe('active');
  });

  it('setHome 可运行时切换数据目录', () => {
    const home2 = 'C:/fake-dsh2';
    const fsx = makeFs({
      dirs: new Map([
        [path.join(home, 'sessions'), []],
        [path.join(home2, 'sessions'), ['p']],
        [path.join(home2, 'sessions', 'p'), ['sA']]
      ]),
      projRaws: {
        [path.join(home, 'storages', 'session_projcache.json')]:
          JSON.stringify({ tables: { sessions: {} } }),
        [path.join(home2, 'storages', 'session_projcache.json')]:
          JSON.stringify({ tables: { sessions: { sA: { identity: { cwd: 'C:\\a' }, rows: {} } } } })
      },
      mtimes: [[path.join(home2, 'sessions', 'p', 'sA', 'session.jsonl.zstd'), NOW - 1000]]
    });
    const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
    expect(adapter.listSessions()).toEqual([]); // 原目录无数据
    adapter.setHome(home2);
    expect(adapter.listSessions()).toHaveLength(1);
  });

  it('轮询器优先使用适配器自带 status，缺省回落 classifySession', async () => {
    const adapter = {
      id: 'dsh',
      displayName: 'DeepSeek Harness',
      listSessions: () => [
        { id: 'd1', title: '', directory: '', agent: 'dsh', timeUpdated: NOW - 3000, status: 'active' },
        { id: 'd2', title: '', directory: '', agent: 'dsh', timeUpdated: NOW - 600000, status: 'interrupted' }
      ]
    };
    const monitor = new AgentMonitor({ adapters: [adapter], activeWindowMs: ACTIVE_MS, now: () => NOW });
    await monitor.poll();
    const snap = monitor.getSnapshot();
    expect(snap[0].status).toBe('active');
    expect(snap[1].status).toBe('interrupted');
    expect(snap[0].harness).toBe('dsh');
    expect(snap[0].harnessName).toBe('DeepSeek Harness');
  });

  // ---- 新布局（domain v4+ 每会话一文件）：harness 升级后的主通路 ----

  /** 新布局 + 两代转录名的最小假 fs */
  function newLayoutFs({ extraCacheFiles, legacyProjRaw } = {}) {
    const dir = cacheDir(home);
    return makeFs({
      dirs: new Map([
        [dir, ['s1.json', 's2.json', ...(extraCacheFiles || [])]],
        [path.join(home, 'sessions'), ['p1']],
        [path.join(home, 'sessions', 'p1'), ['s1', 's2']]
      ]),
      projRaw: legacyProjRaw,
      projRaws: {
        [path.join(dir, 's1.json')]: cacheRecord({ createdAt: 1000, cwd: 'F:\\Proj' }, {
          title: { ver: 1, val: '任务A' },
          goal: { ver: 6, val: { current: { goal: { phase: 'complete' } }, seenGoalIds: [], failure: null } }
        }),
        [path.join(dir, 's2.json')]: cacheRecord({ createdAt: 2000, cwd: 'F:\\Proj2' }, {
          title: { ver: 1, val: '任务B' },
          sessionStats: { ver: 1, val: { openStep: { turn: 1, step: 9 }, pendingCalls: {} } }
        })
      },
      mtimes: [
        [path.join(dir, 's1.json'), NOW - 1000],
        [path.join(dir, 's2.json'), NOW - 1000],
        [path.join(home, 'sessions', 'p1', 's1', 'session.v3.jsonl.zstd'), NOW - 600000],
        [path.join(home, 'sessions', 'p1', 's2', 'session.v3.jsonl.zstd'), NOW - 3000]
      ]
    });
  }

  it('新布局为主：读取每会话一文件 + 新代号转录 mtime + 状态判定', () => {
    const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...newLayoutFs() });
    const rows = adapter.listSessions();
    expect(adapter.lastError).toBeNull();
    expect(rows).toHaveLength(2);
    // 最后活动倒序：s2（活跃）居顶
    expect(rows[0].id).toBe('s2');
    expect(rows[0].status).toBe('active');
    expect(rows[0].timeUpdated).toBe(NOW - 3000); // session.v3.jsonl.zstd 的 mtime
    expect(rows[0].title).toBe('任务B');
    expect(rows[1].id).toBe('s1');
    expect(rows[1].status).toBe('completed'); // goal.phase=complete（新形状 current.goal）
    expect(rows[1].timeUpdated).toBe(NOW - 600000);
  });

  it('新布局存在时忽略旧单文件（回归：升级后旧文件原地留存 → 曾静默给出陈旧列表）', () => {
    const staleLegacy = JSON.stringify({
      unit: { name: 'session_projcache', version: 3 },
      tables: { sessions: { stale1: { identity: { createdAt: 1, cwd: 'C:\\old' }, rows: {} } } }
    });
    const adapter = createDshAdapter({
      home, activeWindowMs: ACTIVE_MS, now: () => NOW,
      ...newLayoutFs({ legacyProjRaw: staleLegacy })
    });
    const rows = adapter.listSessions();
    expect(rows.map(r => r.id).sort()).toEqual(['s1', 's2']); // stale1 不得出现
  });

  it('缓存目录缺失时回退旧单文件布局（升级前的 harness）', () => {
    const adapter = createDshAdapter({
      home, activeWindowMs: ACTIVE_MS, now: () => NOW,
      ...makeFs({ dirs: new Map([[path.join(home, 'sessions'), []]]), projRaw: PROJ })
    });
    expect(adapter.listSessions()).toHaveLength(2);
  });

  it('同一会话多代转录并存：先比 mtime，mtime 不可得再比格式代号', () => {
    const sdir = path.join(home, 'sessions', 'p', 's1');
    const v0 = path.join(sdir, 'session.jsonl.zstd');
    const v3 = path.join(sdir, 'session.v3.jsonl.zstd');
    const mk = (mtimes) => makeFs({
      dirs: new Map([
        [cacheDir(home), ['s1.json']],
        [path.join(home, 'sessions'), ['p']],
        [path.join(home, 'sessions', 'p'), ['s1']],
        [sdir, ['session.jsonl.zstd', 'session.v3.jsonl.zstd']]
      ]),
      projRaws: {
        [path.join(cacheDir(home), 's1.json')]:
          cacheRecord({ createdAt: 1000, cwd: 'F:\\Proj' }, {})
      },
      mtimes
    });
    // 两代都有 mtime → 取更新的那一份（即便格式代号更低）
    const a1 = createDshAdapter({
      home, activeWindowMs: ACTIVE_MS, now: () => NOW,
      ...mk([[v0, NOW - 1000], [v3, NOW - 900000]])
    });
    expect(a1.listSessions()[0].timeUpdated).toBe(NOW - 1000);
    // 只有高代号那份可 stat（迁移中间态）→ 回落代号更高的一份
    const a2 = createDshAdapter({
      home, activeWindowMs: ACTIVE_MS, now: () => NOW,
      ...mk([[v3, NOW - 2000]])
    });
    expect(a2.listSessions()[0].timeUpdated).toBe(NOW - 2000);
  });

  it('忽略 backup-and-skip 产物与非记录文件', () => {
    const adapter = createDshAdapter({
      home, activeWindowMs: ACTIVE_MS, now: () => NOW,
      ...newLayoutFs({ extraCacheFiles: ['s1.json.bak.20260910', 'notes.txt'] })
    });
    expect(adapter.listSessions()).toHaveLength(2);
  });

  it('mtime 未变的记录命中内存缓存，不重复读文件（轮询 2.5s 省 CPU）', () => {
    const fsx = newLayoutFs();
    const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
    adapter.listSessions();
    const first = fsx.readCount;
    expect(first).toBeGreaterThan(0);
    adapter.listSessions();
    expect(fsx.readCount).toBe(first); // 第二轮零读取（仅 stat/readdir）
  });

  it('domain 版本高于已适配版本 → lastError 告警且只打印一次（不再静默）', () => {
    const dir = cacheDir(home);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fsx = makeFs({
        dirs: new Map([[dir, ['s1.json']]]),
        projRaws: { [path.join(dir, 's1.json')]: cacheRecord({ createdAt: 1000, cwd: 'C:\\x' }, {}, 8) },
        mtimes: [[path.join(dir, 's1.json'), NOW - 1000]]
      });
      const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
      expect(adapter.listSessions()).toHaveLength(1); // 仍尽力返回数据
      expect(adapter.lastError).toMatch(/domain 版本 8/);
      adapter.listSessions();
      expect(warn).toHaveBeenCalledTimes(1); // 同一告警不刷屏
    } finally {
      warn.mockRestore();
    }
  });

  it('缓存未覆盖活跃转录 → lastError 告警（布局漂移金丝雀）', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fsx = makeFs({
        dirs: new Map([
          [path.join(home, 'sessions'), ['p']],
          [path.join(home, 'sessions', 'p'), ['s1', 'sNew']]
        ]),
        projRaw: JSON.stringify({
          tables: {
            sessions: { s1: { identity: { createdAt: 1000, cwd: 'F:\\Proj' }, rows: {} } }
          }
        }),
        mtimes: [
          [path.join(home, 'sessions', 'p', 's1', 'session.v3.jsonl.zstd'), NOW - 600000],
          [path.join(home, 'sessions', 'p', 'sNew', 'session.v3.jsonl.zstd'), NOW - 1000]
        ]
      });
      const adapter = createDshAdapter({ home, activeWindowMs: ACTIVE_MS, now: () => NOW, ...fsx });
      adapter.listSessions();
      expect(adapter.lastError).toMatch(/未覆盖/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('detectDshRunning', () => {
  const path = require('path');
  const home = 'C:/fake-dsh';
  const dir = path.join(home, 'storages', 'session_projcache', 'sessions');
  const legacy = path.join(home, 'storages', 'session_projcache.json');
  const throwEnoent = () => { throw new Error('ENOENT'); };
  /** 缓存目录列举：只认 dir，其余路径抛 ENOENT */
  const readdirCache = (names) => (p) => {
    if (p !== dir) throwEnoent();
    return names.map(name => ({ name, isDirectory: () => false }));
  };
  /** 只对指定路径返回 mtime，其余抛 ENOENT */
  const statOf = (entries) => (p) => {
    if (!(p in entries)) throwEnoent();
    return { mtimeMs: entries[p] };
  };

  it('端口可达 → true（无需文件）', async () => {
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => true, null);
    expect(ok).toBe(true);
  });

  it('端口不可达但新布局（每会话一文件）近期在写入 → true（headless 模式）', async () => {
    const statFn = statOf({ [path.join(dir, 's1.json')]: Date.now() - 5000 });
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false,
      statFn, home, readdirCache(['s1.json', 's2.json']));
    expect(ok).toBe(true);
  });

  it('新布局目录缺失 → 回退旧单文件 mtime（升级前的 harness）', async () => {
    const statFn = statOf({ [legacy]: Date.now() - 5000 });
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false,
      statFn, home, readdirCache([]));
    expect(ok).toBe(true);
  });

  it('端口不可达且投影缓存陈旧/缺失 → false', async () => {
    const stale = statOf({
      [path.join(dir, 's1.json')]: Date.now() - 600000,
      [legacy]: Date.now() - 600000
    });
    const noFiles = () => { throwEnoent(); };
    expect(await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false,
      throwEnoent, home, readdirCache([]))).toBe(false);
    expect(await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false,
      stale, home, readdirCache(['s1.json']))).toBe(false);
    // 缓存目录列举与 stat 都失败（未安装 dsh）
    expect(await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false,
      throwEnoent, home, noFiles)).toBe(false);
  });
});

// ============ ZCode 适配器（与 opencode 同族 schema，复用通用 SQLite 工厂） ============

const path = require('path');

/** 伪造 better-sqlite3 Database（按 SQL 形状分发，供通用 SQLite 适配器测试） */
function makeSqliteDbFactory({ sessions, parts }) {
  return function FakeDb() {
    return {
      prepare(sql) {
        if (/FROM session/.test(sql)) {
          return {
            all(limit) {
              let rows = sessions.filter(s => s.time_archived === null || s.time_archived === undefined);
              // zcode 过滤条件在 SQL 里，伪造层按相同语义过滤
              if (/task_type = 'interactive'/.test(sql)) {
                rows = rows.filter(s => s.task_type === 'interactive');
              }
              return [...rows].sort((a, b) => b.time_updated - a.time_updated).slice(0, limit);
            }
          };
        }
        if (/IN \(/.test(sql)) {
          return {
            all(...ids) {
              // 等价 SQL 语义：每个会话只取 time_created 最大的 part
              const latest = new Map();
              for (const p of parts) {
                if (!ids.includes(p.session_id)) continue;
                const cur = latest.get(p.session_id);
                if (!cur || p.time_created > cur.time_created) latest.set(p.session_id, p);
              }
              return [...latest.entries()].map(([sid, p]) => ({ sid, data: p.data }));
            }
          };
        }
        if (/FROM part WHERE session_id/.test(sql)) {
          return {
            get(sid) {
              const list = parts.filter(p => p.session_id === sid)
                .sort((a, b) => a.time_created - b.time_created);
              return list.length ? { data: list[list.length - 1].data } : undefined;
            }
          };
        }
        throw new Error('unexpected sql: ' + sql);
      },
      close() {}
    };
  };
}

describe('getZcodeDbPath', () => {
  const OLD = process.env.ZCODE_HOME;

  afterEach(() => {
    if (OLD === undefined) delete process.env.ZCODE_HOME;
    else process.env.ZCODE_HOME = OLD;
  });

  it('ZCODE_HOME 优先', () => {
    process.env.ZCODE_HOME = 'D:/zc-root';
    expect(getZcodeDbPath()).toBe(path.join('D:/zc-root', 'cli', 'db', 'db.sqlite'));
  });

  it('未设置时回落 ~/.zcode/cli/db/db.sqlite', () => {
    delete process.env.ZCODE_HOME;
    expect(getZcodeDbPath()).toContain(path.join('.zcode', 'cli', 'db', 'db.sqlite'));
  });
});

describe('createZcodeAdapter', () => {
  const sessions = [
    { id: 'sess_main', title: '主会话', directory: 'F:\\Proj', task_type: 'interactive',
      time_created: 1000, time_updated: NOW - 3000 },
    { id: 'sess_subagent_agent_x', title: '子代理任务原文……', directory: 'F:\\Proj',
      task_type: 'subagent_child', time_created: 1000, time_updated: NOW - 1000 }
  ];
  let parts = [
    { session_id: 'sess_main', time_created: NOW - 6000, data: JSON.stringify({ type: 'tool' }) },
    { session_id: 'sess_main', time_created: NOW - 3000,
      data: JSON.stringify({ type: 'step-finish', reason: 'stop' }) }
  ];

  it('DB 不可用时降级为空列表', () => {
    const adapter = createZcodeAdapter({ Database: null });
    expect(adapter.id).toBe('zcode');
    expect(adapter.displayName).toBe('ZCode');
    expect(adapter.listSessions()).toEqual([]);
  });

  it('过滤 subagent_child 子代理会话，主会话复用共享状态分类', () => {
    const adapter = createZcodeAdapter({
      dbPath: 'D:/fake/zcode.db',
      Database: makeSqliteDbFactory({ sessions, parts })
    });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess_main');
    expect(rows[0].title).toBe('主会话');
    expect(rows[0].directory).toBe('F:\\Proj');
    expect(rows[0].agent).toBe('default'); // zcode 无 agent 列 → 默认值
    expect(rows[0].lastPartType).toBe('step-finish');
    // 共享分类器：step-finish 未过 15s 确认窗 → active；过窗 → completed
    expect(classifySession(rows[0], NOW, ACTIVE_MS)).toBe('active');
    expect(classifySession({ ...rows[0], timeUpdated: NOW - 20 * 1000 }, NOW, ACTIVE_MS)).toBe('completed');
  });

  it('会话更新后增量查询刷新 last part', () => {
    const adapter = createZcodeAdapter({
      dbPath: 'D:/fake/zcode.db',
      Database: makeSqliteDbFactory({ sessions, parts })
    });
    expect(adapter.listSessions()[0].lastPartType).toBe('step-finish');
    // 模拟新一轮对话：session 更新 + 新 part（非 step-finish，运行中）。
    // 用 push 保持同一数组引用（伪造层闭包持有的就是该数组）
    sessions[0].time_updated = NOW - 1000;
    parts.push({
      session_id: 'sess_main', time_created: NOW - 1000, data: JSON.stringify({ type: 'text' })
    });
    const rows2 = adapter.listSessions();
    expect(rows2[0].timeUpdated).toBe(NOW - 1000);
    expect(rows2[0].lastPartType).toBe('text');
  });
});

describe('createOpencodeAdapter（通用工厂回归）', () => {
  it('会话数少于 100 时批量 last-part 查询不因占位符数量不匹配失败', () => {
    const sessions = [
      { id: 'ses_1', title: 'A', directory: 'F:\\A', agent: 'build',
        time_created: 1, time_updated: NOW - 5000 },
      { id: 'ses_2', title: 'B', directory: 'F:\\B', agent: 'plan',
        time_created: 2, time_updated: NOW - 600000 }
    ];
    const parts = [
      { session_id: 'ses_1', time_created: NOW - 5000, data: JSON.stringify({ type: 'step-finish' }) },
      { session_id: 'ses_2', time_created: NOW - 600000, data: JSON.stringify({ type: 'text' }) }
    ];
    const adapter = createOpencodeAdapter({
      dbPath: 'D:/fake/oc.db',
      Database: makeSqliteDbFactory({ sessions, parts })
    });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === 'ses_1').lastPartType).toBe('step-finish');
    expect(rows.find(r => r.id === 'ses_2').lastPartType).toBe('text');
  });

  it('AgentMonitor 合并 zcode 分组并按共享规则分类', async () => {
    const sessions = [
      { id: 'sess_m', title: 't', directory: 'F:\\P', task_type: 'interactive',
        time_created: 1, time_updated: NOW - 3000 }
    ];
    const parts = [
      { session_id: 'sess_m', time_created: NOW - 3000, data: JSON.stringify({ type: 'step-finish' }) }
    ];
    const monitor = new AgentMonitor({
      adapters: [createZcodeAdapter({ dbPath: 'x', Database: makeSqliteDbFactory({ sessions, parts }) })],
      activeWindowMs: ACTIVE_MS,
      now: () => NOW
    });
    await monitor.poll();
    const snap = monitor.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].harness).toBe('zcode');
    expect(snap[0].harnessName).toBe('ZCode');
    expect(snap[0].status).toBe('active');
  });
});

// ============ Antigravity（谷歌反重力）适配器 ============

describe('mapAntigravityStepStatus', () => {
  it('3=完成 → step-finish；9=运行中 → step-start；2/6/7=异常 → error', () => {
    expect(mapAntigravityStepStatus(3)).toBe('step-finish');
    expect(mapAntigravityStepStatus(9)).toBe('step-start');
    for (const s of [2, 6, 7]) expect(mapAntigravityStepStatus(s)).toBe('error');
  });

  it('未知值/无 steps → null（老会话 = 已完成语义）', () => {
    expect(mapAntigravityStepStatus(null)).toBeNull();
    expect(mapAntigravityStepStatus(undefined)).toBeNull();
    expect(mapAntigravityStepStatus(42)).toBeNull();
  });
});

describe('extractWorkspaceUri', () => {
  it('从 protobuf BLOB 明文扫描出工作区 URI', () => {
    const blob = Buffer.from('\x12\x0afile:///f:/MyGame01\x18\x03', 'latin1');
    expect(extractWorkspaceUri(blob)).toBe('f:/MyGame01');
  });

  it('百分号编码解码 / 无匹配 / 空入参 → null 或原文', () => {
    expect(extractWorkspaceUri(Buffer.from('file:///f:/My%20Game', 'latin1'))).toBe('f:/My Game');
    expect(extractWorkspaceUri(Buffer.from('no uri here', 'latin1'))).toBeNull();
    expect(extractWorkspaceUri(null)).toBeNull();
    expect(extractWorkspaceUri(Buffer.alloc(0))).toBeNull();
  });
});

describe('createAntigravityAdapter', () => {
  const home = 'C:/fake-ag';
  const convRoot = path.join(home, 'conversations');
  const convA = path.join(convRoot, 'aaaaaaaa-0000-0000-0000-000000000000.db');
  const convB = path.join(convRoot, 'bbbbbbbb-1111-1111-1111-111111111111.db');
  const uuidA = 'aaaaaaaa-0000-0000-0000-000000000000';
  const uuidB = 'bbbbbbbb-1111-1111-1111-111111111111';
  let dbOpens = 0;

  function makeFs({ mtimeA = NOW - 3000, mtimeB = NOW - 600000 } = {}) {
    dbOpens = 0;
    const statTimes = new Map([[convA, mtimeA], [convB, mtimeB]]);
    function FakeDb(fileArg) {
      dbOpens += 1;
      return {
        prepare(sql) {
          if (/FROM steps/.test(sql)) {
            // A 正在运行（status 9），B 已完成（status 3）
            return { get: () => ({ status: fileArg === convA ? 9 : 3 }) };
          }
          if (/trajectory_metadata_blob/.test(sql)) {
            return { get: () => ({ data: Buffer.from('..file:///f:/MyGame01..', 'latin1') }) };
          }
          throw new Error('unexpected sql: ' + sql);
        },
        close() {}
      };
    }
    return {
      Database: FakeDb,
      readdirSync(p) {
        if (p === convRoot) return [`${uuidA}.db`, `${uuidB}.db`, 'notes.txt'];
        const e = new Error('ENOENT: ' + p);
        e.code = 'ENOENT';
        throw e;
      },
      statSync(p) {
        if (!statTimes.has(p)) {
          const e = new Error('ENOENT: ' + p);
          e.code = 'ENOENT';
          throw e;
        }
        return { mtimeMs: statTimes.get(p) };
      },
      readFileSync(p) {
        if (p === path.join(home, 'brain', uuidA, 'implementation_plan.md.metadata.json')) {
          return JSON.stringify({ summary: '更新第一章剧情的实施计划' });
        }
        const e = new Error('ENOENT: ' + p);
        e.code = 'ENOENT';
        throw e;
      }
    };
  }

  it('listSessions：标题回退链 + mtime 判活 + 状态映射', () => {
    const adapter = createAntigravityAdapter({ home, ...makeFs() });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(2);
    // 最后活动倒序：A（新鲜）居顶
    expect(rows[0].id).toBe(uuidA);
    expect(rows[0].title).toBe('更新第一章剧情的实施计划'); // brain 摘要
    expect(rows[0].directory).toBe('f:/MyGame01');
    expect(rows[0].lastPartType).toBe('step-start'); // status 9 = 运行中
    expect(rows[0].timeUpdated).toBe(NOW - 3000);
    expect(classifySession(rows[0], NOW, ACTIVE_MS)).toBe('active');
    // B：无 brain 摘要 → 工作区目录名 + 时间；status 3 → step-finish
    expect(rows[1].id).toBe(uuidB);
    expect(rows[1].title).toContain('MyGame01 ·');
    expect(rows[1].lastPartType).toBe('step-finish');
    expect(classifySession(rows[1], NOW, ACTIVE_MS)).toBe('completed');
  });

  it('mtime 未变的库命中缓存不重开（稳态零 SQLite 打开）', () => {
    const fsx = makeFs();
    const adapter = createAntigravityAdapter({ home, ...fsx });
    adapter.listSessions();
    expect(dbOpens).toBe(2);
    adapter.listSessions();
    expect(dbOpens).toBe(2); // 未变化 → 缓存命中
    expect(adapter.lastError).toBeNull();
  });

  it('conversations 目录不存在 → 空列表（未安装静默降级）', () => {
    const adapter = createAntigravityAdapter({
      home,
      readdirSync() {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
    });
    expect(adapter.listSessions()).toEqual([]);
    expect(typeof adapter.lastError).toBe('string');
  });
});

// ============ Codex 适配器 ============

describe('parseCodexTail', () => {
  const TASK_COMPLETE = '{"timestamp":"t","type":"event_msg","payload":{"type":"task_complete","turn_id":"t1"}}';

  it('尾行 task_complete → step-finish（正常完成回合）', () => {
    const text = `{"type":"event_msg","payload":{"type":"user_message"}}\n${TASK_COMPLETE}`;
    expect(parseCodexTail(text)).toBe('step-finish');
  });

  it('首行半截被丢弃后仍能取到最后完整记录', () => {
    const text = `{"timestamp":"2026-05-19T05:15:04.2\n${TASK_COMPLETE}`;
    expect(parseCodexTail(text)).toBe('step-finish');
  });

  it('尾行非 task_complete → tool（回合未完成）', () => {
    const text = '{"type":"event_msg","payload":{"type":"user_message"}}';
    expect(parseCodexTail(text)).toBe('tool');
    expect(parseCodexTail('{"type":"response_item","payload":{"type":"message"}}')).toBe('tool');
  });

  it('空/全非 JSON → null', () => {
    expect(parseCodexTail('')).toBeNull();
    expect(parseCodexTail('not json\nalso not json')).toBeNull();
  });
});

describe('stripExtendedPathPrefix', () => {
  it('剥离 \\\\?\\ 前缀；普通路径/非字符串容错', () => {
    expect(stripExtendedPathPrefix(String.raw`\\?\F:\桌宠A\DeskPet`)).toBe('F:\\桌宠A\\DeskPet');
    expect(stripExtendedPathPrefix('F:\\normal')).toBe('F:\\normal');
    expect(stripExtendedPathPrefix(undefined)).toBe('');
  });
});

describe('createCodexAdapter', () => {
  const home = 'C:/fake-codex';
  const uuid = '019e3e9b-c546-7920-8f85-3ef12965df39';

  function makeAdapter({ fsx, threadsRows, tailByFile }) {
    let sliceCalls = 0;
    const sliceCounts = () => sliceCalls;
    const Database = function FakeDb() {
      return {
        prepare(sql) {
          if (/FROM threads/.test(sql)) return { all: () => threadsRows };
          throw new Error('unexpected sql: ' + sql);
        },
        close() {}
      };
    };
    const readFileSlice = (file) => {
      sliceCalls += 1;
      return Buffer.from(tailByFile[file] || '', 'utf8');
    };
    const adapter = createCodexAdapter({ home, Database, readFileSlice, ...fsx });
    return { adapter, sliceCounts };
  }

  const stateFs = {
    readdirSync(p) {
      if (p === home) return ['state_4.sqlite', 'state_5.sqlite', 'logs_2.sqlite'];
      const e = new Error('ENOENT: ' + p);
      e.code = 'ENOENT';
      throw e;
    },
    statSync: () => ({ mtimeMs: 0 })
  };

  it('threads 表查询：标题/cwd 剥前缀/秒列时间 + rollout 尾行映射', () => {
    const rollout = 'C:/fake-codex/roll/1.jsonl';
    const threadsRows = [{
      id: uuid, title: '你能检查下代码么', first_user_message: null,
      cwd: String.raw`\\?\F:\桌宠A\DeskPet`,
      created_at: 1779167463, created_at_ms: null,
      updated_at: 1779167704, updated_at_ms: null,
      rollout_path: rollout
    }];
    const { adapter, sliceCounts } = makeAdapter({
      fsx: stateFs,
      threadsRows,
      tailByFile: { [rollout]: '{"type":"event_msg","payload":{"type":"task_complete"}}\n' }
    });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(uuid);
    expect(rows[0].title).toBe('你能检查下代码么');
    expect(rows[0].directory).toBe('F:\\桌宠A\\DeskPet'); // \\?\ 前缀已剥离
    expect(rows[0].timeUpdated).toBe(1779167704 * 1000); // 无 _ms 列 → 秒 ×1000
    expect(rows[0].lastPartType).toBe('step-finish');
    expect(classifySession(rows[0], NOW, ACTIVE_MS)).toBe('completed'); // 静止 + 完成回合
    // 未更新的会话不重读 rollout 尾
    adapter.listSessions();
    expect(sliceCounts()).toBe(1);
  });

  it('updated_at_ms 毫秒列优先', () => {
    const threadsRows = [{
      id: 'x1', title: 'T', first_user_message: null, cwd: 'C:/x',
      created_at: 1, created_at_ms: 1111, updated_at: 2, updated_at_ms: 2222,
      rollout_path: null
    }];
    const { adapter } = makeAdapter({ fsx: stateFs, threadsRows, tailByFile: {} });
    const rows = adapter.listSessions();
    expect(rows[0].timeUpdated).toBe(2222);
    expect(rows[0].timeCreated).toBe(1111);
    expect(rows[0].lastPartType).toBeNull(); // 无 rollout → 老会话语义
  });

  it('无 state 库时回退扫描 sessions 目录（uuid 提取 + 时间戳标题）', () => {
    const daysDir = path.join(home, 'sessions', '2026', '05', '19');
    const file = path.join(daysDir, `rollout-2026-05-19T13-00-56-${uuid}.jsonl`);
    const fsx = {
      readdirSync(p, opts) {
        const names = {
          [home]: [],
          [path.join(home, 'sessions')]: ['2026'],
          [path.join(home, 'sessions', '2026')]: ['05'],
          [path.join(home, 'sessions', '2026', '05')]: ['19'],
          [daysDir]: [path.basename(file)]
        };
        if (!(p in names)) {
          const e = new Error('ENOENT: ' + p);
          e.code = 'ENOENT';
          throw e;
        }
        return opts && opts.withFileTypes
          ? names[p].map(name => ({ name, isDirectory: () => true }))
          : names[p];
      },
      statSync: (p) => (p === file ? { mtimeMs: NOW - 5000 } : (() => {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      })())
    };
    const adapter = createCodexAdapter({
      home,
      Database: null, // 回退路径不应触碰 SQLite
      readdirSync: fsx.readdirSync,
      statSync: fsx.statSync,
      readFileSlice: () => Buffer.from('{"type":"event_msg","payload":{"type":"task_complete"}}\n', 'utf8')
    });
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(uuid); // 完整 uuid（时间戳含 - 不被误切）
    expect(rows[0].title).toBe('2026-05-19T13-00-56');
    expect(rows[0].timeUpdated).toBe(NOW - 5000);
    expect(rows[0].lastPartType).toBe('step-finish');
  });
});

// ============ Claude Code 适配器 ============

describe('parseClaudeHead', () => {
  it('summary 行标题优先；补齐 sessionId/cwd/timestamp', () => {
    const lines = [
      JSON.stringify({ type: 'summary', summary: '修复登录bug', sessionId: 'sid-1', cwd: 'F:\\Proj' }),
      JSON.stringify({ type: 'user', message: { content: 'help' }, timestamp: '2026-08-01T00:00:00.000Z' })
    ];
    const head = parseClaudeHead(lines);
    expect(head.title).toBe('修复登录bug');
    expect(head.sessionId).toBe('sid-1');
    expect(head.cwd).toBe('F:\\Proj');
    expect(head.timeCreated).toBe(Date.parse('2026-08-01T00:00:00.000Z'));
  });

  it('无 summary 时用首条用户消息（字符串/数组内容均可）', () => {
    const a = parseClaudeHead([
      JSON.stringify({ type: 'user', message: { content: '帮我看看插件' }, sessionId: 's', cwd: 'C:/a' })
    ]);
    expect(a.title).toBe('帮我看看插件');
    const b = parseClaudeHead([
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '数组消息' }] } })
    ]);
    expect(b.title).toBe('数组消息');
  });

  it('工具结果与系统注入文本不作标题；空输入容错', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
      JSON.stringify({ type: 'user', message: { content: '<system-reminder>内部标记</system-reminder>' } }),
      JSON.stringify({ type: 'assistant', message: { content: '回复' } })
    ];
    expect(parseClaudeHead(lines).title).toBe('');
    expect(parseClaudeHead([]).title).toBe('');
    expect(parseClaudeHead(null).sessionId).toBe('');
  });
});

describe('parseClaudeTail', () => {
  it('result/success → step-finish；result/error_* → error；其他 → tool', () => {
    expect(parseClaudeTail('{"type":"result","subtype":"success"}\n')).toBe('step-finish');
    expect(parseClaudeTail('{"type":"result","subtype":"error_max_turns"}\n')).toBe('error');
    expect(parseClaudeTail('{"type":"assistant","message":{}}\n')).toBe('tool');
    expect(parseClaudeTail('')).toBeNull();
  });

  it('首行半截被丢弃', () => {
    const text = '{"type":"result","subtype":"succ\n{"type":"result","subtype":"success"}';
    expect(parseClaudeTail(text)).toBe('step-finish');
  });
});

describe('createClaudeAdapter', () => {
  const home = 'C:/fake-claude';
  const projectsRoot = path.join(home, 'projects');
  const projDir = path.join(projectsRoot, 'F--MyProj');
  const f1 = path.join(projDir, '11111111-1111-1111-1111-111111111111.jsonl');
  const f2 = path.join(projDir, '22222222-2222-2222-2222-222222222222.jsonl');

  function makeAdapter({ mtime1 = NOW - 5000, mtime2 = NOW - 700000 } = {}) {
    let sliceCalls = 0;
    const headText = {
      [f1]: [
        JSON.stringify({ type: 'user', message: { content: '运行中会话' },
          sessionId: 'sess-1', cwd: 'F:\\MyProj', timestamp: '2026-08-20T00:00:00.000Z' })
      ].join('\n') + '\n',
      [f2]: [
        JSON.stringify({ type: 'summary', summary: '旧会话摘要',
          sessionId: 'sess-2', cwd: 'F:\\MyProj', timestamp: '2026-08-01T00:00:00.000Z' })
      ].join('\n') + '\n'
    };
    const tailText = {
      [f1]: '{"type":"assistant","message":{"content":"working"}}\n',
      [f2]: '{"type":"result","subtype":"error_during_execution"}\n'
    };
    const adapter = createClaudeAdapter({
      home,
      readdirSync(p, opts) {
        if (p === projectsRoot) return opts && opts.withFileTypes
          ? [projDir].map((d) => ({ name: path.basename(d), isDirectory: () => true }))
          : [projDir];
        if (p === projDir) return [path.basename(f1), path.basename(f2)];
        const e = new Error('ENOENT: ' + p);
        e.code = 'ENOENT';
        throw e;
      },
      statSync(p) {
        const times = { [f1]: mtime1, [f2]: mtime2 };
        if (!(p in times)) {
          const e = new Error('ENOENT: ' + p);
          e.code = 'ENOENT';
          throw e;
        }
        return { mtimeMs: times[p] };
      },
      readFileSlice(file, start) {
        sliceCalls += 1;
        return Buffer.from(start === 0 ? headText[file] : tailText[file], 'utf8');
      }
    });
    return { adapter, sliceCount: () => sliceCalls };
  }

  it('扫描 projects 布局：首行元信息 + 尾行状态映射 + mtime 排序', () => {
    const { adapter } = makeAdapter();
    const rows = adapter.listSessions();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('sess-1');
    expect(rows[0].title).toBe('运行中会话');
    expect(rows[0].directory).toBe('F:\\MyProj');
    expect(rows[0].timeUpdated).toBe(NOW - 5000);
    expect(rows[0].lastPartType).toBe('tool');
    expect(classifySession(rows[0], NOW, ACTIVE_MS)).toBe('active');
    expect(rows[1].id).toBe('sess-2');
    expect(rows[1].title).toBe('旧会话摘要');
    expect(rows[1].lastPartType).toBe('error');
    expect(classifySession(rows[1], NOW, ACTIVE_MS)).toBe('interrupted');
  });

  it('mtime 未变的文件命中缓存不重读', () => {
    const { adapter, sliceCount } = makeAdapter();
    adapter.listSessions();
    expect(sliceCount()).toBe(4); // 2 文件 × 首+尾
    adapter.listSessions();
    expect(sliceCount()).toBe(4);
  });

  it('projects 目录不存在 → 空列表（未安装静默降级）', () => {
    const adapter = createClaudeAdapter({
      home,
      readdirSync() {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
    });
    expect(adapter.listSessions()).toEqual([]);
    expect(typeof adapter.lastError).toBe('string');
  });
});

