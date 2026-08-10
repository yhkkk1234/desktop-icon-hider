// agent-monitor.test.js - agent 会话监控模块单元测试
const {
  AgentMonitor,
  applyServerStatus,
  classifySession,
  createOpencodeAdapter,
  createOpencodeServerStatusProvider,
  filterVisibleSessions,
  getOpencodeDbPath,
  isValidSessionId,
  parseLastPartType,
  parseSSEChunk,
  resetClientDetectCache,
  resetTerminalShellCache,
  DEFAULT_ACTIVE_WINDOW_MS
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

describe('hasVisibleOpencodeWindow', () => {
  const { hasVisibleOpencodeWindow } = require('../src/main/agent-monitor');

  it('有可见主窗口（标题为 OpenCode）→ true', () => {
    const out = '"OpenCode.exe","6364","Console","1","166,728 K","Running","DESKTOP-X\\u","0:00:08","OpenCode"\n';
    expect(hasVisibleOpencodeWindow(out)).toBe(true);
  });

  it('后台残留进程（真实 GBK 编码的"暂缺"解码后）→ false', () => {
    // "暂缺" 的 GBK 字节 D4 DD C8 B1（中文 Windows tasklist /V 的 N/A），模拟真实解码链路
    const gbk = (hex) => new TextDecoder('gbk').decode(Buffer.from(hex, 'hex'));
    const out = `"OpenCode.exe","46388","Console","1","40,760 K","Running","DESKTOP-X\\u","0:00:00","${gbk('d4ddc8b1')}"\n`;
    expect(hasVisibleOpencodeWindow(out)).toBe(false);
  });

  it('英文 N/A → false', () => {
    const out = '"OpenCode.exe","46388","Console","1","40,760 K","Running","DESKTOP-X\\u","0:00:00","N/A"\n';
    expect(hasVisibleOpencodeWindow(out)).toBe(false);
  });

  it('Electron 线程窗口（OleMainThreadWndName）→ false', () => {
    const out = '"OpenCode.exe","26476","Console","1","62,064 K","Running","DESKTOP-X\\u","0:00:01","OleMainThreadWndName"\n';
    expect(hasVisibleOpencodeWindow(out)).toBe(false);
  });

  it('多进程混合：仅 OLE 线程窗口 + 暂缺 → false', () => {
    const out = [
      '"OpenCode.exe","46388","Console","1","40,760 K","Running","DESKTOP-X\\u","0:00:00","暂缺"',
      '"OpenCode.exe","26476","Console","1","62,064 K","Running","DESKTOP-X\\u","0:00:01","OleMainThreadWndName"'
    ].join('\n');
    expect(hasVisibleOpencodeWindow(out)).toBe(false);
  });

  it('混合：后台残留 + 一个可见窗口 → true', () => {
    const out = [
      '"OpenCode.exe","46388","Console","1","40,760 K","Running","DESKTOP-X\\u","0:00:00","暂缺"',
      '"OpenCode.exe","6364","Console","1","166,728 K","Running","DESKTOP-X\\u","0:00:08","OpenCode"'
    ].join('\n');
    expect(hasVisibleOpencodeWindow(out)).toBe(true);
  });

  it('无 OpenCode.exe 行（仅 TUI）→ false', () => {
    const out = '"opencode.exe","45144","Console","1","1,033,316 K","Unknown","DESKTOP-X\\u","0:16:12","暂缺"\n';
    expect(hasVisibleOpencodeWindow(out)).toBe(false);
  });

  it('空输出 → false', () => {
    expect(hasVisibleOpencodeWindow('')).toBe(false);
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

describe('findTerminalShellAsync', () => {
  const { findTerminalShellAsync } = require('../src/main/agent-monitor');

  beforeEach(() => resetTerminalShellCache());

  function whereSpawn(available) {
    return (...args) => {
      const target = args[1] && args[1][0];
      return {
        on: (ev, cb) => {
          if (ev === 'close') setTimeout(() => cb(available.includes(target) ? 0 : 1), 0);
        }
      };
    };
  }

  it('pwsh 存在时优先选择 pwsh', async () => {
    expect(await findTerminalShellAsync(whereSpawn(['pwsh']))).toBe('pwsh');
  });

  it('无 pwsh 时回退 powershell', async () => {
    expect(await findTerminalShellAsync(whereSpawn(['powershell']))).toBe('powershell');
  });

  it('都不可用时回退 cmd', async () => {
    expect(await findTerminalShellAsync(whereSpawn([]))).toBe('cmd');
  });

  it('结果缓存 10s 内不重复探测', async () => {
    let calls = 0;
    const spawnFn = (...args) => {
      calls++;
      return {
        on: (ev, cb) => {
          if (ev === 'close') setTimeout(() => cb(0), 0);
        }
      };
    };
    expect(await findTerminalShellAsync(spawnFn)).toBe('pwsh');
    expect(await findTerminalShellAsync(spawnFn)).toBe('pwsh');
    expect(calls).toBe(1);
  });
});

describe('createOpencodeAdapter', () => {
  beforeEach(() => {
    resetClientDetectCache();
    resetTerminalShellCache();
  });

  // 模拟 spawn：tasklist 子进程（stdout 输出 + close）；where 子进程（按配置返回退出码）
  // whereResult: 'pwsh'（pwsh 存在）| 'powershell'（仅 powershell）| ''（都不存在）
  function makeSpawnFn(calls, { tasklistOutput = '', whereResult = 'pwsh' } = {}) {
    return (...args) => {
      calls.push(args);
      const isTasklist = args[0] === 'tasklist';
      const isWhere = args[0] === 'where';
      return {
        stdout: {
          on: (ev, cb) => {
            if (ev === 'data' && isTasklist && tasklistOutput) {
              setTimeout(() => cb(Buffer.from(tasklistOutput, 'utf8')), 0);
            }
          }
        },
        on: (ev, cb) => {
          if (ev === 'close') {
            setTimeout(() => {
              if (isWhere) {
                const target = args[1] && args[1][0];
                cb(target === whereResult ? 0 : 1);
              } else {
                cb(0);
              }
            }, 0);
          }
        },
        unref: () => {}
      };
    };
  }

  it('DB 不可用（未加载原生模块）时降级为空列表', () => {
    const adapter = createOpencodeAdapter({ Database: null });
    expect(adapter.listSessions()).toEqual([]);
  });

  it('openSession 拒绝非法会话 id', async () => {
    const adapter = createOpencodeAdapter({ Database: null });
    const result = await adapter.openSession({ id: 'x; rm -rf /', directory: 'F:/proj' });
    expect(result.ok).toBe(false);
  });

  it('openSession 检测到桌面客户端（可见主窗口）→ 深链打开对应项目窗口', async () => {
    const spawnCalls = [];
    // tasklist /V CSV 格式：最后列是窗口标题（OpenCode 主窗口可见）
    const tasklistOutput = '"OpenCode.exe","12345","Console","1","200,000 K","Running","USER","0:00:01","OpenCode"\n';
    const spawnFn = makeSpawnFn(spawnCalls, { tasklistOutput });
    const shellUrls = [];
    const adapter = createOpencodeAdapter({
      Database: null,
      spawnFn,
      shellFn: (url) => shellUrls.push(url)
    });
    const result = await adapter.openSession({ id: 'ses_abc123', directory: 'F:/我的项目' });
    expect(result.ok).toBe(true);
    expect(result.target).toBe('desktop');
    expect(shellUrls).toHaveLength(1);
    // Windows 平台深链路径应为反斜杠（与 desktop 内部存储一致，避免重复开项目窗口）
    const expectedDir = process.platform === 'win32' ? 'F:\\我的项目' : 'F:/我的项目';
    expect(shellUrls[0]).toBe('opencode://open-project?directory=' + encodeURIComponent(expectedDir));
    // 仅 tasklist 探测一次，未 spawn 终端
    expect(spawnCalls.filter(c => c[0] !== 'tasklist')).toHaveLength(0);
  });

  it('openSession 桌面端仅后台残留（无可见窗口）→ 走终端而非深链', async () => {
    const spawnCalls = [];
    // OpenCode.exe 进程存在但窗口标题为 N/A（关闭窗口后 Electron 后台常驻；中文系统为"暂缺"）
    const tasklistOutput = '"OpenCode.exe","12345","Console","1","200,000 K","Running","USER","0:00:01","N/A"\n';
    const spawnFn = makeSpawnFn(spawnCalls, { tasklistOutput, whereResult: 'pwsh' });
    const shellUrls = [];
    const adapter = createOpencodeAdapter({
      Database: null,
      spawnFn,
      shellFn: (url) => shellUrls.push(url)
    });
    const result = await adapter.openSession({ id: 'ses_abc123', directory: 'F:/我的项目' });
    expect(result.ok).toBe(true);
    expect(result.target).toBe('terminal');
    expect(result.shell).toBe('pwsh');
    expect(shellUrls).toHaveLength(0);
    const terminalCalls = spawnCalls.filter(c => c[0] === 'pwsh');
    expect(terminalCalls).toHaveLength(1);
    expect(terminalCalls[0][1]).toEqual(['-NoExit', '-Command', 'opencode -s ses_abc123']);
  });

  it('openSession 桌面端仅 OLE 线程窗口（Electron 后台）→ 走终端', async () => {
    const spawnCalls = [];
    const tasklistOutput = '"OpenCode.exe","12345","Console","1","200,000 K","Running","USER","0:00:01","OleMainThreadWndName"\n';
    const spawnFn = makeSpawnFn(spawnCalls, { tasklistOutput, whereResult: 'pwsh' });
    const adapter = createOpencodeAdapter({
      Database: null,
      spawnFn,
      shellFn: () => { throw new Error('不应调用深链'); }
    });
    const result = await adapter.openSession({ id: 'ses_abc123', directory: 'F:/我的项目' });
    expect(result.ok).toBe(true);
    expect(result.target).toBe('terminal');
  });

  it('无桌面客户端时优先用 pwsh 打开终端会话', async () => {
    const spawnCalls = [];
    const spawnFn = makeSpawnFn(spawnCalls, { whereResult: 'pwsh' }); // tasklist 无输出 → terminal；where pwsh 命中
    const adapter = createOpencodeAdapter({ Database: null, spawnFn, shellFn: () => {} });
    const result = await adapter.openSession({ id: 'ses_abc123', directory: 'F:/我的项目' });
    expect(result.ok).toBe(true);
    expect(result.target).toBe('terminal');
    expect(result.shell).toBe('pwsh');
    const terminalCalls = spawnCalls.filter(c => c[0] === 'pwsh');
    expect(terminalCalls).toHaveLength(1);
    const [cmd, args, opts] = terminalCalls[0];
    expect(cmd).toBe('pwsh');
    expect(args).toEqual(['-NoExit', '-Command', 'opencode -s ses_abc123']);
    expect(opts.cwd).toBe('F:/我的项目');
  });

  it('无 pwsh/powershell 时回退 cmd', async () => {
    const spawnCalls = [];
    const spawnFn = makeSpawnFn(spawnCalls, { whereResult: '' }); // where 全部失败
    const adapter = createOpencodeAdapter({ Database: null, spawnFn, shellFn: () => {} });
    const result = await adapter.openSession({ id: 'ses_abc123', directory: 'F:/proj' });
    expect(result.ok).toBe(true);
    expect(result.shell).toBe('cmd');
    const terminalCalls = spawnCalls.filter(c => c[0] === 'cmd.exe');
    expect(terminalCalls).toHaveLength(1);
    expect(terminalCalls[0][1]).toEqual(['/k', 'opencode -s ses_abc123']);
  });

  it('openSession 目录缺失时回退到用户主目录', async () => {
    const spawnCalls = [];
    const spawnFn = makeSpawnFn(spawnCalls, { whereResult: '' });
    const adapter = createOpencodeAdapter({ Database: null, spawnFn, shellFn: () => {} });
    await adapter.openSession({ id: 'ses_abc123', directory: '' });
    const terminalCalls = spawnCalls.filter(c => c[0] === 'cmd.exe');
    expect(terminalCalls[0][2].cwd).toBe(require('os').homedir());
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

