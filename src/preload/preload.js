const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFiles: () => ipcRenderer.invoke('get-files'),
  toggleCollapse: (isCollapsed) => ipcRenderer.invoke('toggle-collapse', isCollapsed),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  refreshFiles: () => ipcRenderer.invoke('refresh-files'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  moveWindow: (newX, newY) => ipcRenderer.invoke('move-window', newX, newY),
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
  getFileIcons: (files) => ipcRenderer.invoke('get-file-icons', files),
  log: (...args) => ipcRenderer.invoke('log', ...args),
  onInitData: (callback) => ipcRenderer.on('init-data', (event, data) => callback(data)),
  
  // 主题功能API
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  
  // 透明度功能API
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  getOpacity: () => ipcRenderer.invoke('get-opacity'),
  
  // 图标大小功能API
  setIconSize: (size) => ipcRenderer.invoke('set-icon-size', size),
  getIconSize: () => ipcRenderer.invoke('get-icon-size'),
  
  // 自动隐藏功能API
  setAutoHide: (enabled) => ipcRenderer.invoke('set-auto-hide', enabled),
  getAutoHideStatus: () => ipcRenderer.invoke('get-auto-hide-status'),
  setAutoHideEdge: (edge) => ipcRenderer.invoke('set-auto-hide-edge', edge),
  
  // 排序功能API
  setSortBy: (sortBy) => ipcRenderer.invoke('set-sort-by', sortBy),
  
  // 开机启动功能API
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  
  // 监听自动隐藏事件
  onAutoHideChanged: (callback) => ipcRenderer.on('auto-hide-changed', (event, data) => callback(data)),
  onAutoHideStatus: (callback) => ipcRenderer.on('auto-hide-status', (event, data) => callback(data)),
  onEdgeChanged: (callback) => ipcRenderer.on('edge-changed', (event, data) => callback(data)),
  
  // 监听开机启动变化事件
  onAutoLaunchChanged: (callback) => ipcRenderer.on('auto-launch-changed', (event, data) => callback(data)),
  
  // 监听系统主题变化事件
  onSystemThemeChanged: (callback) => ipcRenderer.on('system-theme-changed', (event, data) => callback(data)),
  
  // 监听打开设置事件(从托盘)
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),

  // 右键菜单 API
  showDesktopContextMenu: (x, y) => ipcRenderer.invoke('show-desktop-context-menu', x, y),
  showFileContextMenu: (filePath, x, y) => ipcRenderer.invoke('show-file-context-menu', filePath, x, y),
  cancelDesktopContextMenu: () => ipcRenderer.invoke('cancel-desktop-context-menu'),

  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath, permanent) => ipcRenderer.invoke('delete-file', filePath, permanent)
});
