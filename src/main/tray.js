const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

let tray = null;

// 开机自启：直接管理注册表 Run 键。
// 不用 electron-auto-launch（Windows 上强制以 exe 名做键名，开发模式会注册成裸 electron.exe 导致开机无效）；
// 也不用 app.setLoginItemSettings（开发模式下写入键名 electron.app.Electron 与读取键名不一致，状态永远读不到）。
const AUTO_LAUNCH_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTO_LAUNCH_NAME = 'Desktop Icon Hider';

function getLaunchCommand() {
  // 打包版：应用 exe 自身；开发模式：electron.exe + 应用路径参数
  const args = ['--hidden'];
  if (!app.isPackaged) args.push(app.getAppPath());
  return `"${process.execPath}" ${args.join(' ')}`;
}

const autoLauncher = {
  async enable() {
    execFileSync('reg', ['add', AUTO_LAUNCH_KEY, '/v', AUTO_LAUNCH_NAME, '/t', 'REG_SZ', '/d', getLaunchCommand(), '/f']);
    return true;
  },
  async disable() {
    try {
      execFileSync('reg', ['delete', AUTO_LAUNCH_KEY, '/v', AUTO_LAUNCH_NAME, '/f']);
    } catch (e) {
      // 键不存在时忽略
    }
    return true;
  },
  async isEnabled() {
    try {
      execFileSync('reg', ['query', AUTO_LAUNCH_KEY, '/v', AUTO_LAUNCH_NAME]);
      return true;
    } catch (e) {
      return false;
    }
  }
};

function createTray(mainWindow, store) {
  try {
    if (tray) {
      return tray;
    }

    const appPath = app.getAppPath();
    const iconPath = path.join(appPath, 'assets', 'tray-icon.png');
    let trayIcon;

    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        trayIcon = nativeImage.createEmpty();
      }
    } catch (e) {
      trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('Desktop Icon Hider');

    updateTrayMenu(mainWindow, store);

    tray.on('click', () => {
      if (mainWindow) {
        // 自动隐藏开启时窗口显隐由边缘逻辑管理，托盘手动切换无意义（显示后会被立即滑出），忽略
        if (store.get('autoHideEnabled', false)) return;
        if (mainWindow.isVisible()) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
            mainWindow.focus();
          } else {
            mainWindow.hide();
          }
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
        updateTrayMenu(mainWindow, store);
      }
    });

    return tray;
  } catch (error) {
    console.error('Error creating tray:', error);
    return null;
  }
}

function updateTrayMenu(mainWindow, store) {
  if (!tray) return;

  const isWindowVisible = mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
  const isAutoHideEnabled = store.get('autoHideEnabled', false);
  const isAutoLaunchEnabled = store.get('autoLaunch', false);

  const menuTemplate = [];

  // 自动隐藏开启时窗口显隐由边缘逻辑管理，不提供手动显示/隐藏项（显示后会被立即滑出）
  if (!isAutoHideEnabled) {
    menuTemplate.push({
      label: isWindowVisible ? '隐藏窗口' : '显示窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
          updateTrayMenu(mainWindow, store);
        }
      }
    });
    menuTemplate.push({ type: 'separator' });
  }

  menuTemplate.push(
    {
      label: '设置',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    {
      label: '自动隐藏',
      type: 'checkbox',
      checked: isAutoHideEnabled,
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-auto-hide', !isAutoHideEnabled);
        }
      }
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: isAutoLaunchEnabled,
      click: async () => {
        const newState = !isAutoLaunchEnabled;
        try {
          if (newState) {
            await autoLauncher.enable();
          } else {
            await autoLauncher.disable();
          }
          store.set('autoLaunch', newState);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-launch-changed', { enabled: newState });
          }
        } catch (error) {
          console.error('设置开机启动失败:', error);
          store.set('autoLaunch', isAutoLaunchEnabled);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-launch-changed', { enabled: isAutoLaunchEnabled });
          }
        }
        updateTrayMenu(mainWindow, store);
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  );

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function getTray() {
  return tray;
}

module.exports = {
  createTray,
  updateTrayMenu,
  destroyTray,
  getTray,
  autoLauncher
};
