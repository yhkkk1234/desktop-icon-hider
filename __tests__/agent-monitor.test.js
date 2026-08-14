// agent-monitor.test.js - agent 会话监控模块单元测试
const {
  AgentMonitor,
  applyServerStatus,
  classifySession,
  classifyDshSession,
  createDshAdapter,
  createOpencodeAdapter,
  createOpencodeServerStatusProvider,
  detectDshRunning,
  filterVisibleSessions,
  getDshHomePath,
  getOpencodeDbPath,
  isValidSessionId,
  parseDshProjection,
  parseLastPartType,
  parseSSEChunk,
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

  /** 构造注入式假文件系统：dirs = Map<目录路径, 子项名数组>；mtimes = [[路径, mtimeMs]]；
   *  projRaw = 注册在 home 的投影缓存；projRaws = 任意路径 → 内容（覆盖 projRaw） */
  function makeFs({ dirs, projRaw, projRaws, mtimes }) {
    const files = new Map();
    if (projRaw !== undefined) {
      files.set(path.join(home, 'storages', 'session_projcache.json'), projRaw);
    }
    if (projRaws) {
      for (const [p, raw] of Object.entries(projRaws)) files.set(p, raw);
    }
    const statTimes = new Map(mtimes || []);
    return {
      readFileSync(p) {
        if (!files.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return files.get(p);
      },
      statSync(p) {
        if (!statTimes.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return { mtimeMs: statTimes.get(p) };
      },
      readdirSync(p) {
        if (!dirs.has(p)) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e; }
        return dirs.get(p).map(name => ({ name, isDirectory: () => true }));
      }
    };
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
});

describe('detectDshRunning', () => {
  it('端口可达 → true（无需文件）', async () => {
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => true, null);
    expect(ok).toBe(true);
  });

  it('端口不可达但投影缓存近期在写入 → true（headless 模式）', async () => {
    const statFn = () => ({ mtimeMs: Date.now() - 5000 });
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false, statFn);
    expect(ok).toBe(true);
  });

  it('端口不可达且投影缓存陈旧/缺失 → false', async () => {
    const statFn = () => { throw new Error('ENOENT'); };
    const ok = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false, statFn);
    expect(ok).toBe(false);
    const stale = await detectDshRunning(DEFAULT_DSH_WEB_PORT, async () => false, () => ({ mtimeMs: Date.now() - 600000 }));
    expect(stale).toBe(false);
  });
});

