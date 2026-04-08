// 状态
let isCollapsed = false;
let files = [];

let autoHideEnabled = false;
let autoHideEdge = 'none';
let isAutoHidden = false;
let contextMenuTimeout = null;
let sortBy = 'name-asc'; // 默认按名称升序排序
let theme = 'dark'; // 默认深色主题
let opacity = 92; // 默认透明度 92%
let iconSize = 40; // 默认图标大小 40px

// DOM 元素
let contentEl, toggleBtn, toggleIcon, refreshBtn, quitBtn, filesList;
let settingsBtn, settingsPanel, autoHideToggle, edgeSelect, sortSelect, themeSelect;
let opacitySlider, opacityValue;
let iconSizeSlider, iconSizeValue;

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
  
  // Ctrl + 滚轮调整图标大小
  document.addEventListener('wheel', handleWheelIconSize, { passive: false });
  
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
    
    renderFiles();
    updateCollapseState();
    updateAutoHideUI();
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
      // 文件发生变化，更新并重新渲染
      files = newFiles;
      sortFiles();
      renderFiles();
      console.log('文件发生变化，已重新渲染');
    } else {
      // 文件未变化，只更新引用，不重新渲染
      files = newFiles;
      console.log('文件未变化，跳过重新渲染');
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

// 渲染文件列表
function renderFiles() {
  if (!filesList) return;
  
  if (files.length === 0) {
    filesList.innerHTML = '<div class="empty">桌面为空</div>';
    return;
  }
  
  // 排序文件
  sortFiles();
  
  filesList.innerHTML = files.map((file) => `
    <div class="file-item" data-path="${escapeHtml(file.path)}" data-is-system="${file.isSystem || false}">
      <div class="file-icon" data-icon-path="${escapeHtml(file.path)}">${getFileEmoji(file)}</div>
      <div class="file-name">${escapeHtml(file.name)}</div>
    </div>
  `).join('');
  
  // 异步加载真实图标
  loadIconsAsync();
  
  // 双击打开文件
  filesList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const filePath = item.dataset.path;
      if (filePath) {
        window.api.openFile(filePath);
      }
    });
    
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      filesList.querySelectorAll('.file-item.selected').forEach(el => {
        el.classList.remove('selected');
      });
      item.classList.add('selected');
    });
    
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleFileContextMenu(e, item.dataset.path);
    });
  });
  
  filesList.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.file-item')) return;
    e.preventDefault();
    handleDesktopContextMenu(e);
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
    debouncedHandleRefresh(300);
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
    debouncedHandleRefresh(300);
  });

  contextMenuTimeout = setTimeout(() => {
    contextMenuTimeout = null;
  }, 500);
}

// 异步加载图标
async function loadIconsAsync() {
  console.log(`开始异步加载图标，共有 ${filesList.querySelectorAll('.file-icon[data-icon-path]').length} 个图标元素`);
  const iconElements = filesList.querySelectorAll('.file-icon[data-icon-path]');
  if (iconElements.length === 0) return;
  
  // 准备文件对象数组用于批量请求
  const fileObjects = [];
  const pathToElementMap = new Map();
  
  for (const el of iconElements) {
    const filePath = el.dataset.iconPath;
    if (!filePath) continue;
    
    // 在全局files数组中查找文件信息
    const fileInfo = files.find(f => f.path === filePath);
    if (fileInfo) {
      fileObjects.push({
        path: filePath,
        isDirectory: fileInfo.isDirectory
      });
    } else {
      // 如果找不到文件信息，假设是普通文件
      fileObjects.push({
        path: filePath,
        isDirectory: false
      });
    }
    pathToElementMap.set(filePath, el);
  }
  
  if (fileObjects.length === 0) return;
  
  try {
    // 批量获取所有图标
    const iconResults = await window.api.getFileIcons(fileObjects);
    
    let successCount = 0;
    let emojiCount = 0;
    
    // 更新DOM元素
    for (const [filePath, iconData] of Object.entries(iconResults)) {
      const el = pathToElementMap.get(filePath);
      if (!el) continue;
      
      if (iconData && typeof iconData === 'string' && iconData.startsWith('data:image')) {
        const img = document.createElement('img');
        img.src = iconData;
        img.alt = 'icon';
        el.innerHTML = '';
        el.appendChild(img);
        successCount++;
      } else {
        // 如果不是图片数据（如emoji），保持原有emoji图标
        if (iconData && !iconData.startsWith('data:image')) {
          console.log(`非图片图标数据: ${filePath} -> ${iconData.substring(0, 30)}...`);
        }
        emojiCount++;
      }
    }
    
    console.log(`图标加载完成: ${successCount} 个真实图标, ${emojiCount} 个emoji图标`);
  } catch (error) {
    console.error('批量加载图标失败:', error);
    // 失败时保持emoji图标
  }
}

// HTML 转义
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
