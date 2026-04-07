// Mock Electron modules
const mockScreen = {
  getPrimaryDisplay: () => ({
    workAreaSize: {
      width: 1920,
      height: 1080
    }
  })
};

const mockBrowserWindow = jest.fn().mockImplementation(() => ({
  loadFile: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  minimize: jest.fn(),
  restore: jest.fn(),
  getBounds: jest.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
  setBounds: jest.fn(),
  setPosition: jest.fn(),
  webContents: {
    send: jest.fn(),
    on: jest.fn()
  },
  isCollapsed: false,
  isDragging: false,
  dragOffset: { x: 0, y: 0 }
}));

const mockIpcMain = {
  handle: jest.fn(),
  on: jest.fn()
};

const mockApp = {
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn(),
  getPath: jest.fn(() => '/mock/path')
};

const mockElectron = {
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  screen: mockScreen,
  systemPreferences: {
    getColor: jest.fn()
  }
};

// Mock electron modules
jest.mock('electron', () => mockElectron);

// Mock electron-store
jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn((key, defaultValue) => defaultValue),
    set: jest.fn()
  }));
});

// Mock electron-auto-launch
jest.mock('electron-auto-launch', () => {
  return jest.fn().mockImplementation(() => ({
    enable: jest.fn(),
    disable: jest.fn(),
    isEnabled: jest.fn(() => Promise.resolve(false))
  }));
});