const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');

let tray = null;

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

  const isWindowVisible = mainWindow && mainWindow.isVisible();
  const isAutoHideEnabled = store.get('autoHideEnabled', false);

  const menuTemplate = [
    {
      label: isWindowVisible ? '隐藏窗口' : '显示窗口',
      click: () => {
        if (mainWindow) {
          if (isWindowVisible) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
          updateTrayMenu(mainWindow, store);
        }
      }
    },
    {
      type: 'separator'
    },
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
      type: 'separator'
    },
    {
      label: '退出',
      click: () => {
        // 设置退出标志
        app.isQuitting = true;
        // 直接退出，before-quit 事件会处理显示桌面图标的逻辑
        app.quit();
      }
    }
  ];

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
  getTray
};
