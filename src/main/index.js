const { app, BrowserWindow, ipcMain, shell, nativeTheme, globalShortcut, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const Store = require('electron-store');
const { getFileIcon, getFileIcons, initializeDesktopAPI, getSystemIconEmoji, cleanupIconCache, flushIconCache } = require('./desktop-api');
const { showDesktopContextMenu, showFileContextMenu, cancelDesktopContextMenu, compileExe } = require('./shell-context-menu');
const { 
  createMainWindow, 
  getExpandedHeight,
  setAutoHideEnabled, 
  getAutoHideStatus,
  isFullscreenAppForeground,
  cancelAnimation,
  EDGE_TYPES 
} = require('./window-manager');
const { createTray, updateTrayMenu, destroyTray, autoLauncher } = require('./tray');
const { startSampler, stopSampler, getSystemStats } = require('./hardware-monitor');
const { AgentMonitor, createOpencodeAdapter, createOpencodeServerStatusProvider, createDshAdapter, createZcodeAdapter, createAntigravityAdapter, createCodexAdapter, createClaudeAdapter, detectOpencodeRunning, detectDshRunning, isValidSessionId } = require('./agent-monitor');

const store = new Store({
  name: 'desktop-icon-hider',
  defaults: {
    windowBounds: null,
    // 展开状态是否记住手动调整的窗口高度（false = 始终占满工作区高度，原设计行为）
    rememberWindowHeight: false,
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
    gpuAcceleration: true,
    folderPreviewEnabled: true,
    mouseEffects: {
      enabled: false,
      type: 'stars', // 特效类型: ripple(水波) | stars(星星) | trail(彩虹拖尾) | aura(极光流体)
      customCursor: 'none' // 自定义光标: none | dot | arrow | star
    },
    liquidGlass: {
      light: 70,
      lightAngle: 135,
      refraction: 35,
      depth: 45,
      dispersion: 50,
      frost: 18,
      spread: 55,
      chromaticMetal: 75
    },
    borderBeam: {
      enabled: false,
      windowBeam: true,
      agentBeam: true,
      dropBeam: true,
      searchBeam: true,
      colorMode: 'theme',
      speed: 4
    },
    everythingEnabled: false,
    backgroundImage: {
      enabled: false,
      path: null,
      blur: 24,
      dim: 45,
      mode: 'cover', // 显示模式: cover | contain | fill | custom
      scale: 100, // 自定义缩放 %（custom 模式）
      offsetX: 0, // 自定义横向偏移 %（custom 模式）
      offsetY: 0, // 自定义纵向偏移 %（custom 模式）
      brightness: 100, // 背景亮度 %
      saturation: 100, // 背景饱和度 %
      contrast: 100, // 背景对比度 %
      vignetteEnabled: false, // 是否启用四角暗角
      vignette: 25 // 暗角强度 %
    },
    userProfile: {
      name: '',
      path: null,
      cropPath: null,
      shape: 'circle', // 头像形状: circle | rounded
      scale: 1,
      offsetX: 0,
      offsetY: 0
    },
    textTone: 0, // 文字明暗饱和度: -50 ~ +50，0=主题默认
    textToneColor: '', // 文字色调（'r,g,b'），空=跟随主题默认
    iconTextEffect: 'windows', // 图标文字效果: windows | auto | soft | strong | none
    fontFamily: '', // 用户字体（空=跟随主题默认）
    widgets: [],
    showWidgets: true,
    widgetsAvoidIcons: false,
    // 组件透明度倍率：type → 30..100（100 = 完全保持主题默认透明度）。
    // 乘在主题自带透明度之上（effective = theme_base × multiplier）
    widgetOpacity: {},
    weatherFxEnabled: true,
    weatherCity: null, // { name, lat, lon }
    agentReadSessions: [], // agent 组件已读（已查看并跳转）的会话 id
    agentActiveThreshold: 120, // agent 会话活跃判定窗口（秒）
    agentDoneRetentionDays: 7, // 已完成会话保留天数（0 = 不限制）
    agentCollapsedHarnesses: [], // agent 组件已折叠（收起通知列表）的 harness 名
    // agent 组件各 harness 的配置（嵌套结构，未来多 agent 各占一组）：
    // { opencode: { port: 0, password: '' }, codex: { ... } }
    // port 0 = 默认 4096（自跑 serve 自定义端口时手动指定）；password 空 = 无认证
    agentConfigs: {},
    shortcuts: {
      toggleWindow: 'CommandOrControl+Alt+D',
      refresh: 'CommandOrControl+Alt+R',
      toggleWidgets: 'CommandOrControl+Alt+W'
    }
  }
});
let mainWindow = null;
let tray = null;
let fsWatchers = [];
let agentMonitor = null;
let agentStatusProvider = null; // agent 组件 server 状态提供器（退出时释放 SSE 连接）
let agentRuntimeTimer = null; // agent 运行状态检测定时器

// 获取桌面路径
function getDesktopPath() {
  return path.join(process.env.USERPROFILE || '', 'Desktop');
}

// 校验路径是否属于本应用的桌面管辖范围（用户桌面/公共桌面/系统虚拟文件夹），
// 防止渲染进程通过 IPC 操作任意文件
const SYSTEM_CLSID_PATH_RE = /^::\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

function isAllowedPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  // 系统虚拟文件夹（此电脑、回收站等）：仅允许纯 CLSID 形式，
  // 从根上排除引号/&/空格等 cmd 元字符（open-file 会拼进 start 命令行）
  if (filePath.startsWith('::')) {
    return SYSTEM_CLSID_PATH_RE.test(filePath);
  }
  // 拒绝含 `..` 段的路径：未规范化时可通过前缀校验穿越到桌面管辖范围之外
  if (filePath.split(/[\\/]+/).includes('..')) return false;
  // 先规范化再前缀比较，防止 `Desktop\..\Windows` 之类的穿越写法
  const normalized = path.resolve(filePath).toLowerCase();
  const userDesktop = path.resolve(getDesktopPath()).toLowerCase();
  if (userDesktop.endsWith('desktop') && normalized.startsWith(userDesktop + '\\')) return true;
  const publicDesktop = path.resolve(getPublicDesktopPath()).toLowerCase();
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

// ============ 异步 PowerShell 执行 ============
// spawn 版，不阻塞主进程。execSync 会卡住整个应用：悬停预览系统文件夹（此电脑等）
// 或刷新系统图标时，主进程可能被阻塞数秒，期间所有 IPC（点击、刷新、图标加载）全部排队。
function execPowerShellAsync(psScript, extraEnv = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const tempFile = path.join(os.tmpdir(), `temp-ps-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
    try {
      fs.writeFileSync(tempFile, psScript, 'utf8');
    } catch (e) {
      resolve(null);
      return;
    }
    let output = '';
    let settled = false;
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempFile], {
        windowsHide: true,
        env: { ...process.env, ...extraEnv }
      });
    } catch (e) {
      // spawn 同步抛错（罕见）：与"优雅降级"约定一致 resolve(null)，并清理临时文件
      try { fs.unlinkSync(tempFile); } catch (e2) { /* 忽略 */ }
      resolve(null);
      return;
    }
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { fs.unlinkSync(tempFile); } catch (e) { /* 忽略 */ }
      resolve(result);
    };
    const timeout = setTimeout(() => {
      // 杀进程树：PS 脚本派生的孙进程不随 powershell 退出而结束
      try { child.kill(); } catch (e) { /* 忽略 */ }
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch (e) { /* 忽略 */ }
      finish(null);
    }, timeoutMs);
    if (child.stdout) child.stdout.on('data', (d) => { output += d.toString('utf8'); });
    if (child.stderr) child.stderr.on('data', () => { /* 忽略 */ });
    child.on('error', () => finish(null));
    child.on('close', () => finish(output));
  });
}

// 预览枚举/解码缓存：悬停同一目标时避免重复枚举目录、重复启动进程（系统文件夹枚举开销大）
let previewCacheMap = new Map();
const PREVIEW_CACHE_TTL = 60 * 1000;

function getPreviewCache(key) {
  const hit = previewCacheMap.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time >= PREVIEW_CACHE_TTL) {
    previewCacheMap.delete(key);
    return null;
  }
  return hit.data;
}

function setPreviewCache(key, data) {
  previewCacheMap.set(key, { time: Date.now(), data });
  if (previewCacheMap.size > 300) {
    const now = Date.now();
    // 先删过期项；若仍超限（短时间内全部新鲜），按最旧优先淘汰到阈值，
    // 防止 60s TTL 内 Map 无限增长
    for (const [k, v] of previewCacheMap) {
      if (now - v.time >= PREVIEW_CACHE_TTL) previewCacheMap.delete(k);
    }
    while (previewCacheMap.size > 300) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of previewCacheMap) {
        if (v.time < oldestTime) { oldestTime = v.time; oldestKey = k; }
      }
      if (oldestKey === null) break;
      previewCacheMap.delete(oldestKey);
    }
  }
}

// ============ 文件夹预览 ============
async function listDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return [];
  const cacheKey = 'dir:' + dirPath;
  const cached = getPreviewCache(cacheKey);
  if (cached) return cached;
  let result;
  // 系统虚拟文件夹（此电脑、回收站等 `::` 路径）用 Shell COM 枚举
  if (dirPath.startsWith('::')) {
    result = await listSystemFolder(dirPath);
  } else {
    try {
      const stats = await fs.promises.stat(dirPath);
      if (!stats.isDirectory()) return [];
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      result = entries
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
  if (result) setPreviewCache(cacheKey, result);
  return result;
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
    const result = await execPowerShellAsync(psScript, { DIH_SYS_PATH: displayPath }, 8000);
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
  const cacheKey = 'img:' + filePath;
  const cached = getPreviewCache(cacheKey);
  if (cached) return cached;
  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return null;
    if (stats.size > IMAGE_PREVIEW_MAX_SIZE) return null;
    const ext = path.extname(filePath).toLowerCase();
    // SVG：nativeImage 不支持，读文本转 data URL
    if (ext === '.svg') {
      const text = await fs.promises.readFile(filePath, 'utf8');
      const base64 = Buffer.from(text, 'utf8').toString('base64');
      const dataUrl = `data:image/svg+xml;base64,${base64}`;
      setPreviewCache(cacheKey, dataUrl);
      return dataUrl;
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
    const dataUrl = finalImg.toDataURL();
    setPreviewCache(cacheKey, dataUrl);
    return dataUrl;
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
    if (typeof src !== 'string') {
      // 非字符串条目逐项降级为失败，而不是在 try 外抛错使整个批次 reject
      results.push({ name: '', ok: false, error: '无效路径' });
      continue;
    }
    const name = path.basename(src);
    let dest = path.join(targetDir, name);
    // Windows 大小写不敏感：目标与源为同一文件（targetDir 与源目录大小写可能不同）时视为原地粘贴
    const isSamePath = src.toLowerCase() === dest.toLowerCase();
    if (isSamePath) {
      dest = src;
    }
    try {
      if (isSamePath) {
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
  // 缓存未命中时先返回空（UI 先行显示），再异步枚举，完成后通过回调刷新缓存。
  // 避免 execSync 同步阻塞主进程（此电脑/回收站等枚举可耗时数秒）
  triggerSystemIconsAsync();
  return [];
}

let systemIconsLoading = false;
let systemIconsPending = null; // 当前枚举的 Promise，供 waitSystemIcons 等待

function triggerSystemIconsAsync() {
  if (systemIconsLoading) return systemIconsPending;
  systemIconsPending = getSystemIconsAsync();
  return systemIconsPending;
}

// 等待系统图标枚举完成（异步，不阻塞主进程）：刷新时保证返回完整数据，
// 避免"系统图标先消失、枚举完成后才补上"的视觉回归
async function waitSystemIcons(timeoutMs = 6000) {
  const now = Date.now();
  if (systemIconsCache && (now - systemIconsCacheTime) < SYSTEM_ICONS_CACHE_TTL) return;
  const pending = triggerSystemIconsAsync();
  if (pending) {
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }
}

async function getSystemIconsAsync() {
  if (systemIconsLoading) return;
  systemIconsLoading = true;
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
    const result = await execPowerShellAsync(psScript, {}, 10000);
    if (!result || result.trim() === 'null') {
      return;
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
    systemIconsCacheTime = Date.now();
    // 通知渲染进程刷新，把异步枚举出的系统图标补进列表
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('desktop-changed');
    }
  } catch (e) {
    console.error('获取系统图标失败:', e.message);
  } finally {
    systemIconsLoading = false;
    systemIconsPending = null;
  }
}

// 获取桌面文件列表
// awaitSystemIcons=true 时（刷新请求）等待系统图标枚举完成，保证返回完整数据；
// 启动场景传 false，窗口快速显示、系统图标由 desktop-changed 异步补齐
async function getDesktopFiles(awaitSystemIcons = false) {
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
    
    // 获取系统图标（此电脑、回收站等）：刷新场景等待枚举完成，避免图标先消失再补
    if (awaitSystemIcons) {
      await waitSystemIcons();
    }
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
// 注意：ps1 以 UTF-8 BOM 写入（Windows PowerShell 5.1 无 BOM 时按系统 ANSI 代码页读取，
// 中文注释会乱码且可能引发 Add-Type 编译异常）；C# 模板全部使用英文注释
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
    // Find SHELLDLL_DefView: usually under Progman; on Win11 / after explorer restart
    // it may hang under WorkerW. Fall back by enumerating. Zero means not found,
    // caller throws so failures are never silent.
    public static IntPtr FindShellView() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) return shellView;
        IntPtr worker = IntPtr.Zero;
        while ((worker = FindWindowEx(IntPtr.Zero, worker, "WorkerW", null)) != IntPtr.Zero) {
            shellView = FindWindowEx(worker, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (shellView != IntPtr.Zero) return shellView;
        }
        return IntPtr.Zero;
    }
    public static void Hide() {
        IntPtr shellView = FindShellView();
        if (shellView == IntPtr.Zero) throw new Exception("SHELLDLL_DefView not found");
        ShowWindow(shellView, 0);
    }
}
"@
[DesktopHelper]::Hide()`;
    
    const tempFile = path.join(os.tmpdir(), `temp-hide-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, '\ufeff' + psScript, 'utf8');
    
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, { 
        timeout: 10000,
        encoding: 'utf8'
      });
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 临时文件可能已被清理，忽略 */ }
    }
    // 隐藏成功才持久化标记：应用崩溃/被强杀后下次启动据此恢复桌面图标
    store.set('desktopIconsHidden', true);
    return true;
  } catch (error) {
    // 生产模式只打印一行摘要：Add-Type 编译错误的完整信息（含 GBK 乱码）对用户无意义且刷屏
    const brief = String((error && error.message) || error).split('\n')[0].slice(0, 200);
    if (process.argv.includes('--dev')) {
      console.error('隐藏桌面图标失败:', error.message);
    } else {
      console.error('隐藏桌面图标失败:', brief);
    }
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
    // Find SHELLDLL_DefView: usually under Progman; on Win11 / after explorer restart
    // it may hang under WorkerW. Fall back by enumerating.
    public static IntPtr FindShellView() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) return shellView;
        IntPtr worker = IntPtr.Zero;
        while ((worker = FindWindowEx(IntPtr.Zero, worker, "WorkerW", null)) != IntPtr.Zero) {
            shellView = FindWindowEx(worker, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (shellView != IntPtr.Zero) return shellView;
        }
        return IntPtr.Zero;
    }
    public static void Show() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindShellView();
        if (shellView == IntPtr.Zero) throw new Exception("SHELLDLL_DefView not found");
        ShowWindow(shellView, 5);
        if (progman != IntPtr.Zero) {
            PostMessage(progman, 0x0111, new IntPtr(0x7402), IntPtr.Zero);
        }
    }
}
"@
[DesktopHelper]::Show()`;
    
    const tempFile = path.join(os.tmpdir(), `temp-show-${process.pid}.ps1`);
    fs.writeFileSync(tempFile, '\ufeff' + psScript, 'utf8');
    
    try {
      execSync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, { 
        timeout: 10000,
        encoding: 'utf8'
      });
    } finally {
      try { fs.unlinkSync(tempFile); } catch (e) { /* 临时文件可能已被清理，忽略 */ }
    }
    store.set('desktopIconsHidden', false);
    return true;
  } catch (error) {
    // 生产模式只打印一行摘要：Add-Type 编译错误的完整信息（含 GBK 乱码）对用户无意义且刷屏
    const brief = String((error && error.message) || error).split('\n')[0].slice(0, 200);
    if (process.argv.includes('--dev')) {
      console.error('显示桌面图标失败:', error.message);
    } else {
      console.error('显示桌面图标失败:', brief);
    }
    return false;
  }
}

// ============ 桌面隐藏自愈（explorer 重建后自动恢复） ============
// 隐藏是对 SHELLDLL_DefView 句柄 ShowWindow(SW_HIDE)，运行时生效、无系统持久状态：
// explorer.exe 重启/崩溃自动重启（或分辨率/DPI/RDP/主题切换等桌面重建事件）后，
// 新桌面视图默认可见（原桌面图标重现）；同时旧任务栏的 ITaskbarList::DeleteTab
// 记录随任务栏重建一起丢失，而 Electron 收到 TaskbarCreated 广播不会补发——
// skipTaskbar:true 的窗口会重新出现在任务栏（electron/electron#29526，未修复）。
// 此处以 3s 低频轮询原生检测（FindWindow + IsWindowVisible，微秒级，开销远低于
// 自动隐藏已常驻的 50ms 全屏检测）：比对桌面视图句柄判断"桌面是否被重建"，
// 必要时重新隐藏图标并补发 setSkipTaskbar(true)，两个症状一并自愈。
let desktopHealNative = null;
try {
  desktopHealNative = require('../../build/Release/icon_extractor.node');
} catch (e) {
  try {
    desktopHealNative = require(path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'icon_extractor.node'));
  } catch (e2) {
    desktopHealNative = null;
  }
}

const DESKTOP_HEAL_INTERVAL = 3000;
let desktopHealTimer = null;
let desktopHealLastHwnd = null;
let desktopHealFailLogged = false;

// 补发 skipTaskbar（Electron 内部重走 ITaskbarList::DeleteTab）：仅在检测到
// 桌面重建/重新隐藏后调用，DeleteTab 对已删除的 tab 是无害幂等操作
function reapplySkipTaskbar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setSkipTaskbar(true);
  } catch (e) { /* 忽略 */ }
}

function desktopSelfHealCheck() {
  // 用户当前选择"显示桌面图标"：无自愈对象，句柄缓存一并清空
  // （避免之后手动隐藏时把 explorer 重建前的旧句柄误判为变化）
  if (!store.get('desktopIconsHidden', false)) {
    desktopHealLastHwnd = null;
    return;
  }
  if (!desktopHealNative || typeof desktopHealNative.desktopViewInfo !== 'function') return;

  let info = null;
  try {
    info = desktopHealNative.desktopViewInfo();
  } catch (e) {
    return;
  }
  // 桌面视图尚不存在（explorer 正在重启/尚未完成）：等待下一轮
  if (!info || !info.hwnd) return;

  const hwndChanged = desktopHealLastHwnd !== null && info.hwnd !== desktopHealLastHwnd;
  desktopHealLastHwnd = info.hwnd;

  if (!info.visible && !hwndChanged) return;

  let hidIcons = false;
  if (info.visible) {
    try {
      hidIcons = desktopHealNative.hideDesktopView() === true;
    } catch (e) { /* 下一轮重试 */ }
    if (hidIcons) {
      desktopHealFailLogged = false;
    } else if (!desktopHealFailLogged) {
      desktopHealFailLogged = true;
      console.error('桌面自愈：重新隐藏桌面图标失败，将在下一轮重试');
    }
  }
  if (hidIcons || hwndChanged) {
    reapplySkipTaskbar();
    const why = hwndChanged ? '桌面已重建' : '桌面图标被外部重新显示';
    console.log(`桌面自愈：${why}${hidIcons ? '，已重新隐藏桌面图标' : ''}，已补发 skipTaskbar`);
  }
}

function startDesktopSelfHeal() {
  if (desktopHealTimer) return;
  if (!desktopHealNative || typeof desktopHealNative.desktopViewInfo !== 'function') {
    console.warn('原生模块不可用，桌面隐藏自愈未启用（explorer 重启后需重新启动本程序恢复隐藏）');
    return;
  }
  desktopHealTimer = setInterval(desktopSelfHealCheck, DESKTOP_HEAL_INTERVAL);
}

function stopDesktopSelfHeal() {
  if (desktopHealTimer) {
    clearInterval(desktopHealTimer);
    desktopHealTimer = null;
  }
}

// 创建主窗口
function createWindow() {
  // 开机自启（--hidden）：窗口可见但不抢占焦点（showInactive）
  mainWindow = createMainWindow(store, process.argv.includes('--hidden'));
  
  if (mainWindow) {
    // 只允许本地页面：拦截任何导航与弹窗（无远程内容，防渲染端被注入后跳转/开窗）
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    mainWindow.once('ready-to-show', async () => {
      try {
        const files = await getDesktopFiles();
        // Everything 路径只探测一次（reg query + 全盘符扫描 + 可能一次 PowerShell），
        // 此前一行内重复调用 3 次阻塞初始化数秒
        const everythingPath = findEverythingPath();
        mainWindow.webContents.send('init-data', {
          files,
          isCollapsed: store.get('isCollapsed', false),
          autoHideEnabled: store.get('autoHideEnabled', false),
          autoHideEdge: store.get('autoHideEdge', EDGE_TYPES.NONE),
          rememberWindowHeight: store.get('rememberWindowHeight', false),
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
          gpuAcceleration: store.get('gpuAcceleration', true),
          language: store.get('language', 'zh-CN'),
          everythingEnabled: store.get('everythingEnabled', false),
          everythingInstalled: !!everythingPath,
          everythingRunAsAdmin: !!everythingPath && isEverythingRunAsAdmin(everythingPath),
          folderPreviewEnabled: store.get('folderPreviewEnabled', true),
          backgroundImage: store.get('backgroundImage', {}),
          backgroundData: await getBackgroundData(),
          userProfile: store.get('userProfile', {}),
          avatarData: await getAvatarData(),
          avatarSourceData: await getAvatarSourceData(),
          textTone: store.get('textTone', 0),
          textToneColor: store.get('textToneColor', ''),
          iconTextEffect: store.get('iconTextEffect', 'windows'),
          fontFamily: store.get('fontFamily', ''),
          widgets: store.get('widgets', []),
          showWidgets: store.get('showWidgets', true),
          widgetsAvoidIcons: store.get('widgetsAvoidIcons', false),
          widgetOpacity: store.get('widgetOpacity', {}),
          weatherCity: store.get('weatherCity', null),
          weatherFxEnabled: store.get('weatherFxEnabled', true),
          agentReadSessions: store.get('agentReadSessions', []),
          agentDoneRetentionDays: store.get('agentDoneRetentionDays', 7),
          agentCollapsedHarnesses: store.get('agentCollapsedHarnesses', []),
          agentConfigs: store.get('agentConfigs', {}),
          mouseEffects: store.get('mouseEffects', {}),
          liquidGlass: store.get('liquidGlass', {}),
          borderBeam: store.get('borderBeam', {
            enabled: false,
            windowBeam: true,
            agentBeam: true,
            dropBeam: true,
            searchBeam: true,
            colorMode: 'theme',
            speed: 4
          })
        });
      } catch (error) {
        console.error('发送初始化数据失败:', error);
        mainWindow.webContents.send('init-data', {
          files: [],
          isCollapsed: store.get('isCollapsed', false),
          autoHideEnabled: store.get('autoHideEnabled', false),
          autoHideEdge: store.get('autoHideEdge', EDGE_TYPES.NONE),
          rememberWindowHeight: store.get('rememberWindowHeight', false),
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
          gpuAcceleration: store.get('gpuAcceleration', true),
          language: store.get('language', 'zh-CN'),
          everythingEnabled: store.get('everythingEnabled', false),
          everythingInstalled: false,
          everythingRunAsAdmin: false,
          folderPreviewEnabled: store.get('folderPreviewEnabled', true),
          backgroundImage: store.get('backgroundImage', {}),
          backgroundData: null,
          userProfile: store.get('userProfile', {}),
          avatarData: null,
          avatarSourceData: null,
          textTone: store.get('textTone', 0),
          textToneColor: store.get('textToneColor', ''),
          iconTextEffect: store.get('iconTextEffect', 'windows'),
          fontFamily: store.get('fontFamily', ''),
          widgets: store.get('widgets', []),
          showWidgets: store.get('showWidgets', true),
          widgetsAvoidIcons: store.get('widgetsAvoidIcons', false),
          widgetOpacity: store.get('widgetOpacity', {}),
          weatherCity: store.get('weatherCity', null),
          weatherFxEnabled: store.get('weatherFxEnabled', true),
          agentReadSessions: store.get('agentReadSessions', []),
          agentDoneRetentionDays: store.get('agentDoneRetentionDays', 7),
          agentCollapsedHarnesses: store.get('agentCollapsedHarnesses', []),
          agentConfigs: store.get('agentConfigs', {}),
          mouseEffects: store.get('mouseEffects', {}),
          liquidGlass: store.get('liquidGlass', {}),
          borderBeam: store.get('borderBeam', {
            enabled: false,
            windowBeam: true,
            agentBeam: true,
            dropBeam: true,
            searchBeam: true,
            colorMode: 'theme',
            speed: 4
          })
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
      restoreTopmost();
      if (tray) {
        updateTrayMenu(mainWindow, store);
      }
    });
    
    // 回到应用（获得焦点）时恢复置顶
    mainWindow.on('focus', () => {
      restoreTopmost();
    });
    
    mainWindow.on('hide', () => {
      if (tray) {
        updateTrayMenu(mainWindow, store);
      }
    });
    
    mainWindow.on('moved', () => {
      // 自动隐藏动画/隐藏态期间的瞬态坐标（含屏幕外最后一帧）不得持久化，
      // 否则重启后窗口按屏幕外坐标恢复、用户找不到窗口
      const st = mainWindow && mainWindow.autoHideState;
      if (st && (st.isHidden || st.isAnimating)) return;
      if (mainWindow && !mainWindow.isCollapsed) {
        store.set('windowBounds', mainWindow.getBounds());
      }
    });
    
    mainWindow.on('resized', () => {
      const st = mainWindow && mainWindow.autoHideState;
      if (st && (st.isHidden || st.isAnimating)) return;
      if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isCollapsed) {
        const bounds = mainWindow.getBounds();
        if (bounds.height > 50) {
          store.set('windowBounds', bounds);
        }
      }
    });
    
    // F12 / Ctrl+Shift+I 打开开发者工具（仅开发模式，打包版不开放调试后门）
    if (!app.isPackaged) {
      mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
          mainWindow.webContents.toggleDevTools();
          event.preventDefault();
        }
      });
    }
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

// 展开状态是否记住手动调整的窗口高度（false = 始终占满工作区高度，原设计行为）
ipcMain.handle('set-remember-window-height', async (event, enabled) => {
  store.set('rememberWindowHeight', !!enabled);
  return true;
});

ipcMain.handle('toggle-collapse', async (event, collapse) => {  if (!mainWindow) return false;
  
  const bounds = mainWindow.getBounds();
  mainWindow.isCollapsed = !!collapse;
  store.set('isCollapsed', !!collapse);
  
  // 取消所有自动隐藏定时器与进行中的隐藏/唤出动画（折叠/展开期间不让动画帧继续移动窗口）
  if (mainWindow.autoHideState) {
    if (mainWindow.autoHideState.hideTimer) {
      clearTimeout(mainWindow.autoHideState.hideTimer);
      mainWindow.autoHideState.hideTimer = null;
    }
    if (mainWindow.autoHideState.showTimer) {
      clearTimeout(mainWindow.autoHideState.showTimer);
      mainWindow.autoHideState.showTimer = null;
    }
    cancelAnimation(mainWindow);
  }
  
  if (collapse) {
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: 40
    }, true);
  } else {
    // 展开高度：与启动恢复共用 getExpandedHeight（记住高度时用保存值，否则满工作区高）
    const workAreaHeight = screen.getDisplayMatching(bounds).workArea.height;
    const targetHeight = getExpandedHeight(store, workAreaHeight);
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: targetHeight
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
    // 刷新请求等待系统图标枚举完成，保证一次返回完整数据（含系统图标）
    const files = await getDesktopFiles(true);
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
    // shell.openPath 在部分 Windows 环境会永久挂起（ShellExecuteEx 同步等待，
    // 文件打不开、Promise 永不 resolve，导致让位不执行、窗口盖住新打开的应用）。
    if (filePath.startsWith('::')) {
      // 系统虚拟文件夹（此电脑/回收站/网络等）：必须用显式空标题的 start。
      // 无 shell 写法会把 `::{CLSID}` 当作窗口标题而静默失败；
      // explorer.exe 直开实测 exit 1 失败。isAllowedPath 已保证路径为纯 CLSID
      // 形式（无引号/&/% 等），与普通路径一致走参数数组，不再 shell:true 拼接。
      const child = spawn('cmd.exe', ['/c', 'start', '', String(filePath)], {
        windowsHide: true
      });
      child.unref();
    } else {
      // 普通路径：改用 cmd start 异步打开：立即返回，由系统关联程序正常打开文件。
      // 注意：不能带 shell:true——手动拼接的命令行会被 cmd 二次解析，
      // 路径中的 %VAR%（如 %TEMP%）会被环境变量展开污染、& 等字符有注入风险
      // （实测含 %TEMP% 的文件夹打不开）。参数数组交给 libuv 转义后，
      // 空格/中文/括号/&/% 均安全（支持 `start "" "path"` 的等价语义）。
      const child = spawn('cmd.exe', ['/c', 'start', '', String(filePath)], {
        windowsHide: true
      });
      child.unref();
    }
    yieldTopmost();
    return { success: true };
  } catch (e) {
    yieldTopmost();
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-in-explorer', (event, filePath) => {
  if (!isAllowedPath(filePath)) return false;
  try {
    shell.showItemInFolder(filePath);
    yieldTopmost();
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
      type: ['clock', 'calendar', 'weather', 'monitor', 'agent', 'everything'].includes(w.type) ? w.type : 'clock',
      x: Number.isFinite(w.x) ? Math.max(0, Math.min(95, w.x)) : 2,
      y: Number.isFinite(w.y) ? Math.max(0, Math.min(90, w.y)) : 2,
      w: Number.isFinite(w.w) ? Math.max(120, Math.min(1200, Math.round(w.w))) : undefined,
      h: Number.isFinite(w.h) ? Math.max(120, Math.min(1200, Math.round(w.h))) : undefined,
      style: ['gauge', 'chart', 'bar'].includes(w.style) ? w.style : 'gauge'
    })).filter(w => w.id);
    store.set('widgets', sanitized);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle('get-system-stats', async () => {
  return getSystemStats();
});

ipcMain.handle('set-show-widgets', async (event, enabled) => {
  store.set('showWidgets', !!enabled);
  return true;
});

ipcMain.handle('set-widgets-avoid', async (event, enabled) => {
  store.set('widgetsAvoidIcons', !!enabled);
  return true;
});

// 组件透明度倍率：type → 30..100（100 = 主题默认）。白名单外类型丢弃
ipcMain.handle('set-widget-opacity', async (event, map) => {
  const valid = {};
  if (map && typeof map === 'object') {
    for (const [type, v] of Object.entries(map)) {
      if (typeof type === 'string' && type.length > 0 && type.length <= 32 && Number.isFinite(v)) {
        valid[type] = Math.max(30, Math.min(100, Math.round(v)));
      }
    }
  }
  store.set('widgetOpacity', valid);
  return true;
});

// ============ agent 会话监控组件 ============
// 返回全部快照 + 已读标记，由渲染端按"活跃 || 未读"规则过滤显示
ipcMain.handle('get-agent-sessions', async () => {
  const sessions = agentMonitor ? agentMonitor.getSnapshot() : [];
  return {
    sessions,
    readSessions: store.get('agentReadSessions', [])
  };
});

// 标记会话已读（点击完成/中断条目后调用；重新活跃的会话不受影响）
ipcMain.handle('mark-agent-read', async (event, sessionIds) => {
  try {
    if (!Array.isArray(sessionIds)) return false;
    const current = new Set(store.get('agentReadSessions', []));
    for (const id of sessionIds) {
      if (isValidSessionId(id)) current.add(id);
    }
    // 上限 500 条，超出丢弃最旧记录
    if (current.size > 500) {
      const arr = [...current];
      store.set('agentReadSessions', arr.slice(arr.length - 500));
    } else {
      store.set('agentReadSessions', [...current]);
    }
    return true;
  } catch (e) {
    return false;
  }
});

// 清除已读标记：会话从运行中转为完成时由渲染端调用，
// 让"运行中点过（已读）"的会话跑完后重新显示对勾，而不是直接消失
ipcMain.handle('unmark-agent-read', async (event, sessionIds) => {
  try {
    if (!Array.isArray(sessionIds)) return false;
    const current = new Set(store.get('agentReadSessions', []));
    for (const id of sessionIds) {
      if (isValidSessionId(id)) current.delete(id);
    }
    store.set('agentReadSessions', [...current]);
    return true;
  } catch (e) {
    return false;
  }
});

// 已完成会话保留天数（0 = 不限制，超期隐藏）
ipcMain.handle('set-agent-retention-days', async (event, days) => {
  const value = Number.isFinite(days) ? Math.max(0, Math.min(365, Math.round(days))) : 7;
  store.set('agentDoneRetentionDays', value);
  return true;
});

// harness 分组折叠状态（点击分组头三角收起/展开通知列表，持久化）
ipcMain.handle('set-agent-collapsed', async (event, payload) => {
  const { harness, collapsed } = payload || {};
  const h = typeof harness === 'string' && harness ? harness.slice(0, 64) : '';
  if (!h) return false;
  const current = new Set(store.get('agentCollapsedHarnesses', []));
  if (collapsed) {
    current.add(h);
  } else {
    current.delete(h);
  }
  // 上限 50 个分组名，超出丢弃最早记录
  const arr = [...current];
  store.set('agentCollapsedHarnesses', arr.length > 50 ? arr.slice(arr.length - 50) : arr);
  return true;
});

// 设置指定 harness 的 agent 配置（嵌套存储 agentConfigs[harness]）。
// opencode 当前支持 port/password（自跑 serve 的校准通道；端口 0/密码空 = 默认无认证）；
// 未来其他 harness 可扩展各自配置项。opencode 配置变更时重建 server 状态提供器即时生效
ipcMain.handle('set-agent-config', async (event, payload) => {
  const { harness, config } = payload || {};
  const h = typeof harness === 'string' && harness ? harness : 'opencode';
  const cfg = (config && typeof config === 'object') ? config : {};
  const current = store.get('agentConfigs', {}) || {};
  const merged = { ...(current[h] || {}) };
  // 通用校验：port 0-65535 整数；password 字符串限长；home 路径字符串限长
  if ('port' in cfg) {
    merged.port = Number.isFinite(cfg.port) ? Math.max(0, Math.min(65535, Math.round(cfg.port))) : 0;
  }
  if ('password' in cfg) {
    merged.password = typeof cfg.password === 'string' ? cfg.password.slice(0, 200) : '';
  }
  if ('home' in cfg) {
    merged.home = typeof cfg.home === 'string' ? cfg.home.slice(0, 500) : '';
  }
  store.set('agentConfigs', { ...current, [h]: merged });
  // dsh 的校准通道不需要；数据目录变更时即时更新适配器（下次轮询生效）
  if (h === 'dsh' && agentMonitor) {
    for (const adapter of agentMonitor.adapters) {
      if (adapter && adapter.id === 'dsh' && typeof adapter.setHome === 'function') {
        adapter.setHome(merged.home || '');
      }
    }
  }
  // opencode 的 server 校准通道：重建状态提供器（旧 SSE 连接释放，下次探测用新端口/密码）
  if (h === 'opencode' && agentMonitor) {
    if (agentStatusProvider && typeof agentStatusProvider.dispose === 'function') {
      agentStatusProvider.dispose();
    }
    agentStatusProvider = createOpencodeServerStatusProvider({
      ports: merged.port > 0 ? [merged.port] : undefined,
      password: merged.password ? merged.password : undefined
    });
    for (const adapter of agentMonitor.adapters) {
      if (adapter && typeof adapter.setStatusProvider === 'function') adapter.setStatusProvider(agentStatusProvider);
    }
  }
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
      code: current.weather_code,
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

ipcMain.handle('set-weather-fx', async (event, enabled) => {
  store.set('weatherFxEnabled', !!enabled);
  return true;
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
      refresh: String(shortcuts.refresh || DEFAULT_SHORTCUTS.REFRESH),
      toggleWidgets: String(shortcuts.toggleWidgets || DEFAULT_SHORTCUTS.TOGGLE_WIDGETS)
    };
    // 快捷键相同会导致注册冲突
    const values = [sanitized.toggleWindow, sanitized.refresh, sanitized.toggleWidgets];
    if (new Set(values).size !== values.length) return false;

    globalShortcut.unregisterAll();
    const reg1 = globalShortcut.register(sanitized.toggleWindow, handleGlobalToggleWindow);
    const reg2 = globalShortcut.register(sanitized.refresh, handleGlobalRefresh);
    const reg3 = globalShortcut.register(sanitized.toggleWidgets, handleGlobalToggleWidgets);
    if (!reg1 || !reg2 || !reg3) {
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

// GPU 加速开关：保存配置，重启应用后生效（参数必须在 whenReady 之前设置，无法热切换）
ipcMain.handle('set-gpu-acceleration', async (event, enabled) => {
  store.set('gpuAcceleration', !!enabled);
  return true;
});

// 鼠标特效配置
ipcMain.handle('set-mouse-effects', async (event, effects) => {
  if (!effects || typeof effects !== 'object') effects = {}; // 无参数调用不再抛 TypeError
  const current = store.get('mouseEffects', {});
  const next = {
    enabled: typeof effects.enabled === 'boolean' ? effects.enabled : !!current.enabled,
    type: ['ripple', 'stars', 'trail', 'aura'].includes(effects.type) ? effects.type : (current.type || 'stars'),
    customCursor: ['none', 'dot', 'arrow', 'star'].includes(effects.customCursor)
      ? effects.customCursor
      : (current.customCursor || 'none')
  };
  store.set('mouseEffects', next);
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
  const result = openEverythingSearch(keyword);
  if (result && result.ok) yieldTopmost();
  return result;
});

ipcMain.handle('set-everything-enabled', async (event, enabled) => {
  store.set('everythingEnabled', !!enabled);
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
      yieldTopmost();
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
    if (['cover', 'contain', 'fill', 'custom'].includes(settings.mode)) {
      config.mode = settings.mode;
    }
    if (Number.isFinite(settings.scale)) {
      config.scale = Math.max(100, Math.min(300, Math.round(settings.scale)));
    }
    if (Number.isFinite(settings.offsetX)) {
      config.offsetX = Math.max(-50, Math.min(50, Math.round(settings.offsetX)));
    }
    if (Number.isFinite(settings.offsetY)) {
      config.offsetY = Math.max(-50, Math.min(50, Math.round(settings.offsetY)));
    }
    if (Number.isFinite(settings.brightness)) {
      config.brightness = Math.max(50, Math.min(150, Math.round(settings.brightness)));
    }
    if (Number.isFinite(settings.saturation)) {
      config.saturation = Math.max(0, Math.min(200, Math.round(settings.saturation)));
    }
    if (Number.isFinite(settings.contrast)) {
      config.contrast = Math.max(50, Math.min(150, Math.round(settings.contrast)));
    }
    if (typeof settings.vignetteEnabled === 'boolean') {
      config.vignetteEnabled = settings.vignetteEnabled;
    }
    if (Number.isFinite(settings.vignette)) {
      config.vignette = Math.max(0, Math.min(80, Math.round(settings.vignette)));
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

// ============ 用户头像 ============
const AVATAR_MAX_DIM = 1024;
let avatarDir = null;

function getAvatarDir() {
  if (!avatarDir) {
    avatarDir = path.join(app.getPath('userData'), 'avatars');
  }
  return avatarDir;
}

function getAvatarFilePath() {
  return path.join(getAvatarDir(), 'avatar.png');
}

function getAvatarCropFilePath() {
  return path.join(getAvatarDir(), 'avatar-crop.png');
}

async function selectAvatarImage() {
  try {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择头像图片',
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
      const scale = Math.min(1, AVATAR_MAX_DIM / Math.max(size.width, size.height));
      if (scale < 1) {
        finalImg = img.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
          quality: 'best'
        });
      }
    }
    const pngData = finalImg.toPNG();
    if (!pngData || pngData.length === 0) {
      return { success: false, error: '图片编码失败' };
    }
    await fs.promises.mkdir(getAvatarDir(), { recursive: true });
    await fs.promises.writeFile(getAvatarFilePath(), pngData);
    try {
      if (fs.existsSync(getAvatarCropFilePath())) {
        await fs.promises.unlink(getAvatarCropFilePath());
      }
    } catch (e) { /* 忽略旧裁剪图清理失败 */ }
    // 更换图片后重置裁剪参数
    const profile = store.get('userProfile', {});
    profile.path = getAvatarFilePath();
    profile.cropPath = null;
    profile.scale = 1;
    profile.offsetX = 0;
    profile.offsetY = 0;
    store.set('userProfile', profile);
    return { success: true, profile, dataUrl: `data:image/png;base64,${pngData.toString('base64')}` };
  } catch (e) {
    console.error('选择头像图片失败:', e.message);
    return { success: false, error: e.message };
  }
}

async function getAvatarData() {
  try {
    const profile = store.get('userProfile', {});
    const filePath = profile && profile.cropPath && fs.existsSync(profile.cropPath)
      ? profile.cropPath
      : profile && profile.path;
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = await fs.promises.readFile(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

async function getAvatarSourceData() {
  try {
    const profile = store.get('userProfile', {});
    if (!profile || !profile.path || !fs.existsSync(profile.path)) return null;
    const data = await fs.promises.readFile(profile.path);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

ipcMain.handle('select-avatar-image', async () => {
  return await selectAvatarImage();
});

ipcMain.handle('set-user-profile', async (event, profile) => {
  try {
    if (!profile || typeof profile !== 'object') return { success: false };
    const current = store.get('userProfile', {});
    if (typeof profile.name === 'string') {
      current.name = profile.name.slice(0, 30);
    }
    if (typeof profile.shape === 'string' && ['circle', 'rounded'].includes(profile.shape)) {
      current.shape = profile.shape;
    }
    if (Number.isFinite(profile.scale)) {
      current.scale = Math.max(1, Math.min(8, profile.scale));
    }
    if (Number.isFinite(profile.offsetX)) {
      current.offsetX = Math.max(-100000, Math.min(100000, profile.offsetX));
    }
    if (Number.isFinite(profile.offsetY)) {
      current.offsetY = Math.max(-100000, Math.min(100000, profile.offsetY));
    }
    if (typeof profile.cropDataUrl === 'string' && profile.cropDataUrl) {
      const match = profile.cropDataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return { success: false, error: '头像裁剪数据格式无效' };
      const cropData = Buffer.from(match[1], 'base64');
      if (cropData.length === 0 || cropData.length > 4 * 1024 * 1024) {
        return { success: false, error: '头像裁剪数据过大' };
      }
      const cropImage = nativeImage.createFromBuffer(cropData);
      const cropSize = cropImage.getSize();
      if (cropImage.isEmpty() || !cropSize.width || !cropSize.height ||
          cropSize.width > AVATAR_MAX_DIM || cropSize.height > AVATAR_MAX_DIM) {
        return { success: false, error: '头像裁剪数据无效' };
      }
      await fs.promises.mkdir(getAvatarDir(), { recursive: true });
      await fs.promises.writeFile(getAvatarCropFilePath(), cropData);
      current.cropPath = getAvatarCropFilePath();
    }
    if (profile.removeAvatar === true) {
      current.path = null;
      current.cropPath = null;
      current.scale = 1;
      current.offsetX = 0;
      current.offsetY = 0;
      try {
        if (fs.existsSync(getAvatarFilePath())) {
          await fs.promises.unlink(getAvatarFilePath());
        }
        if (fs.existsSync(getAvatarCropFilePath())) {
          await fs.promises.unlink(getAvatarCropFilePath());
        }
      } catch (e) { /* 忽略 */ }
    }
    store.set('userProfile', current);
    return { success: true, profile: current };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-text-tone', async (event, tone) => {
  const value = Number.isFinite(tone) ? Math.max(-50, Math.min(50, Math.round(tone))) : 0;
  store.set('textTone', value);
  return true;
});

ipcMain.handle('set-text-tone-color', async (event, color) => {
  if (typeof color !== 'string') return false;
  const m = color.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number).filter((v) => v >= 0 && v <= 255);
    if (rgb.length === 3) {
      store.set('textToneColor', rgb.join(', '));
      return true;
    }
  }
  store.set('textToneColor', '');
  return true;
});

ipcMain.handle('set-icon-text-effect', async (event, effect) => {
  if (!['windows', 'auto', 'soft', 'strong', 'none'].includes(effect)) return false;
  store.set('iconTextEffect', effect);
  return true;
});

ipcMain.handle('set-font-family', async (event, fontFamily) => {
  store.set('fontFamily', typeof fontFamily === 'string' ? fontFamily.slice(0, 200) : '');
  return true;
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
    if (typeof newName !== 'string') return { success: false, error: '无效的文件名' };
    const trimmed = newName.trim();
    // Windows 文件名非法字符（含路径分隔符，防止穿越到桌面范围外）
    const invalidChars = /[<>:"/\\|?*]/;
    const hasControlChar = [...trimmed].some(ch => ch.charCodeAt(0) < 32);
    // Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，任意扩展名）
    const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
    if (!trimmed || trimmed === '.' || trimmed === '..' || invalidChars.test(trimmed) ||
        hasControlChar || trimmed.endsWith('.') || trimmed.endsWith(' ') ||
        reservedNames.test(trimmed)) {
      return { success: false, error: '文件名包含非法字符' };
    }
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, trimmed);
    if (!isAllowedPath(newPath)) return { success: false, error: '路径不允许' };
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
    // 显式布尔判断：任意真值（"yes"/1）此前也会触发永久删除而非回收站
    if (permanent === true) {
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
  'clay', 'night-clay', 'glass-light', 'glass-dark', 'obsidian', 'liquid-glass'
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

// 拟态液体玻璃主题参数的IPC处理
ipcMain.handle('get-liquid-glass-settings', async () => {
  return store.get('liquidGlass', {
    light: 70,
    lightAngle: 135,
    refraction: 35,
    depth: 45,
    dispersion: 50,
    frost: 18,
    spread: 55,
    chromaticMetal: 75
  });
});

ipcMain.handle('set-liquid-glass-settings', async (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') return false;
    const current = store.get('liquidGlass', {});
    const clamp = (val, min, max, def) => {
      const num = Number(val);
      return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : def;
    };
    const next = {
      light: clamp(settings.light, 0, 100, current.light ?? 70),
      lightAngle: clamp(settings.lightAngle, 0, 360, current.lightAngle ?? 135),
      refraction: clamp(settings.refraction, 0, 100, current.refraction ?? 35),
      depth: clamp(settings.depth, 0, 100, current.depth ?? 45),
      dispersion: clamp(settings.dispersion, 0, 100, current.dispersion ?? 50),
      frost: clamp(settings.frost, 0, 60, current.frost ?? 18),
      spread: clamp(settings.spread, 0, 100, current.spread ?? 55),
      chromaticMetal: clamp(settings.chromaticMetal, 0, 100, current.chromaticMetal ?? 75)
    };
    store.set('liquidGlass', next);
    return true;
  } catch (error) {
    console.error('Error setting liquid glass settings:', error);
    return false;
  }
});

// 巡航流光边框（Border Beam）功能的IPC处理
ipcMain.handle('get-border-beam-settings', async () => {
  return store.get('borderBeam', {
    enabled: false,
    windowBeam: true,
    agentBeam: true,
    dropBeam: true,
    searchBeam: true,
    colorMode: 'theme',
    speed: 4
  });
});

ipcMain.handle('set-border-beam-settings', async (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') return false;
    const current = store.get('borderBeam', {
      enabled: false,
      windowBeam: true,
      agentBeam: true,
      dropBeam: true,
      searchBeam: true,
      colorMode: 'theme',
      speed: 4
    });
    const validColors = ['theme', 'aurora', 'cyan', 'gold', 'purple'];
    const speedNum = Number(settings.speed);
    const validSpeed = Number.isFinite(speedNum) ? Math.max(1, Math.min(12, speedNum)) : (current.speed || 4);
    const next = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : current.enabled,
      windowBeam: typeof settings.windowBeam === 'boolean' ? settings.windowBeam : current.windowBeam,
      agentBeam: typeof settings.agentBeam === 'boolean' ? settings.agentBeam : current.agentBeam,
      dropBeam: typeof settings.dropBeam === 'boolean' ? settings.dropBeam : current.dropBeam,
      searchBeam: typeof settings.searchBeam === 'boolean' ? settings.searchBeam : current.searchBeam,
      colorMode: validColors.includes(settings.colorMode) ? settings.colorMode : (current.colorMode || 'theme'),
      speed: validSpeed
    };
    store.set('borderBeam', next);
    return true;
  } catch (error) {
    console.error('Error setting border beam settings:', error);
    return false;
  }
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
    // 白名单校验：非法值会破坏边缘吸附/隐藏的状态机（switch 落 default 静默失效）
    if (!Object.values(EDGE_TYPES).includes(edge)) return false;
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

// ============ 置顶让位机制 ============
// 打开外部程序/文件/浏览器时临时取消置顶，让目标窗口显示在最前；
// 应用窗口重新获得焦点或显示时恢复置顶（回到桌面 = 想要置顶）。
function yieldTopmost() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
  }
}

// 置顶修复限频：Windows 置顶锁定期（全屏应用抢置顶）内反复触发
// minimize/restore 会造成窗口闪烁，8 秒内只允许一次破坏性修复
let lastTopmostFixTime = 0;
const TOPMOST_FIX_INTERVAL = 8 * 1000;

function restoreTopmost() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setAlwaysOnTop(true, 'floating');
    } catch (e) { /* 忽略 */ }
    if (!mainWindow.isAlwaysOnTop()) {
      // Windows 会间歇性锁定窗口的置顶设置（setAlwaysOnTop 失效，窗口停在普通 Z 序）。
      // 最小化→还原可解除锁定；限频 + 本窗口所在显示器有全屏应用前台时跳过，避免窗口反复闪烁
      const now = Date.now();
      if (now - lastTopmostFixTime < TOPMOST_FIX_INTERVAL) return;
      if (isFullscreenAppForeground(mainWindow)) return;
      lastTopmostFixTime = now;
      try {
        mainWindow.minimize();
        mainWindow.restore();
      } catch (e) { /* 忽略 */ }
      try {
        mainWindow.setAlwaysOnTop(true, 'floating');
      } catch (e) { /* 忽略 */ }
    }
  }
}

// 右键菜单活动状态：仅当菜单确实显示过时才执行 cancel，避免每次右键多启动一个进程
let contextMenuActive = false;
let contextMenuSeq = 0; // 会话序号：只有最新一次菜单会话结束时才清 active 标志，避免旧会话覆盖新会话状态

// 统一的右键菜单运行入口：处理"取消旧菜单→打开新菜单→旧会话结束后误清新标志"的竞态
async function runContextMenu(kind, ...args) {
  const seq = ++contextMenuSeq;
  if (contextMenuActive) {
    try { await cancelDesktopContextMenu(); } catch (e) { /* 忽略 */ }
  }
  contextMenuActive = true;
  try {
    return kind === 'desktop'
      ? await showDesktopContextMenu(...args)
      : await showFileContextMenu(...args);
  } finally {
    if (seq === contextMenuSeq) {
      contextMenuActive = false;
    }
  }
}

ipcMain.handle('show-desktop-context-menu', async (event, x, y) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
    const result = await runContextMenu('desktop', Math.round(x), Math.round(y));
    // 菜单结束后不恢复置顶：若菜单打开了程序，让位保持；置顶由 focus/show 事件接管
    return result;
  } catch (error) {
    console.error('显示桌面右键菜单失败:', error);
    return false;
  }
});

ipcMain.handle('cancel-desktop-context-menu', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      await cancelDesktopContextMenu();
    } catch (e) { /* 忽略错误 */ }
  }
  contextMenuActive = false;
  return true;
});

ipcMain.handle('show-file-context-menu', async (event, filePath, x, y) => {
  // 与其余路径型 handler 一致：先做桌面管辖范围校验，防止对任意系统路径弹出操作菜单
  if (!isAllowedPath(filePath)) return false;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
    const result = await runContextMenu('file', filePath, Math.round(x), Math.round(y));
    // 菜单结束后不恢复置顶：若菜单打开了程序，让位保持；置顶由 focus/show 事件接管
    return result;
  } catch (error) {
    console.error('显示文件右键菜单失败:', error);
    return false;
  }
});

// GPU 加速开关：默认开启（与 Chrome/Edge 等主流应用一致），透明窗口 + GPU 合成在部分
// 旧机器上会崩溃，若崩溃则自动降级软件渲染（见下方 child-process-gone 监听）；用户也可
// 在设置中手动关闭。这些参数必须在 app.whenReady 之前设置，运行时切换需重启生效。
// --no-gpu 启动参数强制禁用（崩溃后无法进 UI 恢复时的兜底入口）
const gpuAccelerationEnabled = !process.argv.includes('--no-gpu') && store.get('gpuAcceleration', true);
if (!gpuAccelerationEnabled) {
  // 修复透明窗口的 GPU 进程错误（必须在 app.whenReady 之前调用）
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

// GPU 进程崩溃自动降级：写回设置（下次启动走软件渲染）+ 通知渲染进程提示，
// 与 Chrome 的 gpu-process-crashed 自动回退机制一致，无需用户手动处理
app.on('child-process-gone', (event, details) => {
  if (details && details.type === 'GPU') {
    console.warn('GPU 进程崩溃，自动关闭 GPU 加速:', details.reason || '');
    try {
      store.set('gpuAcceleration', false);
    } catch (e) { /* 忽略 */ }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('gpu-crash', { autoDisabled: true });
    }
  }
});

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
    
    // 崩溃恢复：上次会话在"桌面图标已隐藏"状态下被强杀/崩溃时，先恢复图标再重新隐藏，
    // 避免应用退出后桌面图标永久消失（恢复→隐藏仅在启动瞬间有轻微闪烁）
    if (store.get('desktopIconsHidden', false)) {
      showDesktopIcons();
    }
    
    // 先隐藏桌面图标，再创建窗口
    hideDesktopIcons();
    
    createWindow();
    tray = createTray(mainWindow, store);
    
    // 监听桌面文件变化，自动刷新
    startDesktopWatchers();

    // 启动桌面隐藏自愈轮询（explorer 重建后自动恢复隐藏与 skipTaskbar）
    startDesktopSelfHeal();
    
    // 注册全局快捷键
    registerGlobalShortcuts();
    
    // 启动性能数据采样进程（小组件使用）
    startSampler();
    
    // 启动 agent 会话监控（agent 小组件使用）：轮询 opencode 会话状态，
    // 变化时推送渲染进程；opencode 未安装时适配器自动降级为空列表
    const activeWindowMs = store.get('agentActiveThreshold', 120) * 1000;
    // 迁移旧版扁平配置（agentServerPort/agentServerPassword）→ 嵌套 agentConfigs.opencode
    {
      const cfg = store.get('agentConfigs', {}) || {};
      const oldPort = store.get('agentServerPort', 0);
      const oldPw = store.get('agentServerPassword', '');
      if (!cfg.opencode && (oldPort || oldPw)) {
        store.set('agentConfigs', { ...cfg, opencode: { port: oldPort, password: oldPw } });
      }
    }
    // server 状态校准通道配置：自跑 `opencode serve` 自定义端口/密码时由用户在设置中填入；
    // 未配置时用默认端口 4096 与无认证（serve 无密码免认证），env 密码兜底。
    // 注意：desktop sidecar 端口/密码均随机，此通道对 desktop 不可用，状态判定以 DB 推断为主
    const opencodeCfg = (store.get('agentConfigs', {}) || {}).opencode || {};
    const serverPort = Number.isFinite(opencodeCfg.port) ? opencodeCfg.port : 0;
    const serverPassword = typeof opencodeCfg.password === 'string' ? opencodeCfg.password : '';
    agentStatusProvider = createOpencodeServerStatusProvider({
      ports: serverPort > 0 ? [serverPort] : undefined,
      password: serverPassword ? serverPassword : undefined
    });
    // dsh（DeepSeek Harness）适配器：读取 ~/.dsh 会话投影缓存，无需额外配置；
    // 数据目录/端口可在设置中自定义（agentConfigs.dsh.{home,port}）
    const dshCfg = (store.get('agentConfigs', {}) || {}).dsh || {};
    const dshAdapter = createDshAdapter({
      home: typeof dshCfg.home === 'string' ? dshCfg.home : '',
      activeWindowMs
    });
    agentMonitor = new AgentMonitor({
      adapters: [
        createOpencodeAdapter({
          // server 权威状态校准：探测 `opencode serve`(默认 4096)，
          // 用 busy/idle/retry 覆盖 DB 推断；探测失败自动回落纯 DB 模式（desktop/TUI 场景即此模式）
          statusProvider: agentStatusProvider
        }),
        dshAdapter,
        // ZCode / Antigravity / Codex / Claude Code：全部默认路径只读检测，
        // 未安装时适配器静默返回空列表（渲染端不显示对应分组），无需任何配置
        createZcodeAdapter(),
        createAntigravityAdapter(),
        createCodexAdapter(),
        createClaudeAdapter()
      ],
      activeWindowMs,
      onUpdate: (sessions) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('agent-status-changed', sessions);
        }
      }
    });
    agentMonitor.start();

    // opencode / dsh 运行状态检测：关闭时渲染端锁定条目点击并显示提示。
    // 每 5s 检测一次（opencode 内部缓存 10s + 60s 确认期，信号抖动不会误判），
    // 按 harness 分别推送（渲染端逐个显示"（未开启）"标记）
    let agentRuntime = { opencode: false, dsh: false };
    const checkRuntime = async () => {
      try {
        // 每次检测从 store 读取 dsh 配置：设置中改端口/数据目录即时生效，无需重启
        const dshCfgNow = (store.get('agentConfigs', {}) || {}).dsh || {};
        const dshPort = Number.isFinite(dshCfgNow.port) && dshCfgNow.port > 0 ? dshCfgNow.port : undefined;
        const [ocRunning, dshRunning] = await Promise.all([
          detectOpencodeRunning(spawn),
          detectDshRunning(dshPort, undefined, undefined, dshCfgNow.home)
        ]);
        const next = { opencode: ocRunning, dsh: dshRunning };
        if (next.opencode !== agentRuntime.opencode || next.dsh !== agentRuntime.dsh) {
          agentRuntime = next;
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.send('agent-runtime-changed', { running: next });
          }
        }
      } catch (e) { /* 检测失败保持上次状态 */ }
    };
    checkRuntime();
    agentRuntimeTimer = setInterval(checkRuntime, 5000);
    
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

  // 图标缓存防抖写盘立即落盘，避免退出前 500ms 内的提取结果丢失
  try {
    flushIconCache();
  } catch (e) { /* 忽略 */ }

  // 停止文件监听
  stopDesktopWatchers();

  // 停止桌面隐藏自愈轮询
  stopDesktopSelfHeal();

  // 停止性能采样进程
  stopSampler();

  // 停止 agent 会话监控
  if (agentMonitor) {
    agentMonitor.stop();
    agentMonitor = null;
  }
  // 停止运行状态检测
  if (agentRuntimeTimer) {
    clearInterval(agentRuntimeTimer);
    agentRuntimeTimer = null;
  }
  // 释放 server SSE 订阅连接
  if (agentStatusProvider) {
    try { agentStatusProvider.dispose(); } catch (e) { /* 忽略 */ }
    agentStatusProvider = null;
  }

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
  REFRESH: 'CommandOrControl+Alt+R',
  TOGGLE_WIDGETS: 'CommandOrControl+Alt+W'
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

// 切换组件显隐
function handleGlobalToggleWidgets() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('toggle-widgets');
  }
}

function registerGlobalShortcuts() {
  const shortcuts = store.get('shortcuts', {});
  const toggleKey = shortcuts.toggleWindow || DEFAULT_SHORTCUTS.TOGGLE_WINDOW;
  const refreshKey = shortcuts.refresh || DEFAULT_SHORTCUTS.REFRESH;
  const widgetsKey = shortcuts.toggleWidgets || DEFAULT_SHORTCUTS.TOGGLE_WIDGETS;

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

  // 自定义快捷键：显示/隐藏组件
  const reg3 = globalShortcut.register(widgetsKey, handleGlobalToggleWidgets);
  if (!reg3) {
    console.warn('全局快捷键注册失败:', widgetsKey);
  }
}
