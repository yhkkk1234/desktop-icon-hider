const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WINDOW_CONFIG = {
  MIN_HEIGHT: 40,
  HEADER_HEIGHT: 40,
  DEFAULT_WIDTH: 800
};

const AUTO_HIDE_CONFIG = {
  EDGE_THRESHOLD: 5, // 边缘检测阈值（像素）
  HIDE_DELAY: 500, // 隐藏延迟（毫秒）
  SHOW_DELAY: 100, // 显示延迟（毫秒）
  ANIMATION_DURATION: 300, // 动画时长（毫秒）
  SNAP_THRESHOLD: 20 // 吸附检测阈值（像素）
};

const EDGE_TYPES = {
  TOP: 'top',
  BOTTOM: 'bottom',
  LEFT: 'left',
  RIGHT: 'right',
  NONE: 'none'
};

let autoHideState = {
  enabled: false,
  currentEdge: EDGE_TYPES.NONE,
  isHidden: false,
  isAnimating: false,
  showCancelled: false,
  hideTimer: null,
  showTimer: null,
  mouseMonitorInterval: null
};

// 获取窗口所在的显示器（多显示器环境下吸附/隐藏/显示都应以窗口所在显示器为基准）
function getDisplayForWindow(window) {
  if (window && !window.isDestroyed()) {
    try {
      const bounds = window.getBounds();
      if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
        return screen.getDisplayMatching(bounds);
      }
    } catch (e) { /* 窗口可能已销毁，忽略 */ }
  }
  return screen.getPrimaryDisplay();
}

function createMainWindow(store) {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    const savedBounds = store.get('windowBounds');
    const savedCollapsed = store.get('isCollapsed', false);
    const savedAutoHide = store.get('autoHideEnabled', false);
    const savedEdge = store.get('autoHideEdge', EDGE_TYPES.NONE);
    
    const windowConfig = {
      width: savedBounds ? savedBounds.width : WINDOW_CONFIG.DEFAULT_WIDTH,
      height: savedCollapsed ? WINDOW_CONFIG.HEADER_HEIGHT : height,
      x: savedBounds ? savedBounds.x : (width - WINDOW_CONFIG.DEFAULT_WIDTH) / 2,
      y: savedBounds ? savedBounds.y : 0,
      transparent: true,
      frame: false,
      alwaysOnTop: 'floating',
      skipTaskbar: true,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: false,
      closable: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        enableRemoteModule: false,
        webSecurity: true
      },
      show: false,
      backgroundColor: '#00000000'
    };
    
    const mainWindow = new BrowserWindow(windowConfig);
    
    mainWindow.isCollapsed = savedCollapsed;
    mainWindow.isDragging = false;
    mainWindow.dragOffset = { x: 0, y: 0 };
    mainWindow.autoHideState = { ...autoHideState };
    mainWindow.autoHideState.enabled = savedAutoHide;
    mainWindow.autoHideState.currentEdge = savedEdge;
    
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      
      if (savedCollapsed) {
        mainWindow.setBounds({
          x: windowConfig.x,
          y: windowConfig.y,
          width: windowConfig.width,
          height: WINDOW_CONFIG.HEADER_HEIGHT
        });
      }
      
      // 如果启用了自动隐藏，启动鼠标监听
      if (savedAutoHide) {
        // 如果设置了边缘，主动吸附到边缘
        if (savedEdge !== EDGE_TYPES.NONE) {
          mainWindow.autoHideState.currentEdge = savedEdge;
          snapToEdge(mainWindow, savedEdge);
        }
        
        startAutoHide(mainWindow);
      }
    });
    
    mainWindow.on('resize', () => {
      const bounds = mainWindow.getBounds();
      mainWindow.webContents.send('window-resized', {
        width: bounds.width,
        height: bounds.height,
        isCollapsed: mainWindow.isCollapsed
      });
      
      // 窗口大小变化时，取消隐藏定时器
      if (mainWindow.autoHideState && mainWindow.autoHideState.enabled) {
        cancelAllTimers(mainWindow);
      }
    });
    
    mainWindow.on('moved', () => {
      const bounds = mainWindow.getBounds();
      mainWindow.webContents.send('window-moved', {
        x: bounds.x,
        y: bounds.y
      });
      
      // 检测边缘吸附
      if (mainWindow.autoHideState.enabled) {
        detectEdgeSnap(mainWindow, store);
      }
    });
    
    mainWindow.on('blur', () => {
      // 当窗口失去焦点时，如果启用了自动隐藏且在边缘且窗口未折叠，则隐藏
      if (mainWindow.autoHideState && 
          mainWindow.autoHideState.enabled && 
          mainWindow.autoHideState.currentEdge !== EDGE_TYPES.NONE &&
          !mainWindow.autoHideState.isHidden &&
          !mainWindow.isCollapsed) {
        scheduleHide(mainWindow);
      }
    });
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Failed to load window:', errorCode, errorDescription);
    });
    
    return mainWindow;
    
  } catch (error) {
    console.error('Error creating main window:', error);
    return null;
  }
}

// 边缘自动隐藏功能

function snapToEdge(window, edge) {
  if (!window || edge === EDGE_TYPES.NONE) return;
  
  const bounds = window.getBounds();
  const display = getDisplayForWindow(window);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  
  switch (edge) {
  case EDGE_TYPES.TOP:
    window.setBounds(bounds.x, 0, bounds.width, bounds.height);
    break;
  case EDGE_TYPES.BOTTOM:
    window.setBounds(bounds.x, screenHeight - bounds.height, bounds.width, bounds.height);
    break;
  case EDGE_TYPES.LEFT:
    window.setBounds(0, bounds.y, bounds.width, bounds.height);
    break;
  case EDGE_TYPES.RIGHT:
    window.setBounds(screenWidth - bounds.width, bounds.y, bounds.width, bounds.height);
    break;
  }
  
  // 吸附后立即隐藏
  scheduleHide(window);
}

function detectEdgeSnap(window, store) {
  if (!window || !window.autoHideState.enabled) return;
  
  const bounds = window.getBounds();
  const display = getDisplayForWindow(window);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  
  let detectedEdge = EDGE_TYPES.NONE;
  
  // 检测边缘（优先级：上 > 下 > 左 > 右）
  if (bounds.y <= AUTO_HIDE_CONFIG.SNAP_THRESHOLD) {
    detectedEdge = EDGE_TYPES.TOP;
    window.setBounds(bounds.x, 0, bounds.width, bounds.height);
  } else if (bounds.y + bounds.height >= screenHeight - AUTO_HIDE_CONFIG.SNAP_THRESHOLD) {
    detectedEdge = EDGE_TYPES.BOTTOM;
    window.setBounds(bounds.x, screenHeight - bounds.height, bounds.width, bounds.height);
  } else if (bounds.x <= AUTO_HIDE_CONFIG.SNAP_THRESHOLD) {
    detectedEdge = EDGE_TYPES.LEFT;
    window.setBounds(0, bounds.y, bounds.width, bounds.height);
  } else if (bounds.x + bounds.width >= screenWidth - AUTO_HIDE_CONFIG.SNAP_THRESHOLD) {
    detectedEdge = EDGE_TYPES.RIGHT;
    window.setBounds(screenWidth - bounds.width, bounds.y, bounds.width, bounds.height);
  }

  if (detectedEdge !== window.autoHideState.currentEdge) {
    window.autoHideState.currentEdge = detectedEdge;
    store.set('autoHideEdge', detectedEdge);
    
    // 通知渲染进程
    window.webContents.send('edge-changed', { edge: detectedEdge });
    
    // 如果检测到边缘，开始自动隐藏
    if (detectedEdge !== EDGE_TYPES.NONE) {
      scheduleHide(window);
    } else {
      cancelHide(window);
    }
  } else {
    // 边缘没有改变，检查是否需要隐藏
    if (detectedEdge !== EDGE_TYPES.NONE && !window.autoHideState.isHidden) {
      // 窗口在边缘且未隐藏，主动触发隐藏
      scheduleHide(window);
    }
  }
}

function scheduleHide(window) {
  if (!window || !window.autoHideState.enabled) return;
  
  // 如果已经设置了隐藏定时器，不要重复设置
  if (window.autoHideState.hideTimer) {
    return;
  }
  
  // 设置隐藏定时器
  window.autoHideState.hideTimer = setTimeout(() => {
    window.autoHideState.hideTimer = null;
    hideWindow(window);
  }, AUTO_HIDE_CONFIG.HIDE_DELAY);
}

function cancelHide(window) {
  if (!window) return;
  
  if (window.autoHideState.hideTimer) {
    clearTimeout(window.autoHideState.hideTimer);
    window.autoHideState.hideTimer = null;
  }
}

function cancelAllTimers(window) {
  if (!window) return;
  
  if (window.autoHideState.hideTimer) {
    clearTimeout(window.autoHideState.hideTimer);
    window.autoHideState.hideTimer = null;
  }
  
  if (window.autoHideState.showTimer) {
    clearTimeout(window.autoHideState.showTimer);
    window.autoHideState.showTimer = null;
  }
}

function hideWindow(window) {
  if (!window || !window.autoHideState.enabled || window.autoHideState.isHidden) return;
  
  const bounds = window.getBounds();
  const display = getDisplayForWindow(window);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  
  let newBounds = { ...bounds };
  
  switch (window.autoHideState.currentEdge) {
  case EDGE_TYPES.TOP:
    newBounds.y = -bounds.height + 2; // 只露出2像素
    break;
  case EDGE_TYPES.BOTTOM:
    newBounds.y = screenHeight - 2; // 只露出2像素
    break;
  case EDGE_TYPES.LEFT:
    newBounds.x = -bounds.width + 2; // 只露出2像素
    break;
  case EDGE_TYPES.RIGHT:
    newBounds.x = screenWidth - 2; // 只露出2像素
    break;
  default:
    return;
  }
  
  // 使用动画效果移动窗口
  animateWindowMove(window, bounds, newBounds, AUTO_HIDE_CONFIG.ANIMATION_DURATION, () => {
    window.autoHideState.isHidden = true;
    // 通知渲染进程
    window.webContents.send('auto-hide-changed', { isHidden: true });
  });
}

// 恢复置顶（含"置顶能力解锁"）：窗口滑出屏幕（隐藏）后，Windows 会间歇性锁定该窗口
// 的置顶设置（实测 setAlwaysOnTop 与 SetWindowPos(HWND_TOPMOST) 均无效，窗口唤出后
// 停留在普通 Z 序、被打开的全屏应用盖住，表现成"无法呼出"）。
// 最小化→还原可解除锁定；窗口在屏幕外（隐藏/被盖）时执行无视觉影响。
function ensureAlwaysOnTop(window) {
  if (!window || window.isDestroyed()) return;
  try {
    window.setAlwaysOnTop(true, 'floating');
  } catch (e) { /* 忽略 */ }
  if (!window.isAlwaysOnTop()) {
    try {
      window.minimize();
      window.restore();
    } catch (e) { /* 忽略 */ }
    try {
      window.setAlwaysOnTop(true, 'floating');
    } catch (e) { /* 忽略 */ }
  }
}

function showWindow(window) {
  if (!window || !window.autoHideState.isHidden) return;
  
  // 此刻窗口尚在屏幕外，解锁+置顶全程不可见、无闪烁
  ensureAlwaysOnTop(window);
  
  const bounds = window.getBounds();
  const display = getDisplayForWindow(window);
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  
  let newBounds = { ...bounds };
  
  switch (window.autoHideState.currentEdge) {
  case EDGE_TYPES.TOP:
    newBounds.y = 0;
    break;
  case EDGE_TYPES.BOTTOM:
    newBounds.y = screenHeight - bounds.height;
    break;
  case EDGE_TYPES.LEFT:
    newBounds.x = 0;
    break;
  case EDGE_TYPES.RIGHT:
    newBounds.x = screenWidth - bounds.width;
    break;
  default:
    return;
  }
  
  // 使用动画效果移动窗口
  animateWindowMove(window, bounds, newBounds, AUTO_HIDE_CONFIG.ANIMATION_DURATION, () => {
    window.autoHideState.isHidden = false;
    // 鼠标移到隐藏线唤出 = 主动意图使用桌面：恢复置顶。
    // 注意：必须等窗口完全滑入屏幕后再设置，Windows 上对完全位于屏幕外的
    // 窗口 setAlwaysOnTop(true) 无效（实测 after=false），会导致唤出后仍被
    // 打开的应用（尤其全屏应用）盖住，表现成"无法呼出"。
    try {
      window.setAlwaysOnTop(true, 'floating');
    } catch (e) { /* 忽略 */ }
    try {
      window.moveTop();
    } catch (e) { /* 忽略 */ }
    // 前台锁定破解：应用长时间未接收用户输入时（如"软件启动后第一次"唤出），
    // setAlwaysOnTop/moveTop/focus 都会被 Windows 拒绝。滑入后窗口立即接收
    // 鼠标移动输入，短暂延迟再 focus() 即可获得前台权限，窗口浮到最前。
    setTimeout(() => {
      if (!window || window.isDestroyed()) return;
      try {
        window.focus();
      } catch (e) { /* 忽略 */ }
    }, 200);
    // 通知渲染进程
    window.webContents.send('auto-hide-changed', { isHidden: false });
  });
}

function animateWindowMove(window, startBounds, endBounds, duration, onComplete) {
  if (!window) return;
  
  // 确保所有边界值都是有效数字
  const start = {
    x: Number(startBounds.x) || 0,
    y: Number(startBounds.y) || 0,
    width: Number(startBounds.width) || 100,
    height: Number(startBounds.height) || 100
  };
  
  const end = {
    x: Number(endBounds.x) || 0,
    y: Number(endBounds.y) || 0,
    width: Number(endBounds.width) || 100,
    height: Number(endBounds.height) || 100
  };
  
  // 如果没有变化，直接设置最终位置
  if (start.x === end.x && start.y === end.y && 
      start.width === end.width && start.height === end.height) {
    window.setBounds(end);
    if (onComplete) onComplete();
    return;
  }
  
  const animDuration = Number(duration) || 300;
  
  // 设置动画状态
  window.autoHideState.isAnimating = true;
  
  const startTime = Date.now();
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const deltaWidth = end.width - start.width;
  const deltaHeight = end.height - start.height;
  const frameInterval = 33; // ~30fps, reduces setBounds calls by half
  
  function animate() {
    try {
      if (!window || window.isDestroyed()) {
        return;
      }
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / animDuration, 1);
      
      // 使用缓动函数
      const eased = easeOutCubic(progress);
      
      const newX = Math.round(start.x + deltaX * eased);
      const newY = Math.round(start.y + deltaY * eased);
      const newWidth = Math.round(start.width + deltaWidth * eased);
      const newHeight = Math.round(start.height + deltaHeight * eased);
      
      // 确保值有效
      if (isNaN(newX) || isNaN(newY) || isNaN(newWidth) || isNaN(newHeight)) {
        window.setBounds(end);
        window.autoHideState.isAnimating = false;
        if (onComplete) onComplete();
        return;
      }
      
      window.setBounds({
        x: newX,
        y: newY,
        width: Math.max(newWidth, 1),
        height: Math.max(newHeight, 1)
      });
      
      if (progress < 1) {
        setTimeout(animate, frameInterval);
      } else {
        // 动画结束
        window.autoHideState.isAnimating = false;
        if (onComplete) onComplete();
      }
    } catch (error) {
      if (window && !window.isDestroyed()) {
        window.autoHideState.isAnimating = false;
        // 出错时直接设置最终位置
        try {
          window.setBounds(end);
        } catch (e) {
          // 忽略
        }
      }
      if (onComplete) onComplete();
    }
  }
  
  animate();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function startAutoHide(window) {
  if (!window) return;
  
  // 停止现有的监听
  stopAutoHide(window);
  
  // 启动鼠标位置监听
  window.autoHideState.mouseMonitorInterval = setInterval(() => {
    checkMousePosition(window);
  }, 50); // 每50ms检查一次鼠标位置
}

function stopAutoHide(window) {
  if (!window || !window.autoHideState) return;
  
  if (window.autoHideState.mouseMonitorInterval) {
    clearInterval(window.autoHideState.mouseMonitorInterval);
    window.autoHideState.mouseMonitorInterval = null;
  }
  
  if (window.autoHideState.hideTimer) {
    clearTimeout(window.autoHideState.hideTimer);
    window.autoHideState.hideTimer = null;
  }
  
  if (window.autoHideState.showTimer) {
    clearTimeout(window.autoHideState.showTimer);
    window.autoHideState.showTimer = null;
  }
}

function checkMousePosition(window) {
  if (!window || window.isDestroyed() || !window.autoHideState.enabled) return;
  
  // 如果正在动画中，跳过检查
  if (window.autoHideState.isAnimating) {
    return;
  }
  
  try {
    const cursorPos = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const display = getDisplayForWindow(window);
    const { width: screenWidth, height: screenHeight } = display.workAreaSize;
    
    // 计算窗口正常显示时的位置
    let windowDisplayBounds = { ...bounds };
    
    switch (window.autoHideState.currentEdge) {
    case EDGE_TYPES.TOP:
      windowDisplayBounds.y = 0;
      break;
    case EDGE_TYPES.BOTTOM:
      windowDisplayBounds.y = screenHeight - bounds.height;
      break;
    case EDGE_TYPES.LEFT:
      windowDisplayBounds.x = 0;
      break;
    case EDGE_TYPES.RIGHT:
      windowDisplayBounds.x = screenWidth - bounds.width;
      break;
    default:
      windowDisplayBounds = bounds;
    }
    
    // 判断鼠标是否在窗口显示位置的边缘区域
    let isInEdgeZone = false;
    switch (window.autoHideState.currentEdge) {
    case EDGE_TYPES.TOP:
      isInEdgeZone = cursorPos.y >= windowDisplayBounds.y && 
                     cursorPos.y <= windowDisplayBounds.y + AUTO_HIDE_CONFIG.EDGE_THRESHOLD &&
                     cursorPos.x >= windowDisplayBounds.x && 
                     cursorPos.x <= windowDisplayBounds.x + windowDisplayBounds.width;
      break;
    case EDGE_TYPES.BOTTOM:
      isInEdgeZone = cursorPos.y >= windowDisplayBounds.y + windowDisplayBounds.height - AUTO_HIDE_CONFIG.EDGE_THRESHOLD && 
                     cursorPos.y <= windowDisplayBounds.y + windowDisplayBounds.height &&
                     cursorPos.x >= windowDisplayBounds.x && 
                     cursorPos.x <= windowDisplayBounds.x + windowDisplayBounds.width;
      break;
    case EDGE_TYPES.LEFT:
      isInEdgeZone = cursorPos.x >= windowDisplayBounds.x && 
                     cursorPos.x <= windowDisplayBounds.x + AUTO_HIDE_CONFIG.EDGE_THRESHOLD &&
                     cursorPos.y >= windowDisplayBounds.y && 
                     cursorPos.y <= windowDisplayBounds.y + windowDisplayBounds.height;
      break;
    case EDGE_TYPES.RIGHT:
      isInEdgeZone = cursorPos.x >= windowDisplayBounds.x + windowDisplayBounds.width - AUTO_HIDE_CONFIG.EDGE_THRESHOLD && 
                     cursorPos.x <= windowDisplayBounds.x + windowDisplayBounds.width &&
                     cursorPos.y >= windowDisplayBounds.y && 
                     cursorPos.y <= windowDisplayBounds.y + windowDisplayBounds.height;
      break;
    }
    
    // 鼠标移入边缘区域 = 主动意图使用桌面：无论窗口是否隐藏都恢复置顶
    // （窗口未隐藏但处于"打开应用让位"的不置顶状态时同样生效，全屏应用也能被唤出）
    // 仅当鼠标位置发生变化时判定，避免"打开应用时鼠标恰好停在边缘"导致刚让位就被恢复
    // 注：窗口滑出（屏幕外）时 setAlwaysOnTop 无效，此处仅覆盖屏幕内场景；
    //     屏幕外唤出场景由 showWindow 滑入完成后置顶兜底
    if (isInEdgeZone && !window.isAlwaysOnTop()) {
      const lastPos = window.autoHideState.lastCursorPos;
      const moved = !lastPos || lastPos.x !== cursorPos.x || lastPos.y !== cursorPos.y;
      if (moved) {
        // 含"置顶能力解锁"（窗口被全屏应用盖住时移入边缘同样需要解锁后置顶才能浮出）
        ensureAlwaysOnTop(window);
        try {
          window.moveTop();
        } catch (e) { /* 忽略 */ }
      }
    }
    window.autoHideState.lastCursorPos = { x: cursorPos.x, y: cursorPos.y };
    
    if (window.autoHideState.isHidden) {
      // 窗口处于隐藏状态
      // 只有鼠标在窗口显示位置的边缘区域时才显示窗口
      if (isInEdgeZone) {
        // 鼠标在边缘区域，设置显示定时器
        if (!window.autoHideState.showTimer) {
          window.autoHideState.showTimer = setTimeout(() => {
            window.autoHideState.showTimer = null;
            showWindow(window);
          }, AUTO_HIDE_CONFIG.SHOW_DELAY);
        }
      } else {
        // 鼠标不在边缘区域，取消显示定时器
        if (window.autoHideState.showTimer) {
          clearTimeout(window.autoHideState.showTimer);
          window.autoHideState.showTimer = null;
        }
      }
    } else {
      // 窗口处于显示状态
      // 检查鼠标是否在窗口完整显示区域内
      const isInWindow = cursorPos.x >= windowDisplayBounds.x && 
                         cursorPos.x <= windowDisplayBounds.x + windowDisplayBounds.width &&
                         cursorPos.y >= windowDisplayBounds.y && 
                         cursorPos.y <= windowDisplayBounds.y + windowDisplayBounds.height;
      
      if (isInWindow) {
        // 鼠标在窗口内，取消隐藏
        cancelAllTimers(window);
      } else if (window.autoHideState.currentEdge !== EDGE_TYPES.NONE) {
        // 鼠标不在窗口内，安排隐藏
        scheduleHide(window);
      } else {
        // 窗口不在边缘，取消所有定时器
        cancelAllTimers(window);
      }
    }
  } catch (error) {
    // 窗口可能已被销毁，静默处理
  }
}

function setAutoHideEnabled(window, enabled, store) {
  if (!window) return false;
  
  try {
    window.autoHideState.enabled = enabled;
    store.set('autoHideEnabled', enabled);
    
    if (enabled) {
      // 启用自动隐藏
      startAutoHide(window);
      // 已配置边缘时主动吸附，避免隐藏时窗口从当前位置直接飞出屏幕
      if (window.autoHideState.currentEdge !== EDGE_TYPES.NONE) {
        snapToEdge(window, window.autoHideState.currentEdge);
      }
      window.webContents.send('auto-hide-status', { enabled: true });
    } else {
      // 禁用自动隐藏
      stopAutoHide(window);
      window.autoHideState.currentEdge = EDGE_TYPES.NONE;
      store.set('autoHideEdge', EDGE_TYPES.NONE);
      
      // 如果窗口是隐藏状态，显示它
      if (window.autoHideState.isHidden) {
        showWindow(window);
      }
      
      window.webContents.send('auto-hide-status', { enabled: false });
    }
    
    return true;
  } catch (error) {
    console.error('Error setting auto-hide enabled:', error);
    return false;
  }
}

function getAutoHideStatus(window) {
  if (!window) return { enabled: false, edge: EDGE_TYPES.NONE, isHidden: false };
  
  return {
    enabled: window.autoHideState.enabled,
    edge: window.autoHideState.currentEdge,
    isHidden: window.autoHideState.isHidden
  };
}

module.exports = {
  createMainWindow,
  setAutoHideEnabled,
  getAutoHideStatus,
  WINDOW_CONFIG,
  AUTO_HIDE_CONFIG,
  EDGE_TYPES
};

