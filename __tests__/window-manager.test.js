const WindowManager = require('../src/main/window-manager');

// Mock screen module directly
jest.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({
      workAreaSize: {
        width: 1920,
        height: 1080
      }
    }),
    getDisplayMatching: () => ({
      workAreaSize: {
        width: 1920,
        height: 1080
      }
    }),
    getCursorScreenPoint: () => ({ x: 960, y: 540 })
  },
  BrowserWindow: jest.fn(),
  ipcMain: {
    handle: jest.fn()
  }
}), { virtual: true });

function createWindowMock() {
  const state = {
    enabled: false,
    currentEdge: 'none',
    isHidden: false,
    isAnimating: false,
    showCancelled: false,
    hideTimer: null,
    showTimer: null,
    mouseMonitorInterval: null
  };
  const window = {
    autoHideState: state,
    webContents: { send: jest.fn() },
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: jest.fn(),
    isCollapsed: false
  };
  return window;
}

describe('WindowManager', () => {
  test('WINDOW_CONFIG should have required properties', () => {
    expect(WindowManager.WINDOW_CONFIG).toHaveProperty('MIN_HEIGHT');
    expect(WindowManager.WINDOW_CONFIG).toHaveProperty('HEADER_HEIGHT');
    expect(WindowManager.WINDOW_CONFIG.MIN_HEIGHT).toBeGreaterThan(0);
    expect(WindowManager.WINDOW_CONFIG.HEADER_HEIGHT).toBeGreaterThan(0);
  });

  test('AUTO_HIDE_CONFIG should have valid timing values', () => {
    expect(WindowManager.AUTO_HIDE_CONFIG.HIDE_DELAY).toBeGreaterThan(0);
    expect(WindowManager.AUTO_HIDE_CONFIG.SHOW_DELAY).toBeGreaterThan(0);
    expect(WindowManager.AUTO_HIDE_CONFIG.ANIMATION_DURATION).toBeGreaterThan(0);
    expect(WindowManager.AUTO_HIDE_CONFIG.EDGE_THRESHOLD).toBeGreaterThan(0);
  });

  test('EDGE_TYPES should define all edges and none', () => {
    expect(WindowManager.EDGE_TYPES).toEqual({
      TOP: 'top',
      BOTTOM: 'bottom',
      LEFT: 'left',
      RIGHT: 'right',
      NONE: 'none'
    });
  });

  test('setAutoHideEnabled should persist state and start monitoring', () => {
    const window = createWindowMock();
    const store = { set: jest.fn() };
    jest.useFakeTimers();

    const result = WindowManager.setAutoHideEnabled(window, true, store);
    expect(result).toBe(true);
    expect(store.set).toHaveBeenCalledWith('autoHideEnabled', true);
    expect(window.autoHideState.enabled).toBe(true);
    expect(window.autoHideState.mouseMonitorInterval).not.toBeNull();
    expect(window.webContents.send).toHaveBeenCalledWith('auto-hide-status', { enabled: true });

    jest.useRealTimers();
  });

  test('setAutoHideEnabled disable should stop monitoring and clear edge', () => {
    const window = createWindowMock();
    window.autoHideState.enabled = true;
    window.autoHideState.currentEdge = 'top';
    const store = { set: jest.fn() };

    const result = WindowManager.setAutoHideEnabled(window, false, store);
    expect(result).toBe(true);
    expect(store.set).toHaveBeenCalledWith('autoHideEnabled', false);
    expect(store.set).toHaveBeenCalledWith('autoHideEdge', 'none');
    expect(window.autoHideState.enabled).toBe(false);
    expect(window.autoHideState.mouseMonitorInterval).toBeNull();
    expect(window.autoHideState.currentEdge).toBe('none');
    expect(window.webContents.send).toHaveBeenCalledWith('auto-hide-status', { enabled: false });
  });

  test('getAutoHideStatus should reflect window state', () => {
    const window = createWindowMock();
    window.autoHideState.enabled = true;
    window.autoHideState.currentEdge = 'bottom';

    const status = WindowManager.getAutoHideStatus(window);
    expect(status).toEqual({ enabled: true, edge: 'bottom', isHidden: false });
  });

  test('getAutoHideStatus should return defaults for null window', () => {
    expect(WindowManager.getAutoHideStatus(null)).toEqual({
      enabled: false,
      edge: 'none',
      isHidden: false
    });
  });

  test('enforceWidth should correct accumulated width drift', () => {
    // 模拟 Windows 透明窗口：setBounds(w) 实际得到 w+1（漂移累积）
    let width = 802;
    const window = {
      autoHideState: { expectedWidth: 800 },
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 0, width, height: 600 }),
      setBounds: jest.fn((b) => { width = b.width + 1; })
    };

    WindowManager.enforceWidth(window);
    expect(width).toBe(800);
    expect(window.setBounds).toHaveBeenCalledTimes(2);
  });

  test('enforceWidth should correct drift in one pass when setBounds is exact', () => {
    // 无漂移环境：setBounds 精确生效，一次校正即可
    let width = 802;
    const window = {
      autoHideState: { expectedWidth: 800 },
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 0, width, height: 600 }),
      setBounds: jest.fn((b) => { width = b.width; })
    };

    WindowManager.enforceWidth(window);
    expect(width).toBe(800);
    expect(window.setBounds).toHaveBeenCalledTimes(1);
  });

  test('enforceWidth should not touch window when width already matches', () => {
    const window = {
      autoHideState: { expectedWidth: 800 },
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 0, width: 800, height: 600 }),
      setBounds: jest.fn()
    };

    WindowManager.enforceWidth(window);
    expect(window.setBounds).not.toHaveBeenCalled();
  });

  test('enforceWidth should ignore null window', () => {
    expect(() => WindowManager.enforceWidth(null)).not.toThrow();
  });

  test('setBoundsStable should correct width drift after setBounds', () => {
    // 模拟漂移环境：setBounds(w) 实际得到 w+1
    let width = 0;
    const window = {
      autoHideState: { expectedWidth: 800 },
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 0, width, height: 600 }),
      setBounds: jest.fn((b) => { width = b.width + 1; })
    };

    WindowManager.setBoundsStable(window, 100, 0, 800, 600);
    expect(width).toBe(800);
    expect(window.setBounds).toHaveBeenCalledTimes(2);
  });

  test('setBoundsStable should be single pass when setBounds is exact', () => {
    let width = 0;
    const window = {
      autoHideState: { expectedWidth: 800 },
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 0, width, height: 600 }),
      setBounds: jest.fn((b) => { width = b.width; })
    };

    WindowManager.setBoundsStable(window, 100, 0, 800, 600);
    expect(width).toBe(800);
    expect(window.setBounds).toHaveBeenCalledTimes(1);
  });

  test('setBoundsStable should ignore null window', () => {
    expect(() => WindowManager.setBoundsStable(null, 0, 0, 800, 600)).not.toThrow();
  });
});
