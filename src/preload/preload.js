const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFiles: () => ipcRenderer.invoke('get-files'),
  toggleCollapse: (isCollapsed) => ipcRenderer.invoke('toggle-collapse', isCollapsed),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  refreshFiles: () => ipcRenderer.invoke('refresh-files'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openInExplorer: (filePath) => ipcRenderer.invoke('open-in-explorer', filePath),
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
  setManualOrder: (order) => ipcRenderer.invoke('set-manual-order', order),
  setGroups: (groups) => ipcRenderer.invoke('set-groups', groups),
  
  // 分组显示模式
  setGroupDisplayMode: (mode) => ipcRenderer.invoke('set-group-display-mode', mode),
  
  // 分组缩略图样式
  setGroupThumbStyle: (style) => ipcRenderer.invoke('set-group-thumb-style', style),
  
  // 小组件
  setWidgets: (widgets) => ipcRenderer.invoke('set-widgets', widgets),
  setShowWidgets: (enabled) => ipcRenderer.invoke('set-show-widgets', enabled),
  
  // 开机启动功能API
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  
  // 文件夹预览
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  
  // 图片预览
  getImagePreview: (filePath) => ipcRenderer.invoke('get-image-preview', filePath),
  
  // 剪贴板文件操作
  pasteClipboard: (payload) => ipcRenderer.invoke('paste-clipboard', payload),
  
  // 图标锁定
  setIconsLocked: (locked) => ipcRenderer.invoke('set-icons-locked', locked),
  
  // 文件夹预览开关
  setFolderPreviewEnabled: (enabled) => ipcRenderer.invoke('set-folder-preview-enabled', enabled),
  
  // 自动整理规则
  setArrangeRules: (rules) => ipcRenderer.invoke('set-arrange-rules', rules),
  
  // 语言
  setLanguage: (language) => ipcRenderer.invoke('set-language', language),
  
  // 自定义快捷键
  setShortcuts: (shortcuts) => ipcRenderer.invoke('set-shortcuts', shortcuts),
  
  // 开机延迟启动
  setStartupDelay: (seconds) => ipcRenderer.invoke('set-startup-delay', seconds),
  
  // 布局导出/导入
  exportLayout: (extraData) => ipcRenderer.invoke('export-layout', extraData),
  importLayout: (importGroups) => ipcRenderer.invoke('import-layout', importGroups),
  
  // Everything 搜索集成
  checkEverything: () => ipcRenderer.invoke('check-everything'),
  openEverythingSearch: (keyword) => ipcRenderer.invoke('open-everything-search', keyword),
  setEverythingEnabled: (enabled) => ipcRenderer.invoke('set-everything-enabled', enabled),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 自定义背景图片
  selectBackgroundImage: () => ipcRenderer.invoke('select-background-image'),
  setBackgroundSettings: (settings) => ipcRenderer.invoke('set-background-settings', settings),
  clearBackground: () => ipcRenderer.invoke('clear-background'),
  getBackgroundData: () => ipcRenderer.invoke('get-background-data'),
  
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
  
  // 监听全局快捷键触发的刷新
  onRefreshFiles: (callback) => ipcRenderer.on('refresh-files', () => callback()),
  
  // 监听桌面文件变化
  onDesktopChanged: (callback) => ipcRenderer.on('desktop-changed', () => callback()),
  
  // 监听语言变化
  onLanguageChanged: (callback) => ipcRenderer.on('language-changed', (event, data) => callback(data)),
  
  // 右键菜单 API
  showDesktopContextMenu: (x, y) => ipcRenderer.invoke('show-desktop-context-menu', x, y),
  showFileContextMenu: (filePath, x, y) => ipcRenderer.invoke('show-file-context-menu', filePath, x, y),
  cancelDesktopContextMenu: () => ipcRenderer.invoke('cancel-desktop-context-menu'),
  
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  deleteFile: (filePath, permanent) => ipcRenderer.invoke('delete-file', filePath, permanent)
});
