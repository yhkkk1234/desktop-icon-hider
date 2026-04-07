const WindowManager = require('../src/main/window-manager');

// Mock screen module directly
jest.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({
      workAreaSize: {
        width: 1920,
        height: 1080
      }
    })
  },
  BrowserWindow: jest.fn(),
  ipcMain: {
    handle: jest.fn()
  }
}), { virtual: true });

describe('WindowManager', () => {
  test('getDesktopCenterPosition should return valid coordinates', () => {
    const position = WindowManager.getDesktopCenterPosition();
    expect(position).toHaveProperty('x');
    expect(position).toHaveProperty('y');
    expect(typeof position.x).toBe('number');
    expect(typeof position.y).toBe('number');
  });
  
  test('WINDOW_CONFIG should have required properties', () => {
    expect(WindowManager.WINDOW_CONFIG).toHaveProperty('MIN_HEIGHT');
    expect(WindowManager.WINDOW_CONFIG).toHaveProperty('HEADER_HEIGHT');
    expect(WindowManager.WINDOW_CONFIG.MIN_HEIGHT).toBeGreaterThan(0);
    expect(WindowManager.WINDOW_CONFIG.HEADER_HEIGHT).toBeGreaterThan(0);
  });
});
