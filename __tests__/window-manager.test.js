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
});
