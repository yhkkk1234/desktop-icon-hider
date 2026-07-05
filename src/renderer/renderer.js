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

// DOM 元素
let contentEl, toggleBtn, toggleIcon, refreshBtn, quitBtn, filesList;
let settingsBtn, settingsPanel, autoHideToggle, edgeSelect, sortSelect, themeSelect;
let opacitySlider, opacityValue;
let iconSizeSlider, iconSizeValue;
let autoLaunchToggle;
let searchBar, searchInput, searchClear, searchCount;
let groupsList, addGroupBtn, autoGroupBtn;

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

  // 搜索栏事件
  searchInput.addEventListener('input', handleSearchInput);
  searchClear.addEventListener('click', clearSearch);

  // 分组栏事件
  addGroupBtn.addEventListener('click', handleAddGroup);
  autoGroupBtn.addEventListener('click', handleAutoGroup);
  
  // Ctrl + 滚轮调整图标大小
  document.addEventListener('wheel', handleWheelIconSize, { passive: false });
  
  document.addEventListener('keydown', handleKeyDown);
  
  // 内容区域空白处右键弹出桌面菜单
  contentEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.file-item')) return;
    e.preventDefault();
    handleDesktopContextMenu(e);
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

    renderGroups();
    renderFiles();
    updateCollapseState();
    updateAutoHideUI();
    updateAutoLaunchUI();
    updateSortUI();
    applyTheme(theme);
    applyOpacity(opacity);
    applyIconSize(iconSize);
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
let refreshTimeout = null;
let isRefreshing = false;
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
        'none': '未设置',
        'top': '顶部',
        'bottom': '底部',
        'left': '左侧',
        'right': '右侧'
      };
      statusText.textContent = `已启用 (${edgeNames[autoHideEdge] || '未设置'})`;
      statusText.className = 'status-enabled';
    } else {
      statusText.textContent = '未启用';
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
      statusIndicator.title = '窗口已隐藏';
    } else {
      statusIndicator.className = 'indicator visible';
      statusIndicator.title = '窗口可见';
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

function handleFilesListClick(e) {
  const item = e.target.closest('.file-item');
  if (!item) return;
  e.stopPropagation();
  filesList.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
  item.classList.add('selected');
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
    handleFileContextMenu(e, item.dataset.path);
  } else {
    e.preventDefault();
    handleDesktopContextMenu(e);
  }
}

function getSelectedFilePath() {
  const selected = filesList ? filesList.querySelector('.file-item.selected') : null;
  return selected ? selected.dataset.path : null;
}

function handleKeyDown(e) {
  // Ctrl+F 切换搜索栏
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    toggleSearchBar();
    return;
  }

  // 搜索栏可见时 ESC 关闭
  if (e.key === 'Escape' && searchVisible) {
    e.preventDefault();
    clearSearch();
    hideSearchBar();
    return;
  }

  if (e.key === 'F5') {
    e.preventDefault();
    debouncedHandleRefresh(0);
    return;
  }

  const selectedPath = getSelectedFilePath();
  if (!selectedPath) return;

  if (e.key === 'F2') {
    e.preventDefault();
    startRename(selectedPath);
  } else if (e.key === 'Delete') {
    e.preventDefault();
    deleteFile(selectedPath, e.shiftKey);
  }
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

async function deleteFile(filePath, permanent) {
  const file = filesMap.get(filePath);
  if (!file) return;

  const result = await window.api.deleteFile(filePath, permanent);
  if (result.success) {
    debouncedHandleRefresh(500);
  } else {
    const action = permanent ? '永久删除' : '删除';
    alert(`${action}失败：${result.error || '未知错误'}`);
  }
}

let filesMap = new Map();
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
    filesList.innerHTML = '<div class="empty">桌面为空</div>';
    return;
  }

  sortFiles();
  rebuildFilesMap();

  // 应用搜索过滤
  const visibleFiles = getFilteredFiles();

  if (visibleFiles.length === 0 && searchQuery) {
    filesList.innerHTML = `<div class="empty">未找到匹配 "${escapeHtml(searchQuery)}" 的文件</div>`;
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
      // 更新拖拽属性
      updateDraggable(existing, file);
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
  // 手动排序模式下可拖拽排序；存在分组时可拖到分组
  const canDrag = !file.isSystem && (sortBy === 'manual' || groups.length > 0);
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
  allTab.innerHTML = '<span class="group-name">全部</span>';
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
      if (!draggedItem) return;
      e.preventDefault();
      tab.classList.add('drop-target');
    });
    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drop-target');
    });
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drop-target');
      if (!draggedItem) return;
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
  
  window.api.cancelDesktopContextMenu();
  window.api.showFileContextMenu(filePath, screenX, screenY).then(() => {
    if (item) item.classList.remove('context-menu-active');
    debouncedHandleRefresh(500);
  });

  contextMenuTimeout = setTimeout(() => {
    contextMenuTimeout = null;
  }, 500);
}

async function handleDesktopContextMenu(e) {
  if (contextMenuTimeout) {
    clearTimeout(contextMenuTimeout);
    contextMenuTimeout = null;
  }
  
  const screenX = e.screenX;
  const screenY = e.screenY;
  
  window.api.cancelDesktopContextMenu();
  window.api.showDesktopContextMenu(screenX, screenY).then(() => {
    debouncedHandleRefresh(500);
  });

  contextMenuTimeout = setTimeout(() => {
    contextMenuTimeout = null;
  }, 500);
}

// 异步加载图标
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
