// 状态
let isCollapsed = false;
let files = [];

let autoHideEnabled = false;
let autoHideEdge = 'none';
let isAutoHidden = false;
let autoLaunchEnabled = false;
let contextMenuTimeout = null;
let sortBy = 'name-asc'; // 默认按名称升序排序
let theme = 'dark'; // 默认深色主题
let opacity = 92; // 默认透明度 92%
let iconSize = 40; // 默认图标大小 40px
let searchQuery = ''; // 搜索查询
let searchVisible = false; // 搜索栏是否可见
let manualOrder = []; // 手动排序的 path 顺序
let draggedItem = null; // 正在拖拽的元素
let groups = []; // 分组列表: [{ id, name, paths: [] }]
let currentGroupId = null; // 当前选中的分组 ID, null 表示"全部"
let iconsLocked = false; // 图标锁定
let arrangeRules = []; // 自动整理规则
let shortcuts = {}; // 自定义快捷键
let startupDelay = 0; // 开机延迟启动
let iconsVisible = true; // 图标可见性（双击空白切换）
let clipboard = null; // 剪贴板: { mode: 'copy'|'cut', paths: [] }
let folderPreviewEnabled = true; // 文件夹悬停预览开关
let everythingEnabled = false; // Everything 集成开关
let everythingInstalled = false; // 是否检测到 Everything
let everythingRunAsAdmin = false; // Everything 是否以管理员运行

// 多选
let selectedPaths = new Set();
let boxSelect = { active: false, startX: 0, startY: 0, moved: false };

// 文件夹预览
let previewTimer = null;
let previewPath = null;
let previewHideTimer = null;
let previewSwitchTimer = null;

// DOM 元素
let contentEl, toggleBtn, toggleIcon, refreshBtn, quitBtn, filesList;
let settingsBtn, settingsPanel, autoHideToggle, edgeSelect, sortSelect, themeSelect;
let opacitySlider, opacityValue;
let iconSizeSlider, iconSizeValue;
let autoLaunchToggle;
let searchBar, searchInput, searchClear, searchCount;
let groupsList, addGroupBtn, autoGroupBtn;
let selectionToolbar, selectionCount, selOpenBtn, selCopyBtn, selCutBtn, selPasteBtn, selDeleteBtn, selClearBtn;
let folderPreview, boxSelectEl;
let iconsLockToggle, rulesList, addRuleBtn, applyRulesBtn;
let startupDelayInput, languageSelect;
let shortcutToggleInput, shortcutRefreshInput;
let exportLayoutBtn, importLayoutBtn, quitAppBtn;
let everythingBar, everythingInput, everythingGo, everythingToggle, everythingStatus, everythingDownloadBtn, everythingAdminWarn;
let folderPreviewToggle;

// 刷新防抖
let refreshTimeout = null;
let isRefreshing = false;

// 文件映射
let filesMap = new Map();

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  contentEl = document.getElementById('content');
  toggleBtn = document.getElementById('toggle-btn');
  toggleIcon = document.getElementById('toggle-icon');
  refreshBtn = document.getElementById('refresh-btn');
  quitBtn = document.getElementById('quit-btn');
  filesList = document.getElementById('files-list');
  settingsBtn = document.getElementById('settings-btn');
  settingsPanel = document.getElementById('settings-panel');
  autoHideToggle = document.getElementById('auto-hide-toggle');
  edgeSelect = document.getElementById('edge-select');
  sortSelect = document.getElementById('sort-select');
  themeSelect = document.getElementById('theme-select');
  opacitySlider = document.getElementById('opacity-slider');
  opacityValue = document.getElementById('opacity-value');
  iconSizeSlider = document.getElementById('icon-size-slider');
  iconSizeValue = document.getElementById('icon-size-value');
  autoLaunchToggle = document.getElementById('auto-launch-toggle');
  searchBar = document.getElementById('search-bar');
  searchInput = document.getElementById('search-input');
  searchClear = document.getElementById('search-clear');
  searchCount = document.getElementById('search-count');
  groupsList = document.getElementById('groups-list');
  addGroupBtn = document.getElementById('add-group-btn');
  autoGroupBtn = document.getElementById('auto-group-btn');
  selectionToolbar = document.getElementById('selection-toolbar');
  selectionCount = document.getElementById('selection-count');
  selOpenBtn = document.getElementById('sel-open-btn');
  selCopyBtn = document.getElementById('sel-copy-btn');
  selCutBtn = document.getElementById('sel-cut-btn');
  selPasteBtn = document.getElementById('sel-paste-btn');
  selDeleteBtn = document.getElementById('sel-delete-btn');
  selClearBtn = document.getElementById('sel-clear-btn');
  folderPreview = document.getElementById('folder-preview');
  boxSelectEl = document.getElementById('box-select');
  iconsLockToggle = document.getElementById('icons-lock-toggle');
  rulesList = document.getElementById('rules-list');
  addRuleBtn = document.getElementById('add-rule-btn');
  applyRulesBtn = document.getElementById('apply-rules-btn');
  startupDelayInput = document.getElementById('startup-delay-input');
  languageSelect = document.getElementById('language-select');
  shortcutToggleInput = document.getElementById('shortcut-toggle-input');
  shortcutRefreshInput = document.getElementById('shortcut-refresh-input');
  exportLayoutBtn = document.getElementById('export-layout-btn');
  importLayoutBtn = document.getElementById('import-layout-btn');
  quitAppBtn = document.getElementById('quit-app-btn');
  everythingBar = document.getElementById('everything-bar');
  everythingInput = document.getElementById('everything-input');
  everythingGo = document.getElementById('everything-go');
  everythingToggle = document.getElementById('everything-toggle');
  everythingStatus = document.getElementById('everything-status');
  everythingDownloadBtn = document.getElementById('everything-download-btn');
  everythingAdminWarn = document.getElementById('everything-admin-warn');
  folderPreviewToggle = document.getElementById('folder-preview-toggle');

  // 绑定事件
  toggleBtn.addEventListener('click', handleToggleCollapse);
  refreshBtn.addEventListener('click', () => debouncedHandleRefresh(0));
  quitBtn.addEventListener('click', handleQuit);
  settingsBtn.addEventListener('click', handleToggleSettings);
  autoHideToggle.addEventListener('change', handleAutoHideToggle);
  edgeSelect.addEventListener('change', handleEdgeChange);
  sortSelect.addEventListener('change', handleSortChange);
  themeSelect.addEventListener('change', handleThemeChange);
  opacitySlider.addEventListener('input', handleOpacityChange);
  iconSizeSlider.addEventListener('input', handleIconSizeChange);
  autoLaunchToggle.addEventListener('change', handleAutoLaunchToggle);
  iconsLockToggle.addEventListener('change', handleIconsLockToggle);
  addRuleBtn.addEventListener('click', () => promptRuleEditor(null));
  applyRulesBtn.addEventListener('click', applyArrangeRules);
  startupDelayInput.addEventListener('change', handleStartupDelayChange);
  languageSelect.addEventListener('change', handleLanguageChange);
  exportLayoutBtn.addEventListener('click', handleExportLayout);
  importLayoutBtn.addEventListener('click', handleImportLayout);
  quitAppBtn.addEventListener('click', handleQuit);

  // Everything 搜索
  everythingToggle.addEventListener('change', handleEverythingToggle);
  everythingDownloadBtn.addEventListener('click', () => {
    window.api.openExternal('https://www.voidtools.com/downloads/');
  });
  everythingInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runEverythingSearch();
    }
  });
  everythingGo.addEventListener('click', runEverythingSearch);

  // 文件夹预览开关
  folderPreviewToggle.addEventListener('change', handleFolderPreviewToggle);

  // 快捷键录制
  bindShortcutRecorder(shortcutToggleInput, 'toggleWindow');
  bindShortcutRecorder(shortcutRefreshInput, 'refresh');

  // 搜索栏事件
  searchInput.addEventListener('input', handleSearchInput);
  searchClear.addEventListener('click', clearSearch);

  // 分组栏事件
  addGroupBtn.addEventListener('click', handleAddGroup);
  autoGroupBtn.addEventListener('click', handleAutoGroup);

  // 批量操作
  selOpenBtn.addEventListener('click', openSelected);
  selCopyBtn.addEventListener('click', () => copySelected('copy'));
  selCutBtn.addEventListener('click', () => copySelected('cut'));
  selPasteBtn.addEventListener('click', pasteFiles);
  selDeleteBtn.addEventListener('click', () => deleteSelected(false));
  selClearBtn.addEventListener('click', clearSelection);

  // 双击内容空白隐藏/恢复全部图标
  contentEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.file-item') || e.target.closest('.group-tab') ||
        e.target.closest('.search-bar') || e.target.closest('#groups-bar') ||
        e.target.closest('.settings-panel')) return;
    toggleIconsVisible();
  });

  // Ctrl + 滚轮调整图标大小
  document.addEventListener('wheel', handleWheelIconSize, { passive: false });

  document.addEventListener('keydown', handleKeyDown);

  // 内容区域空白处右键弹出桌面菜单
  contentEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.file-item')) return;
    e.preventDefault();
    handleDesktopContextMenu(e);
  });

  // 框选支持
  filesList.addEventListener('mousedown', handleBoxSelectStart);
  document.addEventListener('mousemove', handleBoxSelectMove);
  document.addEventListener('mouseup', handleBoxSelectEnd);

  // 预览面板 hover 保持：移入面板不消失，可滚动查看
  folderPreview.addEventListener('mouseenter', () => {
    if (previewHideTimer) {
      clearTimeout(previewHideTimer);
      previewHideTimer = null;
    }
  });
  folderPreview.addEventListener('mouseleave', () => scheduleHidePreview());

  // 预览面板双击：打开条目/图片原文件
  folderPreview.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.fp-item');
    if (row && row.dataset.path) {
      window.api.openFile(row.dataset.path);
      return;
    }
    if (folderPreview.dataset.isImage === 'true' && previewPath) {
      window.api.openFile(previewPath);
    }
  });

  // 监听初始化数据
  window.api.onInitData((data) => {
    files = data.files || [];
    isCollapsed = data.isCollapsed || false;
    autoHideEnabled = data.autoHideEnabled || false;
    autoHideEdge = data.autoHideEdge || 'none';
    sortBy = data.sortBy || 'name-asc';
    theme = data.theme || 'dark';
    opacity = data.opacity || 92;
    iconSize = data.iconSize || 40;
    autoLaunchEnabled = data.autoLaunch || false;
    manualOrder = Array.isArray(data.manualOrder) ? data.manualOrder : [];
    groups = Array.isArray(data.groups) ? data.groups : [];
    iconsLocked = !!data.iconsLocked;
    arrangeRules = Array.isArray(data.arrangeRules) ? data.arrangeRules : [];
    shortcuts = data.shortcuts || {};
    startupDelay = data.startupDelay || 0;
    iconsVisible = true;
    folderPreviewEnabled = data.folderPreviewEnabled !== false;
    everythingEnabled = !!data.everythingEnabled;
    everythingInstalled = !!data.everythingInstalled;
    everythingRunAsAdmin = !!data.everythingRunAsAdmin;

    setLanguage(data.language || 'zh-CN');

    renderGroups();
    renderFiles();
    updateCollapseState();
    updateAutoHideUI();
    updateAutoLaunchUI();
    updateSortUI();
    updateIconsLockUI();
    updateStartupDelayUI();
    updateShortcutInputs();
    renderRules();
    updateEverythingUI();
    updateFolderPreviewUI();
    applyTheme(theme);
    applyOpacity(opacity);
    applyIconSize(iconSize);
    if (languageSelect) languageSelect.value = data.language || 'zh-CN';
  });

  // 监听自动隐藏事件
  window.api.onAutoHideChanged((data) => {
    isAutoHidden = data.isHidden;
    updateAutoHideStatus();
  });

  window.api.onAutoHideStatus((data) => {
    autoHideEnabled = data.enabled;
    updateAutoHideUI();
  });

  window.api.onEdgeChanged((data) => {
    autoHideEdge = data.edge;
    edgeSelect.value = autoHideEdge;
  });

  window.api.onAutoLaunchChanged((data) => {
    autoLaunchEnabled = data.enabled;
    updateAutoLaunchUI();
  });

  // 监听系统主题变化
  window.api.onSystemThemeChanged(() => {
    if (theme === 'system') {
      applyTheme('system');
    }
  });

  // 监听打开设置事件(从托盘)
  window.api.onOpenSettings(() => {
    settingsPanel.style.display = 'block';
    settingsBtn.title = '隐藏设置';
  });

  // 监听全局快捷键触发的刷新 (Ctrl+Alt+R)
  window.api.onRefreshFiles(() => {
    debouncedHandleRefresh(0);
  });

  // 监听桌面文件变化（自动刷新）
  window.api.onDesktopChanged(() => {
    debouncedHandleRefresh(200);
  });

  // 监听语言变化
  window.api.onLanguageChanged((data) => {
    setLanguage(data.language);
    renderGroups();
    renderFiles();
    renderRules();
    updateAutoHideUI();
  });
});

// 折叠/展开
async function handleToggleCollapse() {
  isCollapsed = !isCollapsed;
  updateCollapseState();
  await window.api.toggleCollapse(isCollapsed);
}

function updateCollapseState() {
  if (isCollapsed) {
    contentEl.style.display = 'none';
    toggleIcon.textContent = '▶';
    toggleBtn.title = '展开';
  } else {
    contentEl.style.display = 'block';
    toggleIcon.textContent = '▼';
    toggleBtn.title = '折叠';
  }
}

// ============ 图标可见性（双击空白切换） ============
function toggleIconsVisible() {
  iconsVisible = !iconsVisible;
  contentEl.classList.toggle('icons-hidden', !iconsVisible);
  showToast(iconsVisible ? t('toggle.iconsShown') : t('toggle.iconsHidden'));
}

// 比较两个文件数组是否相等
function areFilesEqual(filesA, filesB) {
  if (!filesA || !filesB) return false;
  if (filesA.length !== filesB.length) return false;

  const setA = new Set(filesA.map(f => `${f.path}|${f.isDirectory}`));
  const setB = new Set(filesB.map(f => `${f.path}|${f.isDirectory}`));

  if (setA.size !== setB.size) return false;

  for (const key of setA) {
    if (!setB.has(key)) return false;
  }

  return true;
}

// 防抖刷新函数
async function debouncedHandleRefresh(delay = 500) {
  if (isRefreshing) {
    // 如果已经在刷新中，忽略新的刷新请求
    return;
  }

  clearTimeout(refreshTimeout);

  return new Promise((resolve) => {
    refreshTimeout = setTimeout(async () => {
      isRefreshing = true;
      try {
        await handleRefresh();
      } finally {
        isRefreshing = false;
      }
      resolve();
    }, delay);
  });
}

// 刷新文件
async function handleRefresh() {
  try {
    const newFiles = await window.api.refreshFiles();

    // 检查文件是否实际发生变化
    const filesChanged = !areFilesEqual(files, newFiles);

    if (filesChanged) {
      files = newFiles;
      sortFiles();
      renderFiles();
    } else {
      files = newFiles;
    }
  } catch (error) {
    console.error('刷新失败:', error);
  }
}

// 退出
function handleQuit() {
  window.api.quitApp();
}

// 设置面板
function handleToggleSettings() {
  const isVisible = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = isVisible ? 'none' : 'block';
  settingsBtn.title = isVisible ? '显示设置' : '隐藏设置';
}

// 主题切换
async function handleThemeChange() {
  try {
    theme = themeSelect.value;
    await window.api.setTheme(theme);
    applyTheme(theme);
  } catch (error) {
    console.error('设置主题失败:', error);
  }
}

// 应用主题
function applyTheme(themeMode) {
  const html = document.documentElement;

  if (themeMode === 'system') {
    // 跟随系统主题
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    html.setAttribute('data-theme', themeMode);
  }

  // 更新下拉菜单选中状态
  if (themeSelect) {
    themeSelect.value = themeMode;
  }
}

// 监听系统主题变化（用于跟随系统模式）
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme === 'system') {
      applyTheme('system');
    }
  });
}

// 透明度变化处理
async function handleOpacityChange() {
  try {
    opacity = parseInt(opacitySlider.value);
    opacityValue.textContent = opacity + '%';
    applyOpacity(opacity);
    await window.api.setOpacity(opacity);
  } catch (error) {
    console.error('设置透明度失败:', error);
  }
}

// 应用透明度
function applyOpacity(value) {
  const alpha = value / 100;
  const root = document.documentElement;
  root.style.setProperty('--opacity-bg', alpha);
  root.style.setProperty('--opacity-bg-header', Math.min(alpha + 0.03, 1));
  root.style.setProperty('--opacity-bg-panel', Math.min(alpha + 0.03, 1));

  // 更新滑块显示
  if (opacitySlider) {
    opacitySlider.value = value;
  }
  if (opacityValue) {
    opacityValue.textContent = value + '%';
  }
}

// 图标大小变化处理
async function handleIconSizeChange() {
  try {
    iconSize = parseInt(iconSizeSlider.value);
    iconSizeValue.textContent = iconSize + 'px';
    applyIconSize(iconSize);
    await window.api.setIconSize(iconSize);
  } catch (error) {
    console.error('设置图标大小失败:', error);
  }
}

// 应用图标大小
function applyIconSize(size) {
  const root = document.documentElement;
  root.style.setProperty('--icon-size', size + 'px');

  // 更新滑块显示
  if (iconSizeSlider) {
    iconSizeSlider.value = size;
  }
  if (iconSizeValue) {
    iconSizeValue.textContent = size + 'px';
  }
}

// Ctrl + 滚轮调整图标大小
async function handleWheelIconSize(e) {
  if (!e.ctrlKey) return;

  e.preventDefault();

  const delta = e.deltaY > 0 ? -4 : 4;
  iconSize = Math.min(96, Math.max(24, iconSize + delta));

  applyIconSize(iconSize);
  await window.api.setIconSize(iconSize);
}

// 自动隐藏开关
async function handleAutoHideToggle() {
  try {
    autoHideEnabled = autoHideToggle.checked;
    await window.api.setAutoHide(autoHideEnabled);
    updateAutoHideUI();
  } catch (error) {
    console.error('设置自动隐藏失败:', error);
    autoHideToggle.checked = !autoHideEnabled;
  }
}

// 开机启动开关
async function handleAutoLaunchToggle() {
  const previousState = autoLaunchEnabled;
  try {
    autoLaunchEnabled = autoLaunchToggle.checked;
    const result = await window.api.setAutoLaunch(autoLaunchEnabled);
    if (!result) {
      autoLaunchEnabled = previousState;
      updateAutoLaunchUI();
    }
  } catch (error) {
    console.error('设置开机启动失败:', error);
    autoLaunchEnabled = previousState;
    updateAutoLaunchUI();
  }
}

function updateAutoLaunchUI() {
  if (autoLaunchToggle) {
    autoLaunchToggle.checked = autoLaunchEnabled;
  }
}

// 图标锁定
async function handleIconsLockToggle() {
  iconsLocked = iconsLockToggle.checked;
  await window.api.setIconsLocked(iconsLocked);
  updateIconsLockUI();
  renderFiles();
}

function updateIconsLockUI() {
  if (iconsLockToggle) iconsLockToggle.checked = iconsLocked;
  document.body.classList.toggle('icons-locked', iconsLocked);
}

// 延迟启动
async function handleStartupDelayChange() {
  const value = parseInt(startupDelayInput.value) || 0;
  startupDelay = Math.max(0, Math.min(600, value));
  startupDelayInput.value = String(startupDelay);
  await window.api.setStartupDelay(startupDelay);
}

function updateStartupDelayUI() {
  if (startupDelayInput) startupDelayInput.value = String(startupDelay);
}

// 语言
async function handleLanguageChange() {
  const lang = languageSelect.value;
  setLanguage(lang);
  await window.api.setLanguage(lang);
  renderGroups();
  renderFiles();
  renderRules();
  updateAutoHideUI();
}

// 边缘选择
async function handleEdgeChange() {
  try {
    autoHideEdge = edgeSelect.value;
    await window.api.setAutoHideEdge(autoHideEdge);
  } catch (error) {
    console.error('设置边缘失败:', error);
  }
}

// 排序选择
async function handleSortChange() {
  try {
    sortBy = sortSelect.value;
    await window.api.setSortBy(sortBy);
    sortFiles();
    renderFiles();
  } catch (error) {
    console.error('设置排序失败:', error);
  }
}

// 更新排序UI
function updateSortUI() {
  if (sortSelect) {
    sortSelect.value = sortBy;
  }
}

// 排序文件列表
function sortFiles() {
  if (!files || files.length === 0) return;

  // 手动排序模式：使用保存的顺序，未记录的追加到末尾
  if (sortBy === 'manual') {
    const orderMap = new Map();
    manualOrder.forEach((p, i) => orderMap.set(p, i));
    files.sort((a, b) => {
      // 系统图标始终排在最前面
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      const ia = orderMap.has(a.path) ? orderMap.get(a.path) : Number.MAX_SAFE_INTEGER;
      const ib = orderMap.has(b.path) ? orderMap.get(b.path) : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      // 未记录的按名称排
      return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });
    });
    return;
  }

  files.sort((a, b) => {
    // 系统图标始终排在最前面
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;

    switch (sortBy) {
    case 'name-asc':
      return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });

    case 'name-desc':
      return b.name.localeCompare(a.name, 'zh-CN', { sensitivity: 'base' });

    case 'type': {
      // 文件夹优先，然后按扩展名排序
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      // 按扩展名分组排序，同类型按名称排序
      const extCompare = (a.extension || '').localeCompare(b.extension || '', 'zh-CN', { sensitivity: 'base' });
      if (extCompare !== 0) return extCompare;
      return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });
    }

    case 'modified-desc':
      return new Date(b.modified) - new Date(a.modified);

    case 'modified-asc':
      return new Date(a.modified) - new Date(b.modified);

    case 'size-desc':
      return (b.size || 0) - (a.size || 0);

    case 'size-asc':
      return (a.size || 0) - (b.size || 0);

    default:
      return 0;
    }
  });
}

// 更新自动隐藏UI
function updateAutoHideUI() {
  autoHideToggle.checked = autoHideEnabled;
  edgeSelect.value = autoHideEdge;
  edgeSelect.disabled = !autoHideEnabled;

  const statusText = document.getElementById('auto-hide-status');
  if (statusText) {
    if (autoHideEnabled) {
      const edgeNames = {
        'none': t('settings.edgeNone'),
        'top': t('settings.edgeTop'),
        'bottom': t('settings.edgeBottom'),
        'left': t('settings.edgeLeft'),
        'right': t('settings.edgeRight')
      };
      statusText.textContent = `${t('settings.autoHideOn')} (${edgeNames[autoHideEdge] || t('settings.edgeNone')})`;
      statusText.className = 'status-enabled';
    } else {
      statusText.textContent = t('settings.autoHideOff');
      statusText.className = 'status-disabled';
    }
  }
}

// 更新自动隐藏状态
function updateAutoHideStatus() {
  const statusIndicator = document.getElementById('auto-hide-indicator');
  if (statusIndicator) {
    if (isAutoHidden) {
      statusIndicator.className = 'indicator hidden';
      statusIndicator.title = t('settings.autoHideHidden');
    } else {
      statusIndicator.className = 'indicator visible';
      statusIndicator.title = t('settings.autoHideVisible');
    }
  }
}

// Emoji 图标映射（与主进程保持一致）
const SYSTEM_ICON_EMOJI = {
  '20D04FE0-3AEA-1069-A2D8-08002B30309D': '\u{1F5A5}\uFE0F',
  '645FF040-5081-101B-9F08-00AA002F954E': '\u{1F5D1}\uFE0F',
  '26EE0668-A00A-44D7-9371-BEB064C98683': '\u{2699}\uFE0F',
  'F02C1A0D-BE21-4350-88B0-7367FC96EF3C': '\u{1F310}',
  '031E4825-7B94-4DC3-B131-E946B44C8DD5': '\u{1F4DA}',
  '5399E694-6CE5-4D6C-8FCE-1D8870FDCBA0': '\u{2699}\uFE0F',
};

function getFileEmoji(file) {
  if (file.path && file.path.startsWith('::')) {
    for (const [clsid, emoji] of Object.entries(SYSTEM_ICON_EMOJI)) {
      if (file.path.includes(clsid)) return emoji;
    }
    return '\u{1F4C1}';
  }
  if (file.isDirectory) return '\u{1F4C1}';
  return '\u{1F4C4}';
}

let filesListEventsAttached = false;
function ensureFilesListEvents() {
  if (filesListEventsAttached || !filesList) return;
  filesListEventsAttached = true;
  filesList.addEventListener('click', handleFilesListClick);
  filesList.addEventListener('dblclick', handleFilesListDblClick);
  filesList.addEventListener('contextmenu', handleFilesListContextMenu);
}

// ============ 多选 ============
function handleFilesListClick(e) {
  const item = e.target.closest('.file-item');
  if (!item) return;
  e.stopPropagation();
  const path = item.dataset.path;
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  if (ctrl) {
    // Ctrl+点击：切换选中
    if (selectedPaths.has(path)) selectedPaths.delete(path);
    else selectedPaths.add(path);
  } else if (shift) {
    // Shift+点击：范围选择
    if (selectedPaths.size === 0) {
      selectedPaths.add(path);
    } else {
      const sorted = sortFilesInList(files);
      const paths = sorted.map(f => f.path);
      const firstIdx = paths.indexOf([...selectedPaths][0]);
      const lastIdx = paths.indexOf(path);
      if (firstIdx !== -1 && lastIdx !== -1) {
        const [a, b] = [Math.min(firstIdx, lastIdx), Math.max(firstIdx, lastIdx)];
        selectedPaths = new Set(paths.slice(a, b + 1));
      } else {
        selectedPaths.add(path);
      }
    }
  } else {
    // 普通点击：未选中则单选；已选中则取消选中
    if (selectedPaths.has(path)) {
      selectedPaths.delete(path);
    } else {
      clearSelection();
      selectedPaths.add(path);
    }
  }
  updateSelectionUI();
  updateItemSelectedClass();
}

function sortFilesInList(list) {
  const sorted = [...list];
  // 系统图标优先
  sorted.sort((a, b) => {
    if (a.isSystem && !b.isSystem) return -1;
    if (!a.isSystem && b.isSystem) return 1;
    const ia = files.indexOf(a);
    const ib = files.indexOf(b);
    return ia - ib;
  });
  return sorted;
}

function handleFilesListDblClick(e) {
  const item = e.target.closest('.file-item');
  if (!item) return;
  e.preventDefault();
  e.stopPropagation();
  const filePath = item.dataset.path;
  if (filePath) window.api.openFile(filePath);
}

function handleFilesListContextMenu(e) {
  const item = e.target.closest('.file-item');
  if (item) {
    e.preventDefault();
    e.stopPropagation();
    const path = item.dataset.path;
    // 右键未选中项时，先选中它
    if (!selectedPaths.has(path)) {
      clearSelection();
      selectedPaths.add(path);
      updateSelectionUI();
      updateItemSelectedClass();
    }
    handleFileContextMenu(e, path);
  } else {
    e.preventDefault();
    handleDesktopContextMenu(e);
  }
}

function getSelectedFiles() {
  const result = [];
  for (const p of selectedPaths) {
    const f = filesMap.get(p);
    if (f) result.push(f);
  }
  return result;
}

function clearSelection() {
  selectedPaths.clear();
  updateSelectionUI();
}

function updateItemSelectedClass() {
  for (const item of filesList.querySelectorAll('.file-item')) {
    item.classList.toggle('selected', selectedPaths.has(item.dataset.path));
  }
}

function updateSelectionUI() {
  const count = selectedPaths.size;
  // 仅多选（2 项及以上）时显示批量工具栏，避免单选时干扰
  if (count >= 2) {
    selectionToolbar.style.display = 'flex';
    selectionCount.textContent = t('files.selected', { n: count });
  } else {
    selectionToolbar.style.display = 'none';
  }
}

// ============ 框选 ============
function handleBoxSelectStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.file-item')) return;
  if (e.target.closest('.search-bar') || e.target.closest('#groups-bar') ||
      e.target.closest('.selection-toolbar')) return;
  // 空白区域按下：记录起点
  boxSelect = { active: true, startX: e.clientX, startY: e.clientY, moved: false };
  boxSelectEl.style.display = 'block';
  boxSelectEl.style.left = e.clientX + 'px';
  boxSelectEl.style.top = e.clientY + 'px';
  boxSelectEl.style.width = '0px';
  boxSelectEl.style.height = '0px';
  e.preventDefault();
}

function handleBoxSelectMove(e) {
  if (!boxSelect.active) return;
  if (!boxSelect.moved && (Math.abs(e.clientX - boxSelect.startX) > 4 || Math.abs(e.clientY - boxSelect.startY) > 4)) {
    boxSelect.moved = true;
  }
  if (!boxSelect.moved) return;
  const x = Math.min(boxSelect.startX, e.clientX);
  const y = Math.min(boxSelect.startY, e.clientY);
  const w = Math.abs(e.clientX - boxSelect.startX);
  const h = Math.abs(e.clientY - boxSelect.startY);
  boxSelectEl.style.left = x + 'px';
  boxSelectEl.style.top = y + 'px';
  boxSelectEl.style.width = w + 'px';
  boxSelectEl.style.height = h + 'px';

  // 计算矩形内图标
  const rect = { left: x, top: y, right: x + w, bottom: y + h };
  const items = filesList.querySelectorAll('.file-item');
  let changed = false;
  for (const item of items) {
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const inside = cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    if (inside) {
      if (!selectedPaths.has(item.dataset.path)) {
        selectedPaths.add(item.dataset.path);
        changed = true;
      }
      item.classList.add('in-box-select');
    } else {
      if (selectedPaths.has(item.dataset.path)) {
        selectedPaths.delete(item.dataset.path);
        changed = true;
      }
      item.classList.remove('in-box-select');
    }
  }
  if (changed) updateSelectionUI();
}

function handleBoxSelectEnd() {
  if (!boxSelect.active) return;
  const wasClick = !boxSelect.moved;
  boxSelect.active = false;
  boxSelectEl.style.display = 'none';
  for (const item of filesList.querySelectorAll('.file-item.in-box-select')) {
    item.classList.remove('in-box-select');
  }
  if (wasClick) {
    // 单击空白处：取消当前选择
    clearSelection();
    updateItemSelectedClass();
    return;
  }
  updateSelectionUI();
  updateItemSelectedClass();
}

// ============ 批量操作 ============
function openSelected() {
  const selected = getSelectedFiles();
  for (const f of selected) {
    window.api.openFile(f.path);
  }
}

async function copySelected(mode) {
  const selected = getSelectedFiles();
  if (selected.length === 0) return;
  clipboard = { mode, paths: selected.map(f => f.path) };
  const msg = mode === 'cut' ? t('clipboard.cut', { n: selected.length }) : t('clipboard.copied', { n: selected.length });
  showToast(msg);
  clearSelection();
}

function getDesktopDir() {
  const normal = files.find(f => !f.isSystem && !f.path.startsWith('::'));
  if (normal) {
    const idx = normal.path.lastIndexOf('\\');
    if (idx > 0) return normal.path.slice(0, idx);
  }
  return null;
}

function pasteFiles() {
  if (!clipboard || clipboard.paths.length === 0) {
    showToast(t('clipboard.empty'));
    return;
  }
  const targetDir = getDesktopDir();
  if (!targetDir) {
    showToast(t('clipboard.failed'));
    return;
  }
  window.api.pasteClipboard({ mode: clipboard.mode, paths: clipboard.paths, targetDir }).then((result) => {
    if (result && result.success) {
      const okCount = (result.results || []).filter(r => r.ok).length;
      showToast(t('clipboard.pasted', { n: okCount }));
      debouncedHandleRefresh(500);
    } else {
      showToast(t('clipboard.failed'));
    }
  }).catch(() => showToast(t('clipboard.failed')));
}

async function deleteSelected(permanent) {
  const selected = getSelectedFiles();
  if (selected.length === 0) return;
  if (!confirm(t('files.deleteConfirm', { n: selected.length }))) return;
  let failed = false;
  for (const f of selected) {
    const result = await window.api.deleteFile(f.path, permanent);
    if (!result.success) failed = true;
  }
  if (failed) showToast(t('files.deleteFail'));
  clearSelection();
  debouncedHandleRefresh(500);
}

// ============ 键盘 ============
function handleKeyDown(e) {
  const target = e.target;
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

  // Ctrl+F 切换搜索栏
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !isInput) {
    e.preventDefault();
    toggleSearchBar();
    return;
  }

  // F5 刷新
  if (e.key === 'F5') {
    e.preventDefault();
    debouncedHandleRefresh(0);
    return;
  }

  // Ctrl+A 全选
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isInput) {
    e.preventDefault();
    selectAllVisible();
    return;
  }

  // Ctrl+C / Ctrl+X / Ctrl+V
  if ((e.ctrlKey || e.metaKey) && !isInput) {
    const k = e.key.toLowerCase();
    if (k === 'c') {
      e.preventDefault();
      if (selectedPaths.size > 0) copySelected('copy');
      return;
    }
    if (k === 'x') {
      e.preventDefault();
      if (selectedPaths.size > 0) copySelected('cut');
      return;
    }
    if (k === 'v') {
      e.preventDefault();
      pasteFiles();
      return;
    }
  }

  // Esc 关闭搜索/取消选择
  if (e.key === 'Escape') {
    if (searchVisible) {
      e.preventDefault();
      clearSearch();
      hideSearchBar();
      return;
    }
    if (selectedPaths.size > 0) {
      clearSelection();
      updateItemSelectedClass();
      return;
    }
  }

  if (isInput) return;
  if (selectedPaths.size === 0) return;

  if (e.key === 'F2' && selectedPaths.size === 1) {
    e.preventDefault();
    renameSelected();
  } else if (e.key === 'Delete') {
    e.preventDefault();
    deleteSelected(e.shiftKey);
  }
}

function selectAllVisible() {
  selectedPaths.clear();
  for (const item of filesList.querySelectorAll('.file-item')) {
    selectedPaths.add(item.dataset.path);
  }
  updateSelectionUI();
  updateItemSelectedClass();
}

// ============ 搜索功能 ============
function toggleSearchBar() {
  if (searchVisible) {
    // 已显示：聚焦输入框（若已聚焦则关闭）
    if (document.activeElement === searchInput) {
      hideSearchBar();
    } else {
      searchInput.focus();
      searchInput.select();
    }
  } else {
    showSearchBar();
  }
}

function showSearchBar() {
  searchVisible = true;
  searchBar.style.display = 'flex';
  searchInput.focus();
  updateSearchCount();
}

function hideSearchBar() {
  searchVisible = false;
  searchBar.style.display = 'none';
  if (searchQuery) {
    searchQuery = '';
    searchInput.value = '';
    renderFiles();
  }
}

function handleSearchInput(e) {
  searchQuery = e.target.value.trim();
  clearSelection();
  renderFiles();
  updateSearchCount();
}

function clearSearch() {
  if (searchInput.value) {
    searchInput.value = '';
    searchQuery = '';
    renderFiles();
    updateSearchCount();
    searchInput.focus();
  }
}

function updateSearchCount() {
  if (!searchCount) return;
  if (!searchQuery) {
    searchCount.textContent = '';
    return;
  }
  const filtered = getFilteredFiles();
  searchCount.textContent = `${filtered.length}/${files.length}`;
}

function getFilteredFiles() {
  let result = files;

  // 先按分组过滤
  if (currentGroupId !== null) {
    const group = groups.find(g => g.id === currentGroupId);
    if (group) {
      const pathSet = new Set(group.paths || []);
      // 系统图标始终显示
      result = result.filter(f => f.isSystem || pathSet.has(f.path));
    }
  }

  // 再按搜索过滤
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(f => {
      if (f.name && f.name.toLowerCase().includes(q)) return true;
      if (f.extension && f.extension.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  return result;
}

// ============ 悬停预览（文件夹列表 / 图片） ============
const FOLDER_PREVIEW_DELAY = 350;
const FOLDER_PREVIEW_SWITCH_DELAY = 200;
const FOLDER_PREVIEW_HIDE_DELAY = 250;
const FOLDER_PREVIEW_MAX = 25;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff']);

function isPreviewableFile(file) {
  if (!file) return false;
  if (file.isDirectory) return true;
  return file.extension && IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

function schedulePreview(file, item) {
  const dirPath = file.path;
  // 清除延迟隐藏计时器（鼠标回来了）
  if (previewHideTimer) {
    clearTimeout(previewHideTimer);
    previewHideTimer = null;
  }
  // 清除未完成的切换计时器
  if (previewSwitchTimer) {
    clearTimeout(previewSwitchTimer);
    previewSwitchTimer = null;
  }
  // 同一文件的预览已在显示：保持即可
  if (previewPath === dirPath && folderPreview.style.display === 'block') {
    return;
  }
  // 另一个预览正在显示：鼠标需停留片刻才切换，
  // 避免鼠标从预览区域移回时路过其他图标而顶掉当前预览
  if (previewPath && previewPath !== dirPath && folderPreview.style.display === 'block') {
    previewSwitchTimer = setTimeout(() => {
      previewSwitchTimer = null;
      if (previewPath === dirPath) return;
      cancelPreview();
      startPreviewTimer(file, item);
    }, FOLDER_PREVIEW_SWITCH_DELAY);
    return;
  }
  cancelPreview();
  startPreviewTimer(file, item);
}

function startPreviewTimer(file, item) {
  previewPath = file.path;
  previewTimer = setTimeout(async () => {
    previewTimer = null;
    if (previewPath !== file.path) return;
    if (file.isDirectory) {
      const entries = await window.api.listDirectory(file.path);
      if (previewPath !== file.path) return;
      showFolderPreview(item, entries || []);
    } else {
      const dataUrl = await window.api.getImagePreview(file.path);
      if (previewPath !== file.path) return;
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
        showImagePreview(item, file, dataUrl);
      }
    }
  }, FOLDER_PREVIEW_DELAY);
}

// 延迟隐藏：鼠标移出图标/预览面板后短暂停留，期间移回则不消失
function scheduleHidePreview() {
  if (previewHideTimer) clearTimeout(previewHideTimer);
  previewHideTimer = setTimeout(() => {
    previewHideTimer = null;
    cancelPreview();
  }, FOLDER_PREVIEW_HIDE_DELAY);
}

function cancelPreview() {
  previewPath = null;
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (previewHideTimer) {
    clearTimeout(previewHideTimer);
    previewHideTimer = null;
  }
  if (previewSwitchTimer) {
    clearTimeout(previewSwitchTimer);
    previewSwitchTimer = null;
  }
  folderPreview.style.display = 'none';
  folderPreview.innerHTML = '';
}

function buildPreviewHeader(item) {
  const header = document.createElement('div');
  header.className = 'fp-header';
  const title = document.createElement('span');
  title.textContent = item.querySelector('.file-name').textContent;
  header.appendChild(title);
  return header;
}

function showFolderPreview(item, entries) {
  folderPreview.dataset.isImage = 'false';
  folderPreview.innerHTML = '';
  folderPreview.appendChild(buildPreviewHeader(item));

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fp-empty';
    empty.textContent = t('preview.empty');
    folderPreview.appendChild(empty);
  } else {
    for (const entry of entries.slice(0, FOLDER_PREVIEW_MAX)) {
      const row = document.createElement('div');
      row.className = 'fp-item';
      if (entry.path) row.dataset.path = entry.path;
      const emoji = document.createElement('span');
      emoji.className = 'fp-emoji';
      emoji.textContent = entry.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
      const name = document.createElement('span');
      name.textContent = entry.name;
      row.appendChild(emoji);
      row.appendChild(name);
      folderPreview.appendChild(row);
    }
    if (entries.length > FOLDER_PREVIEW_MAX) {
      const more = document.createElement('div');
      more.className = 'fp-more';
      more.textContent = t('preview.more', { n: entries.length - FOLDER_PREVIEW_MAX });
      folderPreview.appendChild(more);
    }
    // 异步加载真实图标（复用主列表的图标提取/缓存链路），失败保留 emoji 占位
    loadPreviewIcons(entries);
  }

  positionPreviewPanel(item);
}

// 为预览面板条目异步加载真实文件图标
async function loadPreviewIcons(entries) {
  const valid = entries.filter(e => e && e.path && typeof e.path === 'string');
  if (valid.length === 0) return;
  const fileObjects = valid.map(e => ({ path: e.path, isDirectory: !!e.isDirectory }));
  try {
    const results = await window.api.getFileIcons(fileObjects);
    for (const [path, iconData] of Object.entries(results)) {
      if (!(typeof iconData === 'string' && iconData.startsWith('data:image'))) continue;
      const row = folderPreview.querySelector(`.fp-item[data-path="${CSS.escape(path)}"]`);
      if (!row) continue;
      const emojiEl = row.querySelector('.fp-emoji');
      if (!emojiEl) continue;
      const img = document.createElement('img');
      img.src = iconData;
      img.alt = 'icon';
      img.className = 'fp-icon-img';
      img.draggable = false;
      emojiEl.replaceWith(img);
    }
  } catch (error) {
    // 提取失败时保留 emoji 占位
  }
}

function showImagePreview(item, file, dataUrl) {
  folderPreview.dataset.isImage = 'true';
  folderPreview.innerHTML = '';
  folderPreview.appendChild(buildPreviewHeader(item));

  const img = document.createElement('img');
  img.className = 'fp-image';
  img.src = dataUrl;
  img.alt = file.name;
  img.draggable = false;
  folderPreview.appendChild(img);

  positionPreviewPanel(item);
  // 图片解码完成后重新定位，避免按未加载尺寸放置偏移
  img.onload = () => positionPreviewPanel(item);
}

// 先渲染再测量，智能定位（优先右侧，空间不足时切换方向）
function positionPreviewPanel(item) {
  const rect = item.getBoundingClientRect();
  folderPreview.style.display = 'block';
  folderPreview.style.visibility = 'hidden';
  folderPreview.style.left = '0px';
  folderPreview.style.top = '0px';
  const pw = folderPreview.offsetWidth;
  const ph = folderPreview.offsetHeight;
  const margin = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.right + margin;
  if (left + pw > vw - margin) {
    left = Math.max(margin, rect.left - pw - margin);
  }
  let top = rect.top;
  if (top + ph > vh - margin) {
    top = Math.max(margin, vh - ph - margin);
  }

  folderPreview.style.visibility = 'visible';
  folderPreview.style.left = Math.round(left) + 'px';
  folderPreview.style.top = Math.round(top) + 'px';
}

async function startRename(filePath) {
  const item = filesList.querySelector(`.file-item[data-path="${CSS.escape(filePath)}"]`);
  if (!item) return;

  const nameDiv = item.querySelector('.file-name');
  if (!nameDiv) return;

  const file = filesMap.get(filePath);
  if (!file) return;

  const currentName = file.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'rename-input';

  const baseName = file.isDirectory ? currentName : currentName.replace(/\.[^.]+$/, '');

  nameDiv.innerHTML = '';
  nameDiv.appendChild(input);
  input.focus();
  input.setSelectionRange(0, baseName.length);

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      const result = await window.api.renameFile(filePath, newName);
      if (result.success) {
        debouncedHandleRefresh(500);
      } else {
        nameDiv.textContent = currentName;
      }
    } else {
      nameDiv.textContent = currentName;
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true;
      nameDiv.textContent = currentName;
    }
  });
}

function renameSelected() {
  const selected = getSelectedFiles();
  if (selected.length !== 1) return;
  startRename(selected[0].path);
}

function rebuildFilesMap() {
  filesMap.clear();
  for (const file of files) {
    filesMap.set(file.path, file);
  }
}

function renderFiles() {
  if (!filesList) return;
  ensureFilesListEvents();

  if (files.length === 0) {
    filesList.innerHTML = '<div class="empty">' + t('files.empty') + '</div>';
    return;
  }

  sortFiles();
  rebuildFilesMap();

  // 应用搜索/分组过滤
  const visibleFiles = getFilteredFiles();

  if (visibleFiles.length === 0 && searchQuery) {
    filesList.innerHTML = `<div class="empty">${t('files.noMatch')}</div>`;
    return;
  }

  const existingItems = filesList.querySelectorAll('.file-item');
  const existingMap = new Map();
  for (const el of existingItems) {
    existingMap.set(el.dataset.path, el);
  }

  const newPaths = new Set(visibleFiles.map(f => f.path));

  for (const [path, el] of existingMap) {
    if (!newPaths.has(path)) {
      el.remove();
    }
  }

  const emptyMsg = filesList.querySelector('.empty');
  if (emptyMsg) emptyMsg.remove();

  const fragment = document.createDocumentFragment();
  let needsIconLoad = false;

  for (const file of visibleFiles) {
    const existing = existingMap.get(file.path);
    if (existing) {
      const nameDiv = existing.querySelector('.file-name');
      if (nameDiv && nameDiv.textContent !== file.name) {
        nameDiv.textContent = file.name;
      }
      const iconDiv = existing.querySelector('.file-icon');
      if (iconDiv && (!iconDiv.querySelector('img') || iconDiv.dataset.iconFailed === 'true')) {
        needsIconLoad = true;
      }
      // 更新拖拽属性和选中态
      updateDraggable(existing, file);
      existing.classList.toggle('selected', selectedPaths.has(file.path));
      fragment.appendChild(existing);
    } else {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.path = file.path;
      item.dataset.isSystem = file.isSystem || false;

      const iconDiv = document.createElement('div');
      iconDiv.className = 'file-icon';
      iconDiv.dataset.iconPath = file.path;
      iconDiv.textContent = getFileEmoji(file);

      const nameDiv = document.createElement('div');
      nameDiv.className = 'file-name';
      nameDiv.textContent = file.name;

      item.appendChild(iconDiv);
      item.appendChild(nameDiv);
      updateDraggable(item, file);
      item.classList.toggle('selected', selectedPaths.has(file.path));

      // 悬停预览绑定（文件夹列表 / 图片）
      item.addEventListener('mouseenter', () => {
        const f = filesMap.get(file.path);
        if (f && folderPreviewEnabled && isPreviewableFile(f)) schedulePreview(f, item);
      });
      item.addEventListener('mouseleave', () => {
        // 鼠标离开了当前悬停的图标：取消未完成的预览切换
        if (previewSwitchTimer) {
          clearTimeout(previewSwitchTimer);
          previewSwitchTimer = null;
        }
        scheduleHidePreview();
      });

      fragment.appendChild(item);
      needsIconLoad = true;
    }
  }

  filesList.innerHTML = '';
  filesList.appendChild(fragment);

  if (needsIconLoad) {
    loadIconsAsync();
  }
}

// ============ 拖拽排序 ============
function updateDraggable(item, file) {
  // 图标锁定或系统图标不可拖拽；手动排序模式下可拖拽排序；存在分组时可拖到分组
  const canDrag = !iconsLocked && !file.isSystem && (sortBy === 'manual' || groups.length > 0);
  if (canDrag) {
    item.draggable = true;
    item.classList.add('draggable');
    if (!item.dataset.dragBound) {
      item.dataset.dragBound = 'true';
      item.addEventListener('dragstart', handleDragStart);
      item.addEventListener('dragend', handleDragEnd);
      item.addEventListener('dragover', handleDragOver);
      item.addEventListener('dragenter', handleDragEnter);
      item.addEventListener('dragleave', handleDragLeave);
      item.addEventListener('drop', handleDrop);
    }
  } else {
    item.draggable = false;
    item.classList.remove('draggable');
  }
}

function handleDragStart(e) {
  draggedItem = e.currentTarget;
  draggedItem.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // 必须设置 data 才能在某些浏览器触发 drop
  try { e.dataTransfer.setData('text/plain', draggedItem.dataset.path); } catch (_err) { /* 某些环境不支持，忽略 */ }
  // 显示拖拽提示
  document.querySelectorAll('.group-tab').forEach(el => el.classList.add('drag-active'));
}

function handleDragEnd() {
  if (draggedItem) draggedItem.classList.remove('dragging');
  // 清理所有 drag-over 标记
  document.querySelectorAll('.file-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.group-tab.drag-active, .group-tab.drop-target').forEach(el => {
    el.classList.remove('drag-active', 'drop-target');
  });
  draggedItem = null;
}

function handleDragOver(e) {
  if (!draggedItem) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  if (!draggedItem) return;
  const item = e.currentTarget;
  if (item === draggedItem) return;
  item.classList.add('drag-over');
}

function handleDragLeave(e) {
  const item = e.currentTarget;
  item.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetItem = e.currentTarget;
  if (!draggedItem || targetItem === draggedItem) return;
  targetItem.classList.remove('drag-over');

  // 仅在手动排序模式下重新排序 DOM
  if (sortBy === 'manual') {
    const parent = targetItem.parentNode;
    const children = Array.from(parent.children);
    const draggedIndex = children.indexOf(draggedItem);
    const targetIndex = children.indexOf(targetItem);

    if (draggedIndex < targetIndex) {
      parent.insertBefore(draggedItem, targetItem.nextSibling);
    } else {
      parent.insertBefore(draggedItem, targetItem);
    }

    // 保存新的手动顺序
    saveManualOrder();
  }
}

function saveManualOrder() {
  // 仅保存非系统图标的顺序
  const items = filesList.querySelectorAll('.file-item:not([data-is-system="true"])');
  manualOrder = Array.from(items).map(el => el.dataset.path);
  if (window.api && window.api.setManualOrder) {
    window.api.setManualOrder(manualOrder);
  }
}

// HTML 转义，防止搜索关键词注入
function escapeHtml(str) {
  // 使用单字符 key 避开引号冲突
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const quoteKey = String.fromCharCode(39); // 单引号
  map[quoteKey] = '&#39;';
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

// ============ 分组管理 ============
function renderGroups() {
  if (!groupsList) return;
  groupsList.innerHTML = '';

  // "全部" 选项
  const allTab = document.createElement('div');
  allTab.className = 'group-tab' + (currentGroupId === null ? ' active' : '');
  allTab.dataset.groupId = '';
  allTab.innerHTML = '<span class="group-name">' + t('fence.all') + '</span>';
  allTab.addEventListener('click', () => switchGroup(null));
  groupsList.appendChild(allTab);

  for (const group of groups) {
    const tab = document.createElement('div');
    tab.className = 'group-tab' + (currentGroupId === group.id ? ' active' : '');
    tab.dataset.groupId = group.id;
    const count = (group.paths || []).length;
    tab.innerHTML = `
      <span class="group-name">${escapeHtml(group.name)}</span>
      <span class="group-count">(${count})</span>
      <button class="group-delete" title="删除分组">×</button>
    `;

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.group-delete')) return;
      switchGroup(group.id);
    });

    // 删除按钮
    tab.querySelector('.group-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteGroup(group.id);
    });

    // 拖拽到分组时加入
    tab.addEventListener('dragover', (e) => {
      if (!draggedItem || iconsLocked) return;
      e.preventDefault();
      tab.classList.add('drop-target');
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drop-target');
    });
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drop-target');
      if (!draggedItem || iconsLocked) return;
      const path = draggedItem.dataset.path;
      addPathToGroup(group.id, path);
    });

    // 双击重命名
    tab.addEventListener('dblclick', (e) => {
      if (e.target.closest('.group-delete')) return;
      handleRenameGroup(group.id);
    });

    groupsList.appendChild(tab);
  }
}

function switchGroup(groupId) {
  currentGroupId = groupId;
  clearSelection();
  renderGroups();
  renderFiles();
}

async function handleAddGroup() {
  const name = await createInlineInput('新分组名称', '');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const newGroup = {
    id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name: trimmed,
    paths: []
  };
  groups.push(newGroup);
  saveGroups();
  currentGroupId = newGroup.id;
  renderGroups();
  renderFiles();
}

const TYPE_CATEGORIES = [
  { name: '文件夹', test: (f) => f.isDirectory },
  { name: '文档', test: (f) => ['.txt', '.doc', '.docx', '.pdf', '.rtf', '.odt', '.wps'].includes(f.extension) },
  { name: '图片', test: (f) => ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff'].includes(f.extension) },
  { name: '视频', test: (f) => ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(f.extension) },
  { name: '音频', test: (f) => ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'].includes(f.extension) },
  { name: '压缩包', test: (f) => ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(f.extension) },
  { name: '程序', test: (f) => ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.app'].includes(f.extension) },
  { name: '代码', test: (f) => ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.go', '.rs', '.sh'].includes(f.extension) },
];

function handleAutoGroup() {
  if (!files || files.length === 0) return;

  const categorized = new Map();
  const uncategorized = [];

  for (const file of files) {
    if (file.isSystem) continue;
    let matched = false;
    for (const cat of TYPE_CATEGORIES) {
      if (cat.test(file)) {
        if (!categorized.has(cat.name)) categorized.set(cat.name, []);
        categorized.get(cat.name).push(file.path);
        matched = true;
        break;
      }
    }
    if (!matched) {
      uncategorized.push(file.path);
    }
  }

  if (uncategorized.length > 0) {
    categorized.set('其他', uncategorized);
  }

  if (categorized.size === 0) return;

  const newGroups = [];
  const ts = Date.now();
  let i = 0;
  for (const [name, paths] of categorized) {
    if (paths.length === 0) continue;
    newGroups.push({
      id: 'g_' + ts + '_' + (i++),
      name: name,
      paths: paths
    });
  }

  if (newGroups.length === 0) return;

  if (groups.length > 0) {
    if (!confirm('将清除现有分组并按文件类型重新创建，是否继续？')) return;
    groups = newGroups;
  } else {
    groups = newGroups;
  }

  saveGroups();
  renderGroups();
  renderFiles();
}

function handleDeleteGroup(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  if (!confirm(`确定删除分组 "${group.name}" 吗？（不会删除文件本身）`)) return;

  groups = groups.filter(g => g.id !== groupId);
  if (currentGroupId === groupId) currentGroupId = null;
  saveGroups();
  renderGroups();
  renderFiles();
}

async function handleRenameGroup(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  const newName = await createInlineInput('重命名分组', group.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === group.name) return;
  group.name = trimmed;
  saveGroups();
  renderGroups();
}

function addPathToGroup(groupId, path) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;
  if (!group.paths) group.paths = [];
  if (group.paths.includes(path)) {
    // 已存在则移除（切换）
    group.paths = group.paths.filter(p => p !== path);
  } else {
    group.paths.push(path);
  }
  saveGroups();
  renderGroups();
  // 不强制 renderFiles，避免打断拖拽
}

function saveGroups() {
  if (window.api && window.api.setGroups) {
    window.api.setGroups(groups);
  }
}

function createInlineInput(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'prompt-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'prompt-dialog';

    const titleEl = document.createElement('div');
    titleEl.className = 'prompt-title';
    titleEl.textContent = title;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'prompt-input';
    input.value = defaultValue;

    const btnRow = document.createElement('div');
    btnRow.className = 'prompt-buttons';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'prompt-btn prompt-btn-confirm';
    confirmBtn.textContent = '确定';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'prompt-btn prompt-btn-cancel';
    cancelBtn.textContent = '取消';

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(cancelBtn);
    dialog.appendChild(titleEl);
    dialog.appendChild(input);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    input.focus();
    input.select();

    let resolved = false;
    const close = (value) => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(value);
    };

    confirmBtn.addEventListener('click', () => close(input.value));
    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
  });
}

// ============ 右键菜单 ============
async function handleFileContextMenu(e, filePath) {
  if (!filePath) return;

  if (contextMenuTimeout) {
    clearTimeout(contextMenuTimeout);
    contextMenuTimeout = null;
  }

  const screenX = e.screenX;
  const screenY = e.screenY;

  const item = e.target.closest('.file-item');
  if (item) item.classList.add('context-menu-active');

  // 菜单关闭后无需强制刷新：fs.watch 会自动检测文件变化
  window.api.showFileContextMenu(filePath, screenX, screenY).then(() => {
    if (item) item.classList.remove('context-menu-active');
  }).catch(() => {
    if (item) item.classList.remove('context-menu-active');
  });

  contextMenuTimeout = setTimeout(() => {
    contextMenuTimeout = null;
  }, 200);
}

async function handleDesktopContextMenu(e) {
  if (contextMenuTimeout) {
    clearTimeout(contextMenuTimeout);
    contextMenuTimeout = null;
  }

  const screenX = e.screenX;
  const screenY = e.screenY;

  window.api.showDesktopContextMenu(screenX, screenY);

  contextMenuTimeout = setTimeout(() => {
    contextMenuTimeout = null;
  }, 200);
}

// ============ 自动整理规则 ============
function renderRules() {
  if (!rulesList) return;
  rulesList.innerHTML = '';
  if (arrangeRules.length === 0) return;
  for (const rule of arrangeRules) {
    const row = document.createElement('div');
    row.className = 'rule-item';
    const name = document.createElement('span');
    name.className = 'rule-name';
    name.textContent = rule.name;
    const detail = document.createElement('span');
    detail.className = 'rule-detail';
    const parts = [];
    if (rule.keywords && rule.keywords.length) parts.push(rule.keywords.join(', '));
    if (rule.extensions && rule.extensions.length) parts.push(rule.extensions.join(', '));
    detail.textContent = parts.join(' | ');
    const actions = document.createElement('div');
    actions.className = 'rule-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = '✎';
    editBtn.title = t('rule.editTitle');
    editBtn.addEventListener('click', () => promptRuleEditor(rule));
    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.className = 'danger';
    delBtn.title = t('rule.delete');
    delBtn.addEventListener('click', () => {
      if (!confirm(t('rule.deleteConfirm', { name: rule.name }))) return;
      arrangeRules = arrangeRules.filter(r => r.id !== rule.id);
      saveRules();
      renderRules();
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(name);
    row.appendChild(detail);
    row.appendChild(actions);
    rulesList.appendChild(row);
  }
}

function saveRules() {
  window.api.setArrangeRules(arrangeRules);
}

async function promptRuleEditor(existing) {
  const name = await createInlineInput(t('rule.name'), existing ? existing.name : '');
  if (name === null) return;
  const rule = existing || { id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) };
  rule.name = name.trim() || '未命名';
  const keywordsStr = await createInlineInput(t('rule.keywords'), (rule.keywords || []).join(', '));
  if (keywordsStr === null) return;
  const extStr = await createInlineInput(t('rule.extensions'), (rule.extensions || []).join(', '));
  if (extStr === null) return;
  rule.keywords = keywordsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  rule.extensions = extStr.split(/[,，]/).map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
  if (!existing) arrangeRules.push(rule);
  saveRules();
  renderRules();
}

function matchRule(file, rule) {
  const name = file.name.toLowerCase();
  if (rule.keywords && rule.keywords.some(k => k && name.includes(k.toLowerCase()))) return true;
  if (rule.extensions && rule.extensions.some(ext => file.extension === '.' + ext.toLowerCase())) return true;
  return false;
}

async function applyArrangeRules() {
  if (arrangeRules.length === 0 || files.length === 0) {
    showToast(t('rule.noMatch'));
    return;
  }
  let categorized = 0;
  for (const file of files) {
    if (file.isSystem) continue;
    let targetGroup = null;
    for (const rule of arrangeRules) {
      if (matchRule(file, rule)) {
        targetGroup = groups.find(g => g.name === rule.name);
        if (!targetGroup) {
          targetGroup = {
            id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            name: rule.name,
            paths: []
          };
          groups.push(targetGroup);
        }
        break;
      }
    }
    if (targetGroup) {
      // 从其他分组移除，再归入目标分组
      for (const g of groups) {
        if (g !== targetGroup) g.paths = (g.paths || []).filter(p => p !== file.path);
      }
      if (!targetGroup.paths.includes(file.path)) {
        targetGroup.paths.push(file.path);
        categorized++;
      }
    }
  }
  saveGroups();
  renderGroups();
  renderFiles();
  showToast(categorized > 0 ? t('rule.applied', { n: categorized }) : t('rule.noMatch'));
}

// ============ 文件夹预览开关 ============
async function handleFolderPreviewToggle() {
  folderPreviewEnabled = folderPreviewToggle.checked;
  await window.api.setFolderPreviewEnabled(folderPreviewEnabled);
  updateFolderPreviewUI();
  if (!folderPreviewEnabled) {
    cancelPreview();
  }
}

function updateFolderPreviewUI() {
  if (folderPreviewToggle) folderPreviewToggle.checked = folderPreviewEnabled;
}

// ============ Everything 搜索 ============
function updateEverythingUI() {
  if (everythingToggle) everythingToggle.checked = everythingEnabled;
  // 搜索栏仅在开启且已安装时显示
  everythingBar.style.display = (everythingEnabled && everythingInstalled) ? 'flex' : 'none';
  // 状态显示
  if (everythingInstalled) {
    everythingStatus.textContent = t('settings.everythingReady');
    everythingStatus.className = 'status-enabled';
    everythingDownloadBtn.style.display = 'none';
  } else {
    everythingStatus.textContent = t('settings.everythingMissing');
    everythingStatus.className = 'status-disabled';
    everythingDownloadBtn.style.display = everythingEnabled ? 'inline-block' : 'none';
  }
  // 管理员模式警告
  if (everythingAdminWarn) {
    everythingAdminWarn.style.display = (everythingInstalled && everythingRunAsAdmin) ? 'block' : 'none';
  }
}

async function handleEverythingToggle() {
  const enabled = everythingToggle.checked;
  if (enabled) {
    // 开启前重新检测安装状态
    try {
      const result = await window.api.checkEverything();
      everythingInstalled = !!(result && result.installed);
      everythingRunAsAdmin = !!(result && result.runAsAdmin);
    } catch (e) {
      everythingInstalled = false;
      everythingRunAsAdmin = false;
    }
    if (!everythingInstalled) {
      showToast(t('settings.everythingMissing'));
      everythingEnabled = false;
      everythingToggle.checked = false;
      updateEverythingUI();
      return;
    }
    everythingEnabled = true;
    await window.api.setEverythingEnabled(true);
    updateEverythingUI();
    everythingInput.focus();
  } else {
    everythingEnabled = false;
    await window.api.setEverythingEnabled(false);
    updateEverythingUI();
  }
}

async function runEverythingSearch() {
  const keyword = everythingInput.value.trim();
  if (!keyword) {
    everythingInput.focus();
    return;
  }
  const result = await window.api.openEverythingSearch(keyword);
  if (result && !result.installed) {
    everythingInstalled = false;
    everythingEnabled = false;
    await window.api.setEverythingEnabled(false);
    updateEverythingUI();
    showToast(t('settings.everythingMissing'));
  }
}

// ============ 布局导出/导入 ============
async function handleExportLayout() {
  const result = await window.api.exportLayout({
    arrangeRules
  });
  if (result && result.success) showToast(t('layout.exportOk'));
}

async function handleImportLayout() {
  const importGroups = confirm(t('layout.importGroups'));
  const result = await window.api.importLayout(importGroups);
  if (!result || !result.success) return;
  if (importGroups && result.groups) {
    groups = result.groups;
  }
  if (result.manualOrder && Array.isArray(result.manualOrder)) manualOrder = result.manualOrder;
  if (result.sortBy) {
    sortBy = result.sortBy;
    updateSortUI();
  }
  renderGroups();
  renderFiles();
  showToast(t('layout.importOk'));
}

// ============ 快捷键录制 ============
function bindShortcutRecorder(input, key) {
  input.addEventListener('focus', () => {
    input.classList.add('recording');
    input.value = t('shortcut.recording');
  });
  input.addEventListener('blur', () => {
    input.classList.remove('recording');
    updateShortcutInputs();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      input.blur();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const combo = formatShortcut(e);
    if (!combo) return;
    input.value = combo;
    const next = { ...shortcuts, [key]: combo };
    window.api.setShortcuts(next).then((ok) => {
      if (ok) {
        shortcuts = next;
        showToast(t('shortcut.saved'));
      } else {
        showToast(t('shortcut.invalid'));
      }
    });
    input.blur();
  });
}

function formatShortcut(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta', 'Escape'].includes(key)) return null;
  let main = '';
  if (key.length === 1) main = key.toUpperCase();
  else if (key.startsWith('F') && key.length <= 3) main = key;
  else if (key === ' ') main = 'Space';
  else main = key;
  if (parts.length === 0) return null;
  parts.push(main);
  return parts.join('+');
}

function updateShortcutInputs() {
  if (!shortcuts) shortcuts = {};
  shortcutToggleInput.value = shortcuts.toggleWindow || 'CommandOrControl+Alt+D';
  shortcutRefreshInput.value = shortcuts.refresh || 'CommandOrControl+Alt+R';
}

// ============ Toast 提示 ============
let toastTimer = null;

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 2200);
}

// ============ 异步加载图标 ============
async function loadIconsAsync() {
  const iconElements = filesList.querySelectorAll('.file-icon[data-icon-path]');
  if (iconElements.length === 0) return;

  const fileObjects = [];
  const pathToElementMap = new Map();

  for (const el of iconElements) {
    const filePath = el.dataset.iconPath;
    if (!filePath) continue;

    const fileInfo = filesMap.get(filePath);
    fileObjects.push({
      path: filePath,
      isDirectory: fileInfo ? fileInfo.isDirectory : false
    });
    pathToElementMap.set(filePath, el);
  }

  if (fileObjects.length === 0) return;

  try {
    const iconResults = await window.api.getFileIcons(fileObjects);

    for (const [filePath, iconData] of Object.entries(iconResults)) {
      const el = pathToElementMap.get(filePath);
      if (!el) continue;

      if (iconData && typeof iconData === 'string' && iconData.startsWith('data:image')) {
        const img = document.createElement('img');
        img.src = iconData;
        img.alt = 'icon';
        el.innerHTML = '';
        el.appendChild(img);
        delete el.dataset.iconFailed;
      } else {
        el.dataset.iconFailed = 'true';
      }
    }
  } catch (error) {
    console.error('批量加载图标失败:', error);
  }
}
