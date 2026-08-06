const { app, BrowserWindow, ipcMain, shell, nativeTheme, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const Store = require('electron-store');
const { getFileIcon, getFileIcons, initializeDesktopAPI, getSystemIconEmoji, cleanupIconCache } = require('./desktop-api');
const { showDesktopContextMenu, showFileContextMenu, cancelDesktopContextMenu, compileExe } = require('./shell-context-menu');
const { 
  createMainWindow, 
  setAutoHideEnabled, 
  getAutoHideStatus,
  EDGE_TYPES 
} = require('./window-manager');
const { createTray, updateTrayMenu, destroyTray, autoLauncher } = require('./tray');

const store = new Store({
  name: 'desktop-icon-hider',
  defaults: {
    windowBounds: null,
    isCollapsed: false,
    autoLaunch: false,
    autoHideEnabled: false,
    autoHideEdge: 'none',
    theme: 'dark',
    language: 'zh-CN',
    lastPosition: null,
    windowState: 'normal',
    sortBy: 'name-asc',
    opacity: 92,
    iconSize: 40,
    manualOrder: [],
    groups: [],
    groupDisplayMode: 'folder',
    groupThumbStyle: 'real',
    iconsLocked: false,
    arrangeRules: [],
    startupDelay: 0,
    folderPreviewEnabled: true,
    everythingEnabled: false,
    backgroundImage: {
      enabled: false,
      path: null,
      blur: 24,
      dim: 45
    },
    widgets: [],
    showWidgets: true,
    weatherCity: null, // { name, lat, lon }
    shortcuts: {
      toggleWindow: 'CommandOrControl+Alt+D',
      refresh: 'CommandOrControl+Alt+R'
    }
  }
});
let mainWindow = null;
let tray = null;
let fsWatchers = [];

// 获取桌面路径
function getDesktopPath() {
  return path.join(process.env.USERPROFILE || '', 'Desktop');
}

// 校验路径是否属于本应用的桌面管辖范围（用户桌面/公共桌面/系统虚拟文件夹），
// 防止渲染进程通过 IPC 操作任意文件
function isAllowedPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  if (filePath.startsWith('::')) return true; // 系统虚拟文件夹（此电脑、回收站等），仅只读用途
  const normalized = filePath.toLowerCase();
  const userDesktop = getDesktopPath().toLowerCase();
  if (userDesktop.endsWith('desktop') && normalized.startsWith(userDesktop + '\\')) return true;
  const publicDesktop = getPublicDesktopPath().toLowerCase();
  if (publicDesktop.endsWith('desktop') && normalized.startsWith(publicDesktop + '\\')) return true;
  return false;
}

// 获取公共桌面路径（登录会话内不变，缓存避免每次刷新启动 PowerShell）
let cachedPublicDesktopPath = null;

function getPublicDesktopPath() {
  if (cachedPublicDesktopPath !== null) return cachedPublicDesktopPath;
  try {
    // 使用 PowerShell 获取公共桌面路径
    const result = execSync(
      'powershell -Command "[Environment]::GetFolderPath(\'CommonDesktopDirectory\')"',
      { timeout: 5000, encoding: 'utf8' }
    );
    cachedPublicDesktopPath = result.trim();
  } catch (e) {
    // 回退到默认路径
    cachedPublicDesktopPath = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Desktop');
  }
  return cachedPublicDesktopPath;
}

// ============ 桌面文件自动监听 ============
let desktopWatchDebounce = null;

function sendDesktopChanged() {
  if (desktopWatchDebounce) clearTimeout(desktopWatchDebounce);
  desktopWatchDebounce = setTimeout(() => {
    desktopWatchDebounce = null;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('desktop-changed');
    }
  }, 400);
}

function startDesktopWatchers() {
  stopDesktopWatchers();
  const dirs = new Set([getDesktopPath(), getPublicDesktopPath()]);
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (!filename) return;
        const name = String(filename).toLowerCase();
        if (name === 'desktop.ini') return;
        if (name.endsWith('.tmp') || name.startsWith('~$')) return;
        sendDesktopChanged();
      });
      watcher.on('error', (e) => console.warn('桌面监听错误:', e.message));
      fsWatchers.push(watcher);
    } catch (e) {
      console.warn('无法监听目录:', dir, e.message);
    }
  }
}

function stopDesktopWatchers() {
  for (const watcher of fsWatchers) {
    try { watcher.close(); } catch (e) { /* 忽略 */ }
  }
  fsWatchers = [];
}

// ============ 文件夹预览 ============
async function listDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return [];
  // 系统虚拟文件夹（此电脑、回收站等 `::` 路径）用 Shell COM 枚举
  if (dirPath.startsWith('::')) {
    return await listSystemFolder(dirPath);
  }
  try {
    const stats = await fs.promises.stat(dirPath);
    if (!stats.isDirectory()) return [];
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.name !== 'desktop.ini')
      .slice(0, 60)
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name)
      }));
  } catch (e) {
    return [];
  }
}

async function listSystemFolder(displayPath) {
  try {
    const psScript = `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace($env:DIH_SYS_PATH)
if ($null -eq $folder) { Write-Output 'null'; exit 0 }
$items = @()
foreach ($item in $folder.Items()) {
  $p = ''
  try { $p = $item.Path } catch { }
  $items += @{ name = $item.Name; isDirectory = [bool]$item.IsFolder; path = $p }
}
$items | ConvertTo-Json -Depth 2 -Compress`;
    const tempFile = path.join(os.tmpdir(), `temp-sysfolder-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, psScript, 'utf8');
    let result = null;
    try {
      result = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempFile}"`,
        {
          timeout: 8000,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          env: { ...process.env, DIH_SYS_PATH: displayPath }
        }
      );
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 忽略 */ }
    }
    if (!result || result.trim() === 'null' || result.trim() === '') return [];
    const items = JSON.parse(result.trim());
    if (!Array.isArray(items)) return [];
    return items.slice(0, 60).map(i => ({
      name: String(i.name || ''),
      isDirectory: !!i.isDirectory,
      path: typeof i.path === 'string' && i.path ? i.path : null
    }));
  } catch (e) {
    return [];
  }
}

// ============ 图片悬停预览 ============
const IMAGE_PREVIEW_MAX_SIZE = 25 * 1024 * 1024; // 25MB
const IMAGE_PREVIEW_MAX_DIM = 480;

async function getImagePreview(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return null;
    if (stats.size > IMAGE_PREVIEW_MAX_SIZE) return null;
    const ext = path.extname(filePath).toLowerCase();
    // SVG：nativeImage 不支持，读文本转 data URL
    if (ext === '.svg') {
      const text = await fs.promises.readFile(filePath, 'utf8');
      const base64 = Buffer.from(text, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${base64}`;
    }
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    if (!size || !size.width || !size.height) return null;
    let finalImg = img;
    const scale = Math.min(1, IMAGE_PREVIEW_MAX_DIM / Math.max(size.width, size.height));
    if (scale < 1) {
      finalImg = img.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best'
      });
    }
    return finalImg.toDataURL();
  } catch (e) {
    return null;
  }
}

// ============ 剪贴板文件操作 ============
async function copyPath(src, dest) {
  const stats = await fs.promises.stat(src);
  if (stats.isDirectory()) {
    await fs.promises.cp(src, dest, { recursive: true, errorOnExist: true });
  } else {
    await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
  }
}

async function movePath(src, dest) {
  try {
    await fs.promises.rename(src, dest);
  } catch (e) {
    // 跨卷移动时回退到复制+删除
    await copyPath(src, dest);
    await fs.promises.rm(src, { recursive: true, force: true });
  }
}

async function pasteClipboard({ mode, paths, targetDir }) {
  if (!Array.isArray(paths) || paths.length === 0 || !targetDir) {
    return { success: false, error: '无效的粘贴参数' };
  }
  if (!isAllowedPath(targetDir)) {
    return { success: false, error: '目标目录不允许' };
  }
  if (!fs.existsSync(targetDir)) {
    return { success: false, error: '目标目录不存在' };
  }
  // 源路径同样限制在桌面管辖范围，防止复制/移动任意文件
  if (!paths.every(p => isAllowedPath(p))) {
    return { success: false, error: '源路径不允许' };
  }
  const results = [];
  let anySuccess = false;
  for (const src of paths) {
    const name = path.basename(src);
    let dest = path.join(targetDir, name);
    if (src.toLowerCase() === dest.toLowerCase() && path.dirname(src).toLowerCase() === targetDir.toLowerCase()) {
      dest = src;
    }
    try {
      if (src === dest) {
        results.push({ name, ok: true, skipped: true });
        continue;
      }
      if (fs.existsSync(dest)) {
        // 重名冲突：追加 (1)、(2)...
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        let i = 1;
        while (fs.existsSync(path.join(targetDir, `${base} (${i})${ext}`))) i++;
        dest = path.join(targetDir, `${base} (${i})${ext}`);
      }
      if (mode === 'cut') {
        await movePath(src, dest);
      } else {
        await copyPath(src, dest);
      }
      anySuccess = true;
      results.push({ name: path.basename(dest), ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  return { success: anySuccess, results };
}

// 获取系统图标（此电脑、回收站、网络等）
// PowerShell COM 枚举开销大，缓存 30 秒避免每次刷新都启动进程
let systemIconsCache = null;
let systemIconsCacheTime = 0;
const SYSTEM_ICONS_CACHE_TTL = 30 * 1000;

function getSystemIcons() {
  const now = Date.now();
  if (systemIconsCache && (now - systemIconsCacheTime) < SYSTEM_ICONS_CACHE_TTL) {
    return systemIconsCache;
  }
  try {
    const psScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$shell = New-Object -ComObject Shell.Application
$desktop = $shell.Namespace(0)
$items = @()
foreach ($item in $desktop.Items()) {
  $items += @{
    Name = $item.Name
    Path = $item.Path
    IsFolder = $item.IsFolder
    IsSystem = $true
  }
}
$items | ConvertTo-Json -Depth 3`;
    
    const tempFile = path.join(os.tmpdir(), `temp-system-icons-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, psScript, 'utf8');
    
    let result = null;
    try {
      result = execSync(
        `powershell -ExecutionPolicy Bypass -File "${tempFile}"`,
        { timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
      );
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 临时文件可能已被清理，忽略 */ }
    }
    
    if (!result || result.trim() === 'null') {
      return [];
    }
    
    const items = JSON.parse(result);
    
    const resultItems = [];
    for (const item of items) {
      const itemPath = item.Path || '';
      const isVirtual = !itemPath.match(/^[A-Z]:\\Users\\[^\\]+\\Desktop\\/i);
      
      if (isVirtual && (itemPath.startsWith('::') || itemPath.includes('::'))) {
        resultItems.push({
          name: item.Name,
          path: itemPath,
          isDirectory: item.IsFolder || false,
          size: 0,
          isSystem: true
        });
      }
    }
    systemIconsCache = resultItems;
    systemIconsCacheTime = now;
    return resultItems;
  } catch (e) {
    console.error('获取系统图标失败:', e.message);
    return [];
  }
}

// 获取桌面文件列表
async function getDesktopFiles() {
  try {
    const items = [];
    const seenPaths = new Set();
    const CONCURRENCY_LIMIT = 10;
    
    // 扫描用户桌面
    const userDesktopPath = getDesktopPath();
    if (fs.existsSync(userDesktopPath)) {
      try {
        const files = await fs.promises.readdir(userDesktopPath);
        const filteredFiles = files.filter(file => file !== 'desktop.ini');
        const userItems = await processFilesWithConcurrency(
          filteredFiles,
          userDesktopPath,
          seenPaths,
          CONCURRENCY_LIMIT
        );
        for (const item of userItems) {
          items.push(item);
          seenPaths.add(item.path.toLowerCase());
        }
      } catch (e) {
        console.error('扫描用户桌面失败:', e);
      }
    }
    
    // 扫描公共桌面
    const publicDesktopPath = getPublicDesktopPath();
    if (publicDesktopPath && fs.existsSync(publicDesktopPath)) {
      try {
        const files = await fs.promises.readdir(publicDesktopPath);
        const filteredFiles = files.filter(file => file !== 'desktop.ini');
        const publicItems = await processFilesWithConcurrency(
          filteredFiles,
          publicDesktopPath,
          seenPaths,
          CONCURRENCY_LIMIT
        );
        for (const item of publicItems) {
          items.push(item);
          seenPaths.add(item.path.toLowerCase());
        }
      } catch (e) {
        console.error('扫描公共桌面失败:', e);
      }
    }
    
    // 获取系统图标（此电脑、回收站等）
    const systemIcons = getSystemIcons();
    for (const icon of systemIcons) {
      // 过滤掉已经在文件列表中存在的项
      if (!seenPaths.has(icon.path.toLowerCase()) && 
          !items.some(item => item.name.toLowerCase() === icon.name.toLowerCase())) {
        items.push(icon);
      }
    }
    
    return items;
  } catch (error) {
    console.error('获取桌面文件失败:', error);
    return [];
  }
}

// 带并发限制的文件处理函数
async function processFilesWithConcurrency(files, basePath, seenPaths, limit) {
  const results = [];
  let index = 0;
  
  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      try {
        const filePath = path.join(basePath, file);
        if (seenPaths.has(filePath.toLowerCase())) continue;
        const stats = await fs.promises.stat(filePath);
        results.push({
          name: file,
          path: filePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          extension: stats.isDirectory() ? '' : path.extname(file).toLowerCase(),
          modified: stats.mtime,
          isSystem: false
        });
      } catch (e) {
        // 跳过无法访问的文件
      }
    }
  }
  
  const workers = Array.from({ length: Math.min(limit, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 隐藏桌面图标
function hideDesktopIcons() {
  try {
    const psScript = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public static void Hide() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) {
            ShowWindow(shellView, 0);
        }
    }
}
"@
[DesktopHelper]::Hide()`;
    
    const tempFile = path.join(os.tmpdir(), `temp-hide-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, psScript, 'utf8');
    
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, { 
        timeout: 10000,
        encoding: 'utf8'
      });
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 临时文件可能已被清理，忽略 */ }
    }
    return true;
  } catch (error) {
    console.error('隐藏桌面图标失败:', error.message);
    return false;
  }
}

// 显示桌面图标
function showDesktopIcons() {
  try {
    const psScript = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public static void Show() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) {
            ShowWindow(shellView, 5);
            PostMessage(progman, 0x0111, new IntPtr(0x7402), IntPtr.Zero);
        }
    }
}
"@
[DesktopHelper]::Show()`;
    
    const tempFile = path.join(os.tmpdir(), `temp-show-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, psScript, 'utf8');
    
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, { 
        timeout: 10000,
        encoding: 'utf8'
      });
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 临时文件可能已被清理，忽略 */ }
    }
    return true;
  } catch (error) {
    console.error('显示桌面图标失败:', error.message);
    return false;
  }
}

// 创建主窗口
function createWindow() {
  mainWindow = createMainWindow(store);
  
  if (mainWindow) {
    mainWindow.once('ready-to-show', async () => {
      try {
        const files = await getDesktopFiles();
        mainWindow.webContents.send('init-data', {
          files,
          isCollapsed: store.get('isCollapsed', false),
          autoHideEnabled: store.get('autoHideEnabled', false),
          autoHideEdge: store.get('autoHideEdge', EDGE_TYPES.NONE),
          sortBy: store.get('sortBy', 'name-asc'),
          theme: store.get('theme', 'dark'),
          opacity: store.get('opacity', 92),
          iconSize: store.get('iconSize', 40),
          autoLaunch: store.get('autoLaunch', false),
          manualOrder: store.get('manualOrder', []),
          groups: store.get('groups', []),
          groupDisplayMode: store.get('groupDisplayMode', 'folder'),
          groupThumbStyle: store.get('groupThumbStyle', 'real'),
          iconsLocked: store.get('iconsLocked', false),
          arrangeRules: store.get('arrangeRules', []),
          shortcuts: store.get('shortcuts', {}),
          startupDelay: store.get('startupDelay', 0),
          language: store.get('language', 'zh-CN'),
          everythingEnabled: store.get('everythingEnabled', false),
          everythingInstalled: !!findEverythingPath(),
          everythingRunAsAdmin: !!findEverythingPath() && isEverythingRunAsAdmin(findEverythingPath()),
          folderPreviewEnabled: store.get('folderPreviewEnabled', true),
          backgroundImage: store.get('backgroundImage', {}),
          backgroundData: await getBackgroundData(),
          widgets: store.get('widgets', []),
          showWidgets: store.get('showWidgets', true),
          weatherCity: store.get('weatherCity', null)
        });
      } catch (error) {
        console.error('发送初始化数据失败:', error);
        mainWindow.webContents.send('init-data', {
          files: [],
          isCollapsed: store.get('isCollapsed', false),
          autoHideEnabled: store.get('autoHideEnabled', false),
          autoHideEdge: store.get('autoHideEdge', EDGE_TYPES.NONE),
          sortBy: store.get('sortBy', 'name-asc'),
          theme: store.get('theme', 'dark'),
          opacity: store.get('opacity', 92),
          iconSize: store.get('iconSize', 40),
          autoLaunch: store.get('autoLaunch', false),
          manualOrder: store.get('manualOrder', []),
          groups: store.get('groups', []),
          groupDisplayMode: store.get('groupDisplayMode', 'folder'),
          groupThumbStyle: store.get('groupThumbStyle', 'real'),
          iconsLocked: store.get('iconsLocked', false),
          arrangeRules: store.get('arrangeRules', []),
          shortcuts: store.get('shortcuts', {}),
          startupDelay: store.get('startupDelay', 0),
          language: store.get('language', 'zh-CN'),
          everythingEnabled: store.get('everythingEnabled', false),
          everythingInstalled: false,
          everythingRunAsAdmin: false,
          folderPreviewEnabled: store.get('folderPreviewEnabled', true),
          backgroundImage: store.get('backgroundImage', {}),
          backgroundData: null,
          widgets: store.get('widgets', []),
          showWidgets: store.get('showWidgets', true),
          weatherCity: store.get('weatherCity', null)
        });
      }
    });
    
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        // hide 事件会触发 updateTrayMenu，无需重复调用
      } else {
        try {
          showDesktopIcons();
        } catch (error) {
          console.error('关闭时显示桌面图标失败:', error);
        }
      }
    });
    
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    
    mainWindow.on('show', () => {
      if (tray) {
        updateTrayMenu(mainWindow, store);
      }
    });
    
    mainWindow.on('hide', () => {
      if (tray) {
        updateTrayMenu(mainWindow, store);
      }
    });
    
    mainWindow.on('moved', () => {
      if (mainWindow && !mainWindow.isCollapsed) {
        store.set('windowBounds', mainWindow.getBounds());
      }
    });
    
    mainWindow.on('resized', () => {
      if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isCollapsed) {
        const bounds = mainWindow.getBounds();
        if (bounds.height > 50) {
          store.set('windowBounds', bounds);
        }
      }
    });
    
    // F12 / Ctrl+Shift+I 打开开发者工具
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
  
  return mainWindow;
}

// IPC 处理
ipcMain.handle('get-files', async () => {
  try {
    return await getDesktopFiles();
  } catch (error) {
    console.error('获取文件列表失败:', error);
    return [];
  }
});

ipcMain.handle('toggle-collapse', async (event, collapse) => {
  if (!mainWindow) return false;
  
  const bounds = mainWindow.getBounds();
  mainWindow.isCollapsed = !!collapse;
  store.set('isCollapsed', !!collapse);
  
  // 取消所有自动隐藏定时器
  if (mainWindow.autoHideState) {
    if (mainWindow.autoHideState.hideTimer) {
      clearTimeout(mainWindow.autoHideState.hideTimer);
      mainWindow.autoHideState.hideTimer = null;
    }
    if (mainWindow.autoHideState.showTimer) {
      clearTimeout(mainWindow.autoHideState.showTimer);
      mainWindow.autoHideState.showTimer = null;
    }
  }
  
  if (collapse) {
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: 40
    }, true);
  } else {
    const savedBounds = store.get('windowBounds');
    const savedHeight = (savedBounds && typeof savedBounds.height === 'number') ? savedBounds.height : 600;
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(savedHeight, 200)
    }, true);
    
    // 展开时重置隐藏状态
    if (mainWindow.autoHideState) {
      mainWindow.autoHideState.isHidden = false;
    }
  }
  
  return true;
});

ipcMain.handle('quit-app', async () => {
  // 设置退出标志
  app.isQuitting = true;
  // 退出应用，before-quit 事件会处理显示桌面图标的逻辑
  app.quit();
});

ipcMain.handle('refresh-files', async () => {
  try {
    const files = await getDesktopFiles();
    cleanupIconCache(files.map(f => f.path));
    return files;
  } catch (error) {
    console.error('刷新文件列表失败:', error);
    return [];
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  if (!isAllowedPath(filePath)) return { success: false, error: '路径不允许' };
  try {
    const errorMessage = await shell.openPath(filePath);
    return { success: !errorMessage, error: errorMessage || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-in-explorer', (event, filePath) => {
  if (!isAllowedPath(filePath)) return false;
  try {
    shell.showItemInFolder(filePath);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('list-directory', async (event, dirPath) => {
  if (!isAllowedPath(dirPath)) return [];
  return await listDirectory(dirPath);
});

ipcMain.handle('get-image-preview', async (event, filePath) => {
  if (!isAllowedPath(filePath)) return null;
  return await getImagePreview(filePath);
});

ipcMain.handle('paste-clipboard', async (event, payload) => {
  return await pasteClipboard(payload);
});

ipcMain.handle('set-icons-locked', async (event, locked) => {
  store.set('iconsLocked', !!locked);
  return true;
});

ipcMain.handle('set-group-display-mode', async (event, mode) => {
  if (!['tab', 'folder'].includes(mode)) return false;
  store.set('groupDisplayMode', mode);
  return true;
});

ipcMain.handle('set-group-thumb-style', async (event, style) => {
  if (!['real', 'emoji'].includes(style)) return false;
  store.set('groupThumbStyle', style);
  return true;
});

// ============ 小组件 ============
ipcMain.handle('set-widgets', async (event, widgets) => {
  try {
    if (!Array.isArray(widgets)) return false;
    const sanitized = widgets.map(w => ({
      id: String(w.id || ''),
      type: ['clock', 'calendar', 'weather'].includes(w.type) ? w.type : 'clock',
      x: Number.isFinite(w.x) ? Math.max(0, Math.min(95, w.x)) : 2,
      y: Number.isFinite(w.y) ? Math.max(0, Math.min(90, w.y)) : 2
    })).filter(w => w.id);
    store.set('widgets', sanitized);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('set-show-widgets', async (event, enabled) => {
  store.set('showWidgets', !!enabled);
  return true;
});

// ============ 天气组件（Open-Meteo，免费无需 key） ============
let weatherCache = null; // { data, fetchedAt }
const WEATHER_CACHE_TTL = 10 * 60 * 1000; // 10 分钟

async function searchCity(name) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const result = json.results && json.results[0];
    if (!result) return { success: false, error: '未找到该城市' };
    return {
      success: true,
      city: {
        name: result.name,
        lat: result.latitude,
        lon: result.longitude
      }
    };
  } catch (e) {
    return { success: false, error: e.message || '网络请求失败' };
  }
}

// WMO 天气码 → { emoji, text }
function mapWeatherCode(code) {
  if (code === 0) return { emoji: '\u{2600}\uFE0F', text: '晴' };
  if (code === 1) return { emoji: '\u{1F324}\uFE0F', text: '基本晴朗' };
  if (code === 2) return { emoji: '\u{26C5}', text: '多云' };
  if (code === 3) return { emoji: '\u{2601}\uFE0F', text: '阴' };
  if (code === 45 || code === 48) return { emoji: '\u{1F32B}\uFE0F', text: '雾' };
  if (code >= 51 && code <= 57) return { emoji: '\u{1F326}\uFE0F', text: '毛毛雨' };
  if (code >= 61 && code <= 67) return { emoji: '\u{1F327}\uFE0F', text: '雨' };
  if (code >= 71 && code <= 77) return { emoji: '\u{2744}\uFE0F', text: '雪' };
  if (code >= 80 && code <= 82) return { emoji: '\u{1F326}\uFE0F', text: '阵雨' };
  if (code >= 85 && code <= 86) return { emoji: '\u{1F328}\uFE0F', text: '阵雪' };
  if (code === 95) return { emoji: '\u{26C8}\uFE0F', text: '雷暴' };
  if (code === 96 || code === 99) return { emoji: '\u{26C8}\uFE0F', text: '雷暴冰雹' };
  return { emoji: '\u{1F30C}', text: String(code) };
}

async function getWeather() {
  const city = store.get('weatherCity', null);
  if (!city || !city.lat || !city.lon) {
    return { success: false, needCity: true };
  }
  // 缓存命中
  if (weatherCache && (Date.now() - weatherCache.fetchedAt) < WEATHER_CACHE_TTL) {
    return { success: true, ...weatherCache.data };
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const current = json.current;
    if (!current) return { success: false, error: '天气数据格式异常' };
    const wmo = mapWeatherCode(current.weather_code);
    const daily = json.daily;
    const data = {
      city: city.name,
      temp: Math.round(current.temperature_2m),
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m,
      emoji: wmo.emoji,
      text: wmo.text,
      todayMax: daily && Number.isFinite(daily.temperature_2m_max[0]) ? Math.round(daily.temperature_2m_max[0]) : null,
      todayMin: daily && Number.isFinite(daily.temperature_2m_min[0]) ? Math.round(daily.temperature_2m_min[0]) : null,
      updatedAt: Date.now()
    };
    weatherCache = { data, fetchedAt: Date.now() };
    return { success: true, ...data };
  } catch (e) {
    return { success: false, error: e.message || '网络请求失败' };
  }
}

ipcMain.handle('search-city', async (event, name) => {
  return await searchCity(name);
});

ipcMain.handle('get-weather', async () => {
  return await getWeather();
});

ipcMain.handle('set-weather-city', async (event, city) => {
  try {
    if (!city || typeof city.name !== 'string' || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) {
      return false;
    }
    weatherCache = null; // 城市变更后清除缓存
    store.set('weatherCity', { name: city.name, lat: city.lat, lon: city.lon });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('set-folder-preview-enabled', async (event, enabled) => {
  store.set('folderPreviewEnabled', !!enabled);
  return true;
});

ipcMain.handle('set-arrange-rules', async (event, rules) => {
  try {
    if (!Array.isArray(rules)) return false;
    const sanitized = rules.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      keywords: Array.isArray(r.keywords) ? r.keywords.filter(k => typeof k === 'string').slice(0, 50) : [],
      extensions: Array.isArray(r.extensions) ? r.extensions.filter(e => typeof e === 'string').map(e => e.toLowerCase()).slice(0, 50) : []
    })).filter(r => r.id);
    store.set('arrangeRules', sanitized);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('set-language', async (event, language) => {
  if (!['zh-CN', 'en-US'].includes(language)) return false;
  store.set('language', language);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('language-changed', { language });
  }
  return true;
});

ipcMain.handle('set-shortcuts', async (event, shortcuts) => {
  try {
    if (!shortcuts || typeof shortcuts !== 'object') return false;
    const sanitized = {
      toggleWindow: String(shortcuts.toggleWindow || DEFAULT_SHORTCUTS.TOGGLE_WINDOW),
      refresh: String(shortcuts.refresh || DEFAULT_SHORTCUTS.REFRESH)
    };
    // 两个快捷键相同会导致其中一个注册失败
    if (sanitized.toggleWindow === sanitized.refresh) return false;

    globalShortcut.unregisterAll();
    const reg1 = globalShortcut.register(sanitized.toggleWindow, handleGlobalToggleWindow);
    const reg2 = globalShortcut.register(sanitized.refresh, handleGlobalRefresh);
    if (!reg1 || !reg2) {
      // 注册失败（非法/被占用）：恢复旧快捷键，不保存新配置
      globalShortcut.unregisterAll();
      registerGlobalShortcuts();
      return false;
    }
    store.set('shortcuts', sanitized);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('set-startup-delay', async (event, seconds) => {
  const delay = Number.isFinite(seconds) ? Math.max(0, Math.min(600, Math.round(seconds))) : 0;
  store.set('startupDelay', delay);
  return true;
});

// ============ Everything 搜索集成 ============
function getFixedDriveLetters() {
  const drives = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code) + ':\\';
    if (fs.existsSync(letter)) drives.push(letter);
  }
  return drives;
}

function findEverythingPath() {
  const candidates = [];
  // 注册表 App Paths（HKLM / HKCU / WOW6432Node）
  try {
    const result = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe" /ve 2>nul || reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe" /ve 2>nul || reg query "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe" /ve 2>nul',
      { timeout: 3000, encoding: 'utf8' }
    );
    const m = result.match(/REG_SZ\s+(\S.+)/);
    if (m) {
      const p = m[1].trim();
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (e) { /* 未注册 */ }
  // 遍历所有盘符的常见安装位置（用户可能装在非 C 盘）
  for (const drive of getFixedDriveLetters()) {
    candidates.push(path.join(drive, 'Program Files', 'Everything', 'Everything.exe'));
    candidates.push(path.join(drive, 'Program Files (x86)', 'Everything', 'Everything.exe'));
    candidates.push(path.join(drive, 'Program Files', 'Everything 1.5a', 'Everything.exe'));
    candidates.push(path.join(drive, 'Everything', 'Everything.exe'));
  }
  // 便携版常见位置
  candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Everything', 'Everything.exe'));
  candidates.push(path.join(process.env.USERPROFILE || '', 'Downloads', 'Everything', 'Everything.exe'));
  candidates.push(path.join(process.env.USERPROFILE || '', 'Desktop', 'Everything', 'Everything.exe'));

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  // 最后兜底：正在运行的 Everything 进程路径
  try {
    const result = execSync(
      'powershell -NoProfile -Command "(Get-Process -Name Everything -ErrorAction SilentlyContinue | Select-Object -First 1).Path"',
      { timeout: 4000, encoding: 'utf8' }
    );
    const p = (result || '').trim();
    if (p && fs.existsSync(p)) return p;
  } catch (e) { /* 忽略 */ }
  return null;
}

function openEverythingSearch(keyword) {
  const exePath = findEverythingPath();
  if (!exePath) return { ok: false, installed: false };
  try {
    const child = spawn(exePath, ['-search', String(keyword)], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { ok: true, installed: true, runAsAdmin: isEverythingRunAsAdmin(exePath) };
  } catch (e) {
    console.error('启动 Everything 搜索失败:', e.message);
    return { ok: false, installed: true, error: e.message };
  }
}

// 检测 Everything 是否配置为"以管理员身份运行"（run_as_admin=1）
// 该配置会导致从普通权限应用唤起时触发 UAC 提权确认
function isEverythingRunAsAdmin(exePath) {
  try {
    const candidates = [];
    if (exePath) {
      candidates.push(path.join(path.dirname(exePath), 'Everything.ini'));
    }
    candidates.push(path.join(process.env.APPDATA || '', 'Everything', 'Everything.ini'));
    for (const ini of candidates) {
      if (ini && fs.existsSync(ini)) {
        const content = fs.readFileSync(ini, 'utf8');
        const m = content.match(/^run_as_admin\s*=\s*(\d+)/m);
        if (m && m[1] === '1') return true;
      }
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

ipcMain.handle('check-everything', async () => {
  const p = findEverythingPath();
  return {
    installed: !!p,
    path: p,
    runAsAdmin: !!p && isEverythingRunAsAdmin(p)
  };
});

ipcMain.handle('open-everything-search', async (event, keyword) => {
  return openEverythingSearch(keyword);
});

ipcMain.handle('set-everything-enabled', async (event, enabled) => {
  store.set('everythingEnabled', !!enabled);
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
});

// ============ 自定义背景图片 ============
const BACKGROUND_MAX_DIM = 2560;
let backgroundDir = null;

function getBackgroundDir() {
  if (!backgroundDir) {
    backgroundDir = path.join(app.getPath('userData'), 'backgrounds');
  }
  return backgroundDir;
}

function getBackgroundFilePath() {
  return path.join(getBackgroundDir(), 'bg.jpg');
}

async function selectBackgroundImage() {
  try {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景图片',
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }
      ],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const srcPath = filePaths[0];
    const img = nativeImage.createFromPath(srcPath);
    if (img.isEmpty()) {
      return { success: false, error: '无法读取该图片' };
    }
    const size = img.getSize();
    let finalImg = img;
    if (size && size.width && size.height) {
      const scale = Math.min(1, BACKGROUND_MAX_DIM / Math.max(size.width, size.height));
      if (scale < 1) {
        finalImg = img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        });
      }
    }
    const jpegData = finalImg.toJPEG(85);
    if (!jpegData || jpegData.length === 0) {
      return { success: false, error: '图片编码失败' };
    }
    await fs.promises.mkdir(getBackgroundDir(), { recursive: true });
    await fs.promises.writeFile(getBackgroundFilePath(), jpegData);
    const config = store.get('backgroundImage', {});
    config.path = getBackgroundFilePath();
    config.enabled = true;
    store.set('backgroundImage', config);
    return { success: true, config, dataUrl: `data:image/jpeg;base64,${jpegData.toString('base64')}` };
  } catch (e) {
    console.error('选择背景图片失败:', e.message);
    return { success: false, error: e.message };
  }
}

async function getBackgroundData() {
  try {
    const config = store.get('backgroundImage', {});
    if (!config || !config.path || !fs.existsSync(config.path)) return null;
    const data = await fs.promises.readFile(config.path);
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

async function clearBackground() {
  try {
    const config = store.get('backgroundImage', {});
    config.enabled = false;
    config.path = null;
    store.set('backgroundImage', config);
    try {
      if (fs.existsSync(getBackgroundFilePath())) {
        await fs.promises.unlink(getBackgroundFilePath());
      }
    } catch (e) { /* 忽略 */ }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

ipcMain.handle('select-background-image', async () => {
  return await selectBackgroundImage();
});

ipcMain.handle('set-background-settings', async (event, settings) => {
  try {
    const config = store.get('backgroundImage', {});
    if (typeof settings.enabled === 'boolean') config.enabled = settings.enabled;
    if (Number.isFinite(settings.blur)) {
      config.blur = Math.max(0, Math.min(60, Math.round(settings.blur)));
    }
    if (Number.isFinite(settings.dim)) {
      config.dim = Math.max(0, Math.min(80, Math.round(settings.dim)));
    }
    store.set('backgroundImage', config);
    return { success: true, config };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('clear-background', async () => {
  return await clearBackground();
});

ipcMain.handle('get-background-data', async () => {
  return await getBackgroundData();
});

// 布局导出/导入
ipcMain.handle('export-layout', async (event, extraData) => {
  try {
    const { dialog } = require('electron');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出桌面布局',
      defaultPath: `desktop-layout-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    const layout = {
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: store.get('groups', []),
      manualOrder: store.get('manualOrder', []),
      sortBy: store.get('sortBy', 'name-asc'),
      ...(extraData || {})
    };
    await fs.promises.writeFile(filePath, JSON.stringify(layout, null, 2), 'utf8');
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-layout', async (event, importGroups) => {
  try {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入桌面布局',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
    const raw = await fs.promises.readFile(filePaths[0], 'utf8');
    const layout = JSON.parse(raw);
    const result = {};
    if (layout.groups && Array.isArray(layout.groups) && importGroups) {
      const sanitized = layout.groups.map(g => ({
        id: String(g.id || ''),
        name: String(g.name || '未命名'),
        paths: Array.isArray(g.paths) ? g.paths.filter(p => typeof p === 'string') : []
      })).filter(g => g.id);
      store.set('groups', sanitized);
      result.groups = sanitized;
    }
    if (layout.manualOrder && Array.isArray(layout.manualOrder)) {
      store.set('manualOrder', layout.manualOrder);
      result.manualOrder = layout.manualOrder;
    }
    if (layout.sortBy && typeof layout.sortBy === 'string') {
      store.set('sortBy', layout.sortBy);
      result.sortBy = layout.sortBy;
    }
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-file', async (event, oldPath, newName) => {
  try {
    if (!isAllowedPath(oldPath)) return { success: false, error: '路径不允许' };
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    if (oldPath === newPath) return { success: true };
    // Windows 大小写不敏感：仅大小写变化时允许重命名
    const isCaseOnlyChange = oldPath.toLowerCase() === newPath.toLowerCase();
    if (!isCaseOnlyChange && fs.existsSync(newPath)) {
      return { success: false, error: '文件名已存在' };
    }
    await fs.promises.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, filePath, permanent) => {
  try {
    if (!isAllowedPath(filePath)) return { success: false, error: '路径不允许' };
    if (permanent) {
      const stats = await fs.promises.stat(filePath);
      if (stats.isDirectory()) {
        await fs.promises.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(filePath);
      }
    } else {
      await shell.trashItem(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('move-window', (event, newX, newY) => {
  if (mainWindow && Number.isFinite(newX) && Number.isFinite(newY)) {
    mainWindow.setPosition(Math.round(newX), Math.round(newY));
  }
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
  try {
    if (!isAllowedPath(filePath)) return null;
    if (filePath && filePath.startsWith('::')) {
      return getSystemIconEmoji(filePath) || '\u{1F4C1}';
    }
    const stats = fs.statSync(filePath);
    const file = {
      path: filePath,
      isDirectory: stats.isDirectory()
    };
    const icon = await getFileIcon(file);
    return icon;
  } catch (error) {
    return null;
  }
});

// 批量获取文件图标
ipcMain.handle('get-file-icons', async (event, files) => {
  try {
    if (!Array.isArray(files)) {
      console.error('get-file-icons: 参数必须是数组');
      return {};
    }
    
    // 确保每个文件对象都有必要属性
    const validatedFiles = files.map(file => {
      if (typeof file === 'string') {
        // 如果是字符串路径，尝试获取文件状态
        try {
          const stats = fs.statSync(file);
          return {
            path: file,
            isDirectory: stats.isDirectory()
          };
        } catch (error) {
          // 如果无法获取状态，假设是普通文件
          return {
            path: file,
            isDirectory: false
          };
        }
      }
      return file;
    });
    
    return await getFileIcons(validatedFiles.filter(f => f.path && isAllowedPath(f.path)));
  } catch (error) {
    console.error('批量获取图标失败:', error);
    return {};
  }
});

// 清除图标缓存
ipcMain.handle('clear-icon-cache', async () => {
  try {
    const { clearIconCache } = require('./desktop-api');
    clearIconCache();
    return true;
  } catch (error) {
    console.error('清除图标缓存失败:', error);
    return false;
  }
});

// 主题功能的IPC处理
const SUPPORTED_THEMES = new Set([
  'dark', 'light', 'system', 'topo', 'ocean', 'forest', 'cream', 'sakura', 'mist', 'cyber', 'terminal', 'sunset',
  'clay', 'night-clay', 'glass-light', 'glass-dark', 'obsidian'
]);

ipcMain.handle('set-theme', async (event, theme) => {
  try {
    if (!SUPPORTED_THEMES.has(theme)) return false;
    store.set('theme', theme);
    return true;
  } catch (error) {
    console.error('Error setting theme:', error);
    return false;
  }
});

ipcMain.handle('get-theme', async () => {
  return store.get('theme', 'dark');
});

// 透明度功能的IPC处理
ipcMain.handle('set-opacity', async (event, opacity) => {
  try {
    const value = Number.isFinite(opacity) ? Math.max(50, Math.min(100, Math.round(opacity))) : 92;
    store.set('opacity', value);
    return true;
  } catch (error) {
    console.error('Error setting opacity:', error);
    return false;
  }
});

ipcMain.handle('get-opacity', async () => {
  return store.get('opacity', 92);
});

// 图标大小功能的IPC处理
ipcMain.handle('set-icon-size', async (event, size) => {
  try {
    const value = Number.isFinite(size) ? Math.max(24, Math.min(96, Math.round(size))) : 40;
    store.set('iconSize', value);
    return true;
  } catch (error) {
    console.error('Error setting icon size:', error);
    return false;
  }
});

ipcMain.handle('get-icon-size', async () => {
  return store.get('iconSize', 40);
});

// 自动隐藏功能的IPC处理
ipcMain.handle('set-auto-hide', async (event, enabled) => {
  if (!mainWindow) return false;
  const result = setAutoHideEnabled(mainWindow, enabled, store);
  if (result && tray) {
    updateTrayMenu(mainWindow, store);
  }
  return result;
});

ipcMain.handle('get-auto-hide-status', async () => {
  if (!mainWindow) return { enabled: false, edge: EDGE_TYPES.NONE, isHidden: false };
  return getAutoHideStatus(mainWindow);
});

ipcMain.handle('set-auto-hide-edge', async (event, edge) => {
  if (!mainWindow) return false;
  
  try {
    store.set('autoHideEdge', edge);
    mainWindow.autoHideState.currentEdge = edge;
    mainWindow.webContents.send('edge-changed', { edge });
    return true;
  } catch (error) {
    console.error('Error setting auto-hide edge:', error);
    return false;
  }
});

ipcMain.handle('set-sort-by', async (event, sortBy) => {
  try {
    store.set('sortBy', sortBy);
    return true;
  } catch (error) {
    console.error('Error setting sort by:', error);
    return false;
  }
});

ipcMain.handle('set-manual-order', async (event, order) => {
  try {
    if (!Array.isArray(order)) return false;
    store.set('manualOrder', order);
    return true;
  } catch (error) {
    console.error('Error setting manual order:', error);
    return false;
  }
});

ipcMain.handle('set-groups', async (event, groups) => {
  try {
    if (!Array.isArray(groups)) return false;
    // 简单校验每个分组的结构
    const sanitized = groups.map(g => ({
      id: String(g.id || ''),
      name: String(g.name || '未命名'),
      paths: Array.isArray(g.paths) ? g.paths.filter(p => typeof p === 'string') : []
    })).filter(g => g.id);
    store.set('groups', sanitized);
    return true;
  } catch (error) {
    console.error('Error setting groups:', error);
    return false;
  }
});

ipcMain.handle('get-auto-launch', async () => {
  try {
    return await autoLauncher.isEnabled();
  } catch (error) {
    console.error('Error getting auto launch status:', error);
    return false;
  }
});

ipcMain.handle('set-auto-launch', async (event, enabled) => {
  const previousState = store.get('autoLaunch', false);
  try {
    if (enabled) {
      await autoLauncher.enable();
    } else {
      await autoLauncher.disable();
    }
    store.set('autoLaunch', enabled);
    if (tray) {
      updateTrayMenu(mainWindow, store);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-launch-changed', { enabled });
    }
    return true;
  } catch (error) {
    console.error('Error setting auto launch:', error);
    store.set('autoLaunch', previousState);
    if (tray) {
      updateTrayMenu(mainWindow, store);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-launch-changed', { enabled: previousState });
    }
    return false;
  }
});

// 右键菜单活动状态：仅当菜单确实显示过时才执行 cancel，避免每次右键多启动一个进程
let contextMenuActive = false;

ipcMain.handle('show-desktop-context-menu', async (event, x, y) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
    
    if (contextMenuActive) {
      await cancelDesktopContextMenu();
    }
    contextMenuActive = true;
    
    const result = await showDesktopContextMenu(Math.round(x), Math.round(y));
    contextMenuActive = false;
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    return result;
  } catch (error) {
    contextMenuActive = false;
    console.error('显示桌面右键菜单失败:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    return false;
  }
});

ipcMain.handle('cancel-desktop-context-menu', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'floating');
    try {
      await cancelDesktopContextMenu();
    } catch (e) { /* 忽略错误 */ }
  }
  contextMenuActive = false;
  return true;
});

ipcMain.handle('show-file-context-menu', async (event, filePath, x, y) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
    
    if (contextMenuActive) {
      await cancelDesktopContextMenu();
    }
    contextMenuActive = true;
    
    const result = await showFileContextMenu(filePath, Math.round(x), Math.round(y));
    contextMenuActive = false;
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    return result;
  } catch (error) {
    contextMenuActive = false;
    console.error('显示文件右键菜单失败:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    }
    return false;
  }
});

// 修复透明窗口的 GPU 进程错误（必须在 app.whenReady 之前调用）
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');

app.whenReady().then(async () => {
  // 开机延迟启动：延迟初始化窗口，避免开机时抢占焦点
  const startupDelay = store.get('startupDelay', 0);
  
  const initApp = async () => {
    try {
      await initializeDesktopAPI(app.getPath('userData'));
    } catch (e) {
      console.error('初始化桌面API失败:', e.message);
    }
    
    // 预编译右键菜单可执行文件，避免首次右键时的编译延迟
    try {
      compileExe();
    } catch (e) {
      console.warn('右键菜单组件预编译失败:', e.message);
    }
    
    // 同步实际的开机启动状态
    try {
      const actualEnabled = await autoLauncher.isEnabled();
      const storedEnabled = store.get('autoLaunch', false);
      if (actualEnabled !== storedEnabled) {
        store.set('autoLaunch', actualEnabled);
      }
    } catch (e) {
      console.warn('同步开机启动状态失败:', e.message);
    }
    
    // 先隐藏桌面图标，再创建窗口
    hideDesktopIcons();
    
    createWindow();
    tray = createTray(mainWindow, store);
    
    // 监听桌面文件变化，自动刷新
    startDesktopWatchers();
    
    // 注册全局快捷键
    registerGlobalShortcuts();
    
    // 监听系统主题变化
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-theme-changed', {
          shouldUseDarkColors: nativeTheme.shouldUseDarkColors
        });
      }
    });
  };
  
  if (startupDelay > 0) {
    console.log(`开机延迟启动：${startupDelay} 秒后初始化`);
    setTimeout(initApp, startupDelay * 1000);
  } else {
    await initApp();
  }
}).catch((error) => {
  console.error('App 启动失败:', error);
});

app.on('window-all-closed', () => {
  // 不要在所有窗口关闭时退出应用，因为有系统托盘
});

app.on('before-quit', () => {
  // 无论是否正常退出，都应该显示桌面图标
  try {
    showDesktopIcons();
  } catch (error) {
    console.error('退出时显示桌面图标失败:', error);
  }

  // 停止文件监听
  stopDesktopWatchers();

  // 销毁托盘图标
  destroyTray();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 退出时注销所有全局快捷键
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ============ 全局快捷键 ============
const DEFAULT_SHORTCUTS = {
  TOGGLE_WINDOW: 'CommandOrControl+Alt+D',
  REFRESH: 'CommandOrControl+Alt+R'
};

// 显示/隐藏窗口
function handleGlobalToggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// 刷新文件列表
function handleGlobalRefresh() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('refresh-files');
  }
}

function registerGlobalShortcuts() {
  const shortcuts = store.get('shortcuts', {});
  const toggleKey = shortcuts.toggleWindow || DEFAULT_SHORTCUTS.TOGGLE_WINDOW;
  const refreshKey = shortcuts.refresh || DEFAULT_SHORTCUTS.REFRESH;

  // 自定义快捷键：显示/隐藏窗口
  const reg1 = globalShortcut.register(toggleKey, handleGlobalToggleWindow);
  if (!reg1) {
    console.warn('全局快捷键注册失败:', toggleKey);
  }

  // 自定义快捷键：刷新文件列表
  const reg2 = globalShortcut.register(refreshKey, handleGlobalRefresh);
  if (!reg2) {
    console.warn('全局快捷键注册失败:', refreshKey);
  }
}
