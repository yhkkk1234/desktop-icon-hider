# Desktop Icon Hider — 从零到一完整学习文档

> 一份面向新手的深度剖析文档，涵盖技术选型、架构设计、核心原理、代码详解与实战演示。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈全景](#2-技术栈全景)
3. [项目目录结构](#3-项目目录结构)
4. [核心概念入门](#4-核心概念入门)
5. [架构设计详解](#5-架构设计详解)
6. [逐文件深度剖析](#6-逐文件深度剖析)
7. [关键技术点教学](#7-关键技术点教学)
8. [从零搭建指南](#8-从零搭建指南)
9. [常见问题与调试](#9-常见问题与调试)

---

## 1. 项目概述

### 1.1 这是什么？

**Desktop Icon Hider** 是一个 Windows 桌面图标管理工具。它最核心的价值不是"给图标分组"
（那是 Fences 的重心），而是**把桌面变成一块贴在屏幕边缘、可随时唤出又自动躲开的面板** ——
鼠标划到边缘就能看到桌面内容，移开就自动收起，不打断你正在用的软件。它的主要能力：

- **边缘自动隐藏**：窗口吸附到屏幕边缘后，鼠标靠近（边缘 5px 内）自动滑出、移开 500ms 后缩回；
  前台是全屏应用时主动让位，不打扰全屏使用
- **隐藏/显示桌面图标**：通过 Windows API 隐藏桌面图标区域，用一个自定义窗口接管展示
- **虚拟分区展示**：在透明窗口中重新渲染桌面文件列表，支持双击打开、右键菜单
- **窗口折叠**：可收缩为仅 40px 高的标题栏
- **系统托盘**：最小化到托盘，支持右键菜单控制
- **主题/透明度/图标大小/排序**：丰富的 UI 自定义选项
- **真实文件图标提取**：通过 C++ 原生模块调用 Windows Shell API 提取文件图标

### 1.2 解决了什么问题？

Windows 原生桌面图标管理功能有限。这个工具让用户可以：
- 临时清空桌面（演示/录屏/专注）
- 用一个美观的浮动面板管理桌面文件
- 窗口自动贴边隐藏，不占用桌面空间

---

## 2. 技术栈全景

### 2.1 核心技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Electron** | ^27.0.0 | 跨平台桌面应用框架，核心引擎 |
| **Node.js** | 内置 | 后端逻辑、文件系统操作、子进程管理 |
| **JavaScript (ES6+)** | - | 主要编程语言 |
| **HTML/CSS** | - | 前端界面 |
| **C++ (node-addon-api)** | ^8.7.0 | 原生模块，提取文件图标 |
| **C#** | 运行时编译 | 动态编译右键菜单服务 |
| **PowerShell** | 内置 | 执行 Windows API 调用 |
| **node-gyp** | ^12.2.0 | C++ 原生模块编译工具 |
| **electron-builder** | ^24.6.4 | 打包分发（NSIS 安装包 + 便携版） |

### 2.2 依赖库

| 库 | 用途 |
|---|------|
| `electron-store` | 持久化存储用户配置（窗口位置、主题、排序等） |
| `better-sqlite3` | 只读第三方 agent 会话库（opencode / ZCode） |
| `sharp` | 图像处理（构建时图标处理） |
| `eslint` | 代码质量检查 |
| `jest` | 单元测试框架 |

### 2.3 Windows API 使用清单

| API | 调用方式 | 用途 |
|-----|---------|------|
| `FindWindow("Progman")` | PowerShell | 找到桌面窗口句柄 |
| `FindWindowEx(..., "SHELLDLL_DefView")` | PowerShell | 找到图标容器窗口 |
| `ShowWindow(hWnd, SW_HIDE/SW_SHOW)` | PowerShell | 隐藏/显示桌面图标 |
| `SHGetFileInfoW` | C++ 原生模块 | 获取文件图标 |
| `SHGetDesktopFolder` | C# 动态编译 | 获取桌面 Shell 文件夹对象 |
| `IShellFolder.GetUIObjectOf` | C# 动态编译 | 获取文件右键菜单 |
| `TrackPopupMenuEx` | C# 动态编译 | 显示上下文菜单 |

---

## 3. 项目目录结构

```
desktop-icon-hider/
├── package.json              # 项目配置、依赖、构建脚本
├── electron-builder.yml      # electron-builder 打包配置
├── binding.gyp               # node-gyp 编译 C++ 模块的配置
├── jest.config.js            # Jest 测试配置
├── .eslintrc.json            # ESLint 代码规范配置
│
├── src/
│   ├── main/                 # Electron 主进程（Node.js 环境）
│   │   ├── index.js          # 入口文件，应用生命周期、IPC 注册
│   │   ├── window-manager.js # 窗口创建、折叠、边缘自动隐藏
│   │   ├── desktop-api.js    # 文件图标提取、缓存管理
│   │   ├── tray.js           # 系统托盘图标和菜单
│   │   ├── shell-context-menu.js  # 右键菜单（内嵌 C# 源码，动态编译）
│   │   └── temp-show.ps1     # 临时 PowerShell 脚本
│   │
│   ├── preload/              # 预加载脚本（安全桥接层）
│   │   └── preload.js        # contextBridge 暴露安全 API 给渲染进程
│   │
│   ├── renderer/             # 渲染进程（浏览器环境）
│   │   ├── index.html        # 页面结构
│   │   ├── renderer.js       # 前端交互逻辑
│   │   └── styles.css        # 样式（CSS 变量主题系统）
│   │
│   ├── native/               # C++ 原生模块
│   │   └── icon_extractor.cc # 文件图标提取（GDI+ → PNG → Base64）
│   │
│   └── utils/                # 工具函数
│       ├── config.js         # electron-store 配置封装
│       ├── logger.js         # 日志系统
│       ├── error-handler.js  # 错误处理类
│       └── icon-helper.js    # Emoji 图标映射、文件大小格式化
│
├── assets/                   # 静态资源（托盘图标等）
├── build/                    # 构建辅助脚本
├── __tests__/                # 测试文件
└── dist/                     # 构建输出目录
```

---

## 4. 核心概念入门

### 4.1 Electron 架构

Electron 将 Chromium（浏览器引擎）和 Node.js 结合，让你用 Web 技术构建桌面应用。它有三个核心进程：

```
┌─────────────────────────────────────────────────┐
│                   Electron App                   │
│                                                  │
│  ┌─────────────┐    IPC     ┌──────────────────┐ │
│  │ Main Process│◄──────────►│ Renderer Process │ │
│  │  (Node.js)  │            │   (Chromium)     │ │
│  │             │            │                  │ │
│  │ - 应用生命周期│            │ - HTML/CSS/JS    │ │
│  │ - 窗口管理   │            │ - 用户界面       │ │
│  │ - 文件系统   │            │ - DOM 操作       │ │
│  │ - 系统 API   │            │                  │ │
│  └──────┬──────┘            └──────────────────┘ │
│         │                                        │
│  ┌──────▼──────┐                                 │
│  │ Preload     │                                 │
│  │ Script      │                                 │
│  │ (安全桥接)   │                                 │
│  └─────────────┘                                 │
└─────────────────────────────────────────────────┘
```

**关键概念：**

- **主进程 (Main Process)**：应用的大脑，只有一个。管理窗口、系统托盘、文件系统、原生 API
- **渲染进程 (Renderer Process)**：应用的皮肤，每个窗口一个。负责 UI 渲染和用户交互
- **预加载脚本 (Preload Script)**：桥梁，在主进程和渲染进程之间安全地传递数据
- **IPC (Inter-Process Communication)**：进程间通信机制，主进程和渲染进程通过它交换数据

### 4.2 安全模型：contextIsolation + preload

```javascript
// ❌ 危险做法：nodeIntegration: true（渲染进程可以直接访问 Node.js）
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false
}

// ✅ 安全做法：contextIsolation: true + preload 桥接
webPreferences: {
  preload: path.join(__dirname, '../preload/preload.js'),
  contextIsolation: true,    // 隔离上下文，渲染进程无法直接访问 Node.js
  nodeIntegration: false     // 禁用 Node.js 集成
}
```

preload 脚本使用 `contextBridge.exposeInMainWorld` 暴露一个安全的 `window.api` 对象给渲染进程：

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 渲染进程调用 window.api.getFiles() → 实际触发 ipcRenderer.invoke('get-files')
  getFiles: () => ipcRenderer.invoke('get-files'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  // 监听主进程发来的事件
  onInitData: (callback) => ipcRenderer.on('init-data', (event, data) => callback(data))
});
```

### 4.3 IPC 通信模式

Electron 提供两种 IPC 模式：

```javascript
// 模式一：invoke/handle（请求-响应，异步）
// 渲染进程发送请求，等待主进程返回结果
const result = await ipcRenderer.invoke('get-files');

// 主进程处理并返回
ipcMain.handle('get-files', async () => {
  return await getDesktopFiles();
});

// 模式二：send/on（单向消息 + 事件监听）
// 主进程主动推送数据给渲染进程
mainWindow.webContents.send('init-data', { files: [...], theme: 'dark' });

// 渲染进程监听
ipcRenderer.on('init-data', (event, data) => {
  console.log('收到初始化数据:', data);
});
```

### 4.4 原生模块 (Native Addons)

Node.js 可以通过 `node-addon-api`（N-API）调用 C/C++ 代码。这对于需要高性能或直接调用系统 API 的场景非常有用。

```
JavaScript 调用 → N-API 桥接层 → C++ 代码 → Windows API → 返回结果
```

**编译流程：**
```bash
# 1. 安装编译工具（Visual Studio Build Tools）
npm install --global windows-build-tools

# 2. 编译原生模块
node-gyp rebuild

# 3. 输出文件：build/Release/icon_extractor.node
```

---

## 5. 架构设计详解

### 5.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        Windows Desktop                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              桌面图标 (SHELLDLL_DefView)                     │  │
│  │              [被隐藏，不显示]                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │           Desktop Icon Hider 窗口 (透明 + 置顶)              │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  Header: ▼ 桌面图标        ⚙️ 🔄 ×                    │  │  │
│  │  ├──────────────────────────────────────────────────────┤  │  │
│  │  │  Settings Panel (可折叠)                              │  │  │
│  │  │  - 主题 / 透明度 / 图标大小 / 排序 / 自动隐藏          │  │  │
│  │  ├──────────────────────────────────────────────────────┤  │  │
│  │  │  Content Area                                         │  │  │
│  │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                   │  │  │
│  │  │  │ 🖥️  │ │ 📁  │ │ 📄  │ │ 🗑️  │  ...              │  │  │
│  │  │  │此电脑│ │文档  │ │笔记  │ │回收站│                   │  │  │
│  │  │  └─────┘ └─────┘ └─────┘ └─────┘                   │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  System Tray: [🖼️] Desktop Icon Hider                           │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 数据流

```
启动流程：
  app.whenReady()
    → hideDesktopIcons()          // PowerShell 调用 Windows API 隐藏桌面图标
    → createWindow()              // 创建透明、置顶、无边框窗口
    → createTray()                // 创建系统托盘
    → getDesktopFiles()           // 扫描用户桌面 + 公共桌面 + 系统图标
    → mainWindow.webContents.send('init-data', data)  // 发送数据到渲染进程

渲染流程：
  渲染进程收到 init-data
    → renderFiles()               // 渲染文件列表（先用 Emoji 占位）
    → loadIconsAsync()            // 异步批量请求真实图标
    → window.api.getFileIcons()   // 通过 IPC 调用主进程
    → 主进程调用 C++ icon_extractor → 返回 Base64 PNG 数据
    → 渲染进程替换 Emoji 为真实图标

交互流程：
  用户双击文件
    → window.api.openFile(filePath)
    → ipcMain.handle('open-file')
    → shell.openPath(filePath)    // 用系统默认程序打开

  用户右键文件
    → window.api.showFileContextMenu()
    → 主进程动态编译 C# exe → 执行 → 显示系统原生右键菜单
    → 菜单操作完成后 → 刷新文件列表
```

### 5.3 窗口状态机

```
                    ┌─────────────┐
                    │   初始状态    │
                    └──────┬──────┘
                           │
                    ▼
              ┌──────────────────┐
              │  展开 (Expanded)  │◄──────────────────────┐
              │  height = 屏幕高度 │                       │
              └──┬───────────┬───┘                       │
                 │           │                           │
            点击 ▼│           │鼠标进入边缘区域             │
                 │           │                           │
              ┌──▼──┐    ┌───▼────────┐            ┌─────▼──────┐
              │折叠  │    │ 自动隐藏     │            │ 自动显示    │
              │40px │    │移出屏幕外     │            │滑入屏幕内   │
              └─────┘    └────────────┘            └────────────┘
```

---

## 6. 逐文件深度剖析

### 6.1 入口文件：`src/main/index.js`

这是整个应用的启动入口，负责：

#### 6.1.1 核心功能：隐藏/显示桌面图标

```javascript
// 隐藏桌面图标 — 通过 PowerShell 执行 C# 代码调用 Windows API
function hideDesktopIcons() {
  const psScript = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopHelper {
    // 查找桌面窗口类 "Progman"
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    // 在 Progman 的子窗口中查找 "SHELLDLL_DefView"（图标容器）
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, 
                                              string className, string windowTitle);
    
    // 控制窗口显示/隐藏
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    public static void Hide() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (shellView != IntPtr.Zero) {
            ShowWindow(shellView, 0);  // 0 = SW_HIDE
        }
    }
}
"@
[DesktopHelper]::Hide()`;
  
  // 写入临时文件并执行
  const tempFile = path.join(os.tmpdir(), 'temp-hide.ps1');
  fs.writeFileSync(tempFile, psScript, 'utf8');
  execSync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`, { 
    timeout: 10000, encoding: 'utf8' 
  });
  fs.unlinkSync(tempFile);  // 清理临时文件
}
```

**原理解析：**
1. Windows 桌面图标实际上是一个特殊的窗口，类名为 `SHELLDLL_DefView`
2. 它是 `Progman`（Program Manager）窗口的子窗口
3. 调用 `ShowWindow(hWnd, 0)` 隐藏它，调用 `ShowWindow(hWnd, 5)` 显示它
4. 通过 PowerShell 内嵌 C# 代码（`Add-Type`）来调用 Windows API

#### 6.1.2 获取桌面文件列表

```javascript
async function getDesktopFiles() {
  const items = [];
  const seenPaths = new Set();  // 去重集合
  
  // 1. 扫描用户桌面（C:\Users\用户名\Desktop）
  const userDesktopPath = getDesktopPath();
  const files = await fs.promises.readdir(userDesktopPath);
  const userItems = await processFilesWithConcurrency(files, userDesktopPath, seenPaths, 10);
  
  // 2. 扫描公共桌面（C:\Users\Public\Desktop）
  const publicDesktopPath = getPublicDesktopPath();
  const publicItems = await processFilesWithConcurrency(files, publicDesktopPath, seenPaths, 10);
  
  // 3. 获取系统图标（此电脑、回收站、网络等 CLSID 虚拟图标）
  const systemIcons = getSystemIcons();
  
  return items;  // 合并所有结果
}
```

**并发处理优化：**
```javascript
// 使用 Worker 模式并发处理文件，限制最多 10 个并发
async function processFilesWithConcurrency(files, basePath, seenPaths, limit) {
  const results = [];
  let index = 0;
  
  async function worker() {
    while (index < files.length) {
      const file = files[index++];  // 原子递增，避免重复处理
      const filePath = path.join(basePath, file);
      const stats = await fs.promises.stat(filePath);
      results.push({ name: file, path: filePath, isDirectory: stats.isDirectory(), ... });
    }
  }
  
  // 创建 limit 个 worker 并发执行
  const workers = Array.from({ length: Math.min(limit, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

#### 6.1.3 IPC 处理器注册

```javascript
// 每个 ipcMain.handle 对应渲染进程的一个 window.api.xxx 调用
ipcMain.handle('get-files', async () => {
  return await getDesktopFiles();
});

ipcMain.handle('open-file', (event, filePath) => {
  shell.openPath(filePath);  // 用系统默认程序打开文件
});

ipcMain.handle('toggle-collapse', async (event, collapse) => {
  const bounds = mainWindow.getBounds();
  if (collapse) {
    // 折叠：高度变为 40px（仅标题栏）
    mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: 40 });
  } else {
    // 展开：恢复之前的高度
    const savedHeight = store.get('windowBounds', { height: 600 }).height;
    mainWindow.setBounds({ ...bounds, height: Math.max(savedHeight, 200) });
  }
  return true;
});
```

#### 6.1.4 应用生命周期管理

```javascript
app.whenReady().then(() => {
  // 修复透明窗口的 GPU 问题
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  
  hideDesktopIcons();        // 先隐藏桌面图标
  createWindow();            // 再创建应用窗口
  tray = createTray();       // 创建系统托盘
});

app.on('before-quit', () => {
  showDesktopIcons();  // 退出前必须恢复桌面图标！
  destroyTray();
});

app.on('window-all-closed', () => {
  // 不退出应用！因为还有系统托盘在运行
});
```

### 6.2 窗口管理：`src/main/window-manager.js`

#### 6.2.1 窗口配置

```javascript
const WINDOW_CONFIG = {
  MIN_HEIGHT: 40,        // 最小高度（折叠后仅标题栏）
  HEADER_HEIGHT: 40,     // 标题栏高度
  DEFAULT_WIDTH: 800     // 默认宽度
};

const AUTO_HIDE_CONFIG = {
  EDGE_THRESHOLD: 5,     // 边缘检测阈值（像素）— 鼠标离边缘多远触发显示
  HIDE_DELAY: 500,       // 隐藏延迟（毫秒）— 鼠标离开后多久隐藏
  SHOW_DELAY: 100,       // 显示延迟（毫秒）— 鼠标靠近后多久显示
  ANIMATION_DURATION: 300, // 动画时长（毫秒）
  SNAP_THRESHOLD: 20     // 吸附检测阈值（像素）— 窗口离边缘多近算吸附
};
```

#### 6.2.2 创建透明窗口

```javascript
function createMainWindow(store) {
  const windowConfig = {
    transparent: true,           // 透明背景
    frame: false,                // 无边框（无标题栏、无系统按钮）
    alwaysOnTop: true,           // 始终置顶
    skipTaskbar: true,           // 不在任务栏显示
    resizable: true,             // 可调整大小
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,    // 安全隔离
      nodeIntegration: false     // 禁用 Node.js
    },
    show: false,                 // 创建后不立即显示
    backgroundColor: '#00000000' // 透明背景色
  };
  
  const mainWindow = new BrowserWindow(windowConfig);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // ready-to-show 时再显示，避免闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  return mainWindow;
}
```

#### 6.2.3 边缘自动隐藏机制

这是整个项目最复杂的逻辑之一：

```javascript
// 核心思路：每 50ms 检查一次鼠标位置，根据鼠标与窗口的关系决定显示/隐藏
function checkMousePosition(window) {
  const cursorPos = screen.getCursorScreenPoint();  // 获取鼠标屏幕坐标
  const bounds = window.getBounds();                 // 获取窗口位置
  
  if (window.autoHideState.isHidden) {
    // 窗口已隐藏 → 鼠标靠近边缘 → 显示
    if (isInEdgeZone(cursorPos, bounds)) {
      showWindow(window);  // 滑入动画
    }
  } else {
    // 窗口已显示 → 鼠标离开窗口 → 隐藏
    if (!isInWindow(cursorPos, bounds)) {
      scheduleHide(window);  // 延迟隐藏
    }
  }
}

// 动画滑入/滑出
function animateWindowMove(window, startBounds, endBounds, duration, onComplete) {
  const startTime = Date.now();
  const deltaX = endBounds.x - startBounds.x;
  const deltaY = endBounds.y - startBounds.y;
  
  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);  // 缓动函数
    
    window.setBounds({
      x: Math.round(startBounds.x + deltaX * eased),
      y: Math.round(startBounds.y + deltaY * eased)
    });
    
    if (progress < 1) {
      setTimeout(animate, 33);  // ~30fps
    } else {
      onComplete();
    }
  }
  animate();
}

// easeOutCubic 缓动函数：开始快，结束慢
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
```

### 6.3 预加载脚本：`src/preload/preload.js`

这是安全桥接层，只有 50 行但非常关键：

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// 在渲染进程的 window 对象上暴露安全的 API
contextBridge.exposeInMainWorld('api', {
  // === 请求-响应模式 (invoke) ===
  getFiles: () => ipcRenderer.invoke('get-files'),
  toggleCollapse: (isCollapsed) => ipcRenderer.invoke('toggle-collapse', isCollapsed),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getFileIcons: (files) => ipcRenderer.invoke('get-file-icons', files),
  
  // === 事件监听模式 (on) ===
  onInitData: (callback) => ipcRenderer.on('init-data', (event, data) => callback(data)),
  onAutoHideChanged: (callback) => ipcRenderer.on('auto-hide-changed', (event, data) => callback(data)),
  
  // 渲染进程只能调用这些暴露的方法，无法直接访问 Node.js 或 Electron
});
```

### 6.4 渲染进程：`src/renderer/renderer.js`

前端逻辑核心，处理 UI 交互：

```javascript
// 状态管理
let isCollapsed = false;
let files = [];
let theme = 'dark';
let opacity = 92;
let iconSize = 40;

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 获取 DOM 元素
  contentEl = document.getElementById('content');
  toggleBtn = document.getElementById('toggle-btn');
  // ...
  
  // 绑定事件
  toggleBtn.addEventListener('click', handleToggleCollapse);
  
  // 监听主进程发来的初始化数据
  window.api.onInitData((data) => {
    files = data.files || [];
    isCollapsed = data.isCollapsed || false;
    theme = data.theme || 'dark';
    
    renderFiles();           // 渲染文件列表
    updateCollapseState();   // 更新折叠状态
    applyTheme(theme);       // 应用主题
    applyOpacity(opacity);   // 应用透明度
  });
});

// 渲染文件列表
function renderFiles() {
  // 先用 Emoji 快速渲染
  filesList.innerHTML = files.map((file) => `
    <div class="file-item" data-path="${escapeHtml(file.path)}">
      <div class="file-icon">${getFileEmoji(file)}</div>
      <div class="file-name">${escapeHtml(file.name)}</div>
    </div>
  `).join('');
  
  // 异步加载真实图标（不阻塞 UI）
  loadIconsAsync();
  
  // 绑定双击打开事件
  filesList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('dblclick', () => {
      window.api.openFile(item.dataset.path);
    });
  });
}

// 防抖刷新（避免频繁刷新）
let refreshTimeout = null;
let isRefreshing = false;
async function debouncedHandleRefresh(delay = 500) {
  if (isRefreshing) return;  // 正在刷新中，忽略
  
  clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(async () => {
    isRefreshing = true;
    try {
      await handleRefresh();
    } finally {
      isRefreshing = false;
    }
  }, delay);
}
```

### 6.5 CSS 主题系统：`src/renderer/styles.css`

使用 CSS 变量实现灵活的主题切换：

```css
/* 深色主题（默认）— 使用 RGB 分离的方式，方便动态调整透明度 */
:root {
  --bg-primary-rgb: 30, 30, 30;
  --text-primary-rgb: 255, 255, 255;
  --opacity-bg: 0.92;  /* 用户可调 */
  
  /* 组合使用 */
  --bg-primary: rgba(var(--bg-primary-rgb), var(--opacity-bg));
  --text-primary: rgba(var(--text-primary-rgb), 0.9);
}

/* 浅色主题 — 只需覆盖 RGB 值 */
[data-theme="light"] {
  --bg-primary-rgb: 255, 255, 255;
  --text-primary-rgb: 0, 0, 0;
}

/* 应用背景 */
#app {
  background: var(--bg-primary);
  backdrop-filter: blur(20px);  /* 毛玻璃效果 */
  border-radius: 8px;
}
```

**为什么用 RGB 分离？**
```css
/* ❌ 传统方式：无法单独调整透明度 */
--bg-primary: rgba(30, 30, 30, 0.92);

/* ✅ RGB 分离：可以动态调整透明度而不改变颜色 */
--bg-primary-rgb: 30, 30, 30;
--opacity-bg: 0.92;
--bg-primary: rgba(var(--bg-primary-rgb), var(--opacity-bg));

/* 用户调整透明度时，只需修改一个变量 */
root.style.setProperty('--opacity-bg', 0.7);
```

### 6.6 C++ 原生模块：`src/native/icon_extractor.cc`

这是性能关键部分，负责提取文件图标：

```cpp
// 核心流程：文件路径 → HICON → GDI+ Bitmap → PNG → Base64 → JavaScript

// 1. 获取文件图标句柄
HICON GetIconForPath(LPCWSTR path, bool isClsid) {
    SHFILEINFOW shfi;
    // SHGFI_ICON: 获取图标
    // SHGFI_JUMBOICON: 获取 256x256 大图标
    UINT flags = SHGFI_ICON | SHGFI_JUMBOICON;
    
    if (SHGetFileInfoW(path, 0, &shfi, sizeof(shfi), flags) == 0) {
        return nullptr;  // 获取失败
    }
    return shfi.hIcon;
}

// 2. 将 HICON 转换为 PNG Base64
std::string iconToPng(HICON hIcon) {
    // 创建 GDI+ Bitmap
    Bitmap* bmp = new Bitmap(w, h, PixelFormat32bppARGB);
    Graphics* graphics = Graphics::FromImage(bmp);
    graphics->Clear(Color(0, 0, 0, 0));  // 透明背景
    graphics->SetInterpolationMode(InterpolationModeHighQualityBicubic);
    
    // 绘制图标到 Bitmap
    HDC hdc = graphics->GetHDC();
    DrawIconEx(hdc, 0, 0, hIcon, w, h, 0, NULL, DI_NORMAL);
    graphics->ReleaseHDC(hdc);
    
    // 保存为 PNG 到内存流
    MemoryStream* ms = new MemoryStream();
    bmp->Save(ms, &pngClsid, NULL);
    
    // 转换为 Base64
    return b64enc(ms->getData().data(), ms->getData().size());
}

// 3. 暴露给 Node.js 的函数
Napi::Value ExtractIcon(const Napi::CallbackInfo& info) {
    std::string u8 = info[0].As<Napi::String>().Utf8Value();
    
    // UTF-8 → UTF-16（Windows API 需要宽字符）
    int wl = MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, NULL, 0);
    std::vector<wchar_t> wb(wl);
    MultiByteToWideChar(CP_UTF8, 0, u8.c_str(), -1, wb.data(), wl);
    
    HICON hIcon = GetIconForPath(wp.c_str(), isClsid);
    std::string b64 = iconToPng(hIcon);
    
    // 返回 data:image/png;base64,... 格式
    return Napi::String::New(env, ("data:image/png;base64," + b64).c_str());
}

// 4. 模块注册
NODE_API_MODULE(icon_extractor, Init)
```

### 6.7 右键菜单：`src/main/shell-context-menu.js`

这是项目中最复杂的部分——动态编译 C# 代码来调用 Windows Shell 的右键菜单：

```javascript
// 内嵌的 C# 源码（约 400 行）
const CSHARP_SOURCE = `using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

// COM 接口定义（Windows Shell API）
[ComImport, Guid("000214E6-0000-0000-C000-000000000046")]
interface IShellFolder { ... }

[ComImport, Guid("000214f4-0000-0000-C000-000000000046")]
interface IContextMenu2 : IContextMenu { ... }

class ContextMenuWindow : Form {
    // 显示桌面右键菜单
    public int ShowDesktopContextMenu(int x, int y) {
        // 1. 找到桌面窗口
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        
        // 2. 发送鼠标右键消息给桌面窗口
        SendMessage(shellView, 0x0204, wParam, lParam);  // WM_RBUTTONDOWN
        SendMessage(shellView, 0x0205, wParam, lParam);  // WM_RBUTTONUP
        
        // 3. 等待菜单关闭（消息循环）
        while (menuActive) {
            MSG msg;
            if (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }
    }
    
    // 显示文件右键菜单
    public int ShowFileContextMenu(string filePath, int x, int y) {
        // 1. 获取桌面 Shell 文件夹对象
        SHGetDesktopFolder(out IShellFolder desktop);
        
        // 2. 解析文件路径为 PIDL（Shell 标识符列表）
        SHParseDisplayName(filePath, ..., out IntPtr fullPidl, ...);
        
        // 3. 获取父文件夹的 IShellFolder
        SHBindToParent(fullPidl, ..., out object parentObj, out IntPtr childPidl);
        
        // 4. 获取 IContextMenu 接口
        parentFolder.GetUIObjectOf(..., out IntPtr ppvCtx);
        
        // 5. 创建弹出菜单
        IntPtr hMenu = CreatePopupMenu();
        _ctxMenu2.QueryContextMenu(hMenu, 0, 1, 0x7FFF, flags);
        
        // 6. 显示菜单并等待用户选择
        int cmd = TrackPopupMenuEx(hMenu, 0x0100, x, y, this.Handle, IntPtr.Zero);
        
        // 7. 执行用户选择的命令
        if (cmd > 0) {
            InvokeCommand(_ctxMenu2, cmd - 1);
        }
    }
}
`;

// 动态编译 C# 为 exe
function compileExe() {
  const cscPath = findCscExe();  // 找到 csc.exe（C# 编译器）
  const csPath = path.join(os.tmpdir(), 'ShellContextMenu.cs');
  const exePath = path.join(os.tmpdir(), 'ShellContextMenu.exe');
  
  fs.writeFileSync(csPath, CSHARP_SOURCE, 'utf8');
  
  // 编译命令
  const compileCmd = `"${cscPath}" /target:winexe /out:"${exePath}" 
                       /r:System.Windows.Forms.dll "${csPath}"`;
  execSync(compileCmd, { timeout: 30000 });
  
  return exePath;
}

// 调用编译后的 exe 显示菜单
function showFileContextMenu(filePath, x, y) {
  const exePath = compileExe();
  exec(`"${exePath}" file ${x} ${y} "${filePath}"`, {
    timeout: 30000,
    windowsHide: true
  }, (error) => {
    resolve(!error || error.status === 0);
  });
}
```

**为什么这么复杂？**
因为 Electron 渲染进程无法直接调用 Windows 的 Shell 上下文菜单。需要：
1. 一个有消息循环的 Windows 窗口（`Form`）
2. COM 接口与 Shell 交互
3. 处理子菜单的绘制消息（`IContextMenu2.HandleMenuMsg`）
4. 这些都需要原生 Windows 编程，所以用 C# 实现并动态编译

### 6.8 系统托盘：`src/main/tray.js`

```javascript
function createTray(mainWindow, store) {
  const iconPath = path.join(app.getAppPath(), 'assets', 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(trayIcon);
  tray.setToolTip('Desktop Icon Hider');
  updateTrayMenu(mainWindow, store);
  
  // 点击托盘图标：显示/隐藏窗口
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu(mainWindow, store) {
  const menuTemplate = [
    { label: mainWindow.isVisible() ? '隐藏窗口' : '显示窗口', click: () => {...} },
    { type: 'separator' },
    { label: '设置', click: () => { mainWindow.webContents.send('open-settings'); } },
    { label: '自动隐藏', type: 'checkbox', checked: store.get('autoHideEnabled'), click: () => {...} },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ];
  
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}
```

### 6.9 工具函数

#### `src/utils/config.js` — 配置管理
```javascript
const Store = require('electron-store');

const store = new Store({
  name: 'desktop-icon-hider',
  defaults: {
    windowBounds: null,
    isCollapsed: false,
    theme: 'light',
    // ...
  }
});

// 简单的 CRUD 封装
function getConfig(key) { return store.get(key); }
function setConfig(key, value) { store.set(key, value); }
```

#### `src/utils/logger.js` — 日志系统
```javascript
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
  fs.appendFileSync(LOG_FILE, logLine);
  console.log(logLine);
}

const logger = {
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
  debug: (message, data) => {
    // 只在开发模式下输出 debug 日志
    if (process.env.NODE_ENV === 'development') {
      log('debug', message, data);
    }
  }
};
```

#### `src/utils/icon-helper.js` — Emoji 图标映射
```javascript
const FILE_ICONS = {
  'folder': '📁',
  'txt': '📄',
  'pdf': '📕',
  'doc': '📘',
  'jpg': '🖼️',
  'mp4': '🎬',
  'zip': '📦',
  // ...
};

function getFileIcon(filename, isDirectory = false) {
  if (isDirectory) return '📁';
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return FILE_ICONS[ext] || FILE_ICONS['default'];
}

function formatFileSize(bytes) {
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
```

---

## 7. 关键技术点教学

### 7.1 如何调用 Windows API 隐藏桌面图标

**问题：** 如何用代码隐藏 Windows 桌面上的所有图标？

**答案：** 桌面图标是一个窗口（`SHELLDLL_DefView`），隐藏这个窗口即可。

```javascript
// 方法一：PowerShell + C#（本项目使用）
const psScript = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, 
                                              string className, string windowTitle);
    
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    public static void Hide() {
        IntPtr progman = FindWindow("Progman", null);
        IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        ShowWindow(shellView, 0);  // 0 = SW_HIDE
    }
}
"@
[DesktopHelper]::Hide()`;

require('child_process').execSync(`powershell -Command "${psScript}"`);
```

**窗口层次结构：**
```
Progman (Program Manager)
  └── SHELLDLL_DefView (桌面图标容器) ← 隐藏这个！
        └── SysListView32 (列表视图)
              └── 各个图标
```

### 7.2 如何创建 Electron 透明窗口

```javascript
const { BrowserWindow } = require('electron');

const win = new BrowserWindow({
  width: 800,
  height: 600,
  transparent: true,        // 关键：启用透明
  frame: false,             // 无边框
  alwaysOnTop: true,        // 始终置顶
  skipTaskbar: true,        // 不在任务栏显示
  backgroundColor: '#00000000',  // 透明背景色
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false
  }
});
```

**CSS 配合：**
```css
html, body {
  background: transparent;  /* 页面背景也透明 */
}

#app {
  background: rgba(30, 30, 30, 0.92);  /* 半透明背景 */
  backdrop-filter: blur(20px);          /* 毛玻璃效果 */
  border-radius: 8px;
}
```

### 7.3 如何实现拖拽（无边框窗口）

```css
/* 标题栏区域可拖拽 */
.header {
  -webkit-app-region: drag;  /* Electron 特殊 CSS 属性 */
}

/* 按钮区域不可拖拽（否则无法点击） */
.icon-btn {
  -webkit-app-region: no-drag;
}
```

### 7.4 如何实现防抖（Debounce）

```javascript
// 场景：用户快速点击刷新按钮，只执行最后一次
let refreshTimeout = null;

function debouncedRefresh(delay = 500) {
  clearTimeout(refreshTimeout);  // 清除上一次的定时器
  
  refreshTimeout = setTimeout(() => {
    handleRefresh();  // 延迟执行
  }, delay);
}

// 如果 500ms 内连续调用 3 次，只执行最后一次
debouncedRefresh();  // 第1次，设置定时器
debouncedRefresh();  // 第2次，清除第1次的，重新设
debouncedRefresh();  // 第3次，清除第2次的，重新设
// 500ms 后，只执行第3次
```

### 7.5 如何实现并发 Worker 模式

```javascript
// 场景：扫描 100 个文件，每次最多处理 10 个
async function processFilesWithConcurrency(files, limit) {
  const results = [];
  let index = 0;
  
  // Worker 函数：从共享的 index 中取任务
  async function worker() {
    while (index < files.length) {
      const file = files[index++];  // index++ 是原子操作
      const stats = await fs.promises.stat(file);
      results.push({ file, stats });
    }
  }
  
  // 创建 limit 个 worker 并发执行
  const workers = Array.from({ length: Math.min(limit, files.length) }, () => worker());
  await Promise.all(workers);  // 等待所有 worker 完成
  
  return results;
}
```

### 7.6 如何使用 CSS 变量实现主题切换

```css
/* 1. 定义变量（默认深色） */
:root {
  --bg-rgb: 30, 30, 30;
  --text-rgb: 255, 255, 255;
  --bg: rgba(var(--bg-rgb), 0.92);
  --text: rgba(var(--text-rgb), 0.9);
}

/* 2. 浅色主题覆盖 RGB 值 */
[data-theme="light"] {
  --bg-rgb: 255, 255, 255;
  --text-rgb: 0, 0, 0;
}

/* 3. 使用变量 */
body {
  background: var(--bg);
  color: var(--text);
}
```

```javascript
// 切换主题
function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
```

### 7.7 如何使用 electron-store 持久化配置

```javascript
const Store = require('electron-store');

// 创建存储实例
const store = new Store({
  name: 'my-app',
  defaults: {
    theme: 'dark',
    windowBounds: { x: 100, y: 100, width: 800, height: 600 }
  }
});

// 读取
const theme = store.get('theme');  // 'dark'
const bounds = store.get('windowBounds');

// 写入
store.set('theme', 'light');
store.set('windowBounds', { x: 200, y: 200, width: 900, height: 700 });

// 删除
store.delete('windowBounds');

// 清空
store.clear();

// 数据存储在：
// Windows: %APPDATA%/my-app/config.json
```

### 7.8 如何编译 C++ 原生模块

**binding.gyp 配置：**
```json
{
  "targets": [{
    "target_name": "icon_extractor",
    "sources": ["src/native/icon_extractor.cc"],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")"
    ],
    "dependencies": [
      "<!(node -p \"require('node-addon-api').gyp\")"
    ],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "ExceptionHandling": 1,
        "AdditionalOptions": ["/std:c++17"]
      }
    },
    "conditions": [
      ["OS=='win'", {
        "libraries": ["-lshell32.lib", "-lgdi32.lib", "-lgdiplus.lib"],
        "defines": ["NOMINMAX", "UNICODE", "_UNICODE"]
      }]
    ]
  }]
}
```

**编译命令：**
```bash
# 安装依赖
npm install

# 编译 C++ 模块
npm run rebuild-native
# 或
node-gyp rebuild

# 输出文件：build/Release/icon_extractor.node
```

**在 JavaScript 中使用：**
```javascript
const iconExtractor = require('../../build/Release/icon_extractor.node');

// 提取单个文件图标
const base64Icon = iconExtractor.extractIcon('C:\\path\\to\\file.exe');
// 返回: "data:image/png;base64,iVBORw0KGgo..."

// 批量提取
const icons = iconExtractor.extractIconsBatch([
  'C:\\file1.exe',
  'C:\\file2.txt'
]);
// 返回: { "C:\\file1.exe": "data:image/png;base64,...", ... }
```

---

## 8. 从零搭建指南

### 8.1 环境准备

```bash
# 1. 安装 Node.js (推荐 18+)
# 下载：https://nodejs.org/

# 2. 验证安装
node -v   # v18.x.x
npm -v    # 9.x.x

# 3. 安装 C++ 编译工具（Windows）
npm install --global windows-build-tools
# 或手动安装 Visual Studio Build Tools
```

### 8.2 初始化项目

```bash
# 1. 创建项目目录
mkdir desktop-icon-hider
cd desktop-icon-hider

# 2. 初始化 npm
npm init -y

# 3. 安装 Electron
npm install --save-dev electron@^27.0.0

# 4. 安装其他依赖
npm install electron-store better-sqlite3
npm install --save-dev electron-builder node-gyp node-addon-api sharp eslint jest

# 5. 创建目录结构
mkdir -p src/{main,preload,renderer,native,utils}
mkdir -p assets build __tests__
```

### 8.3 创建 package.json

```json
{
  "name": "desktop-icon-hider",
  "version": "1.0.0",
  "main": "src/main/index.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron . --dev --enable-logging",
    "build": "node-gyp rebuild && electron-builder",
    "build:win": "node-gyp rebuild && electron-builder --win",
    "rebuild-native": "node-gyp rebuild",
    "lint": "eslint src/**/*.js",
    "test": "jest"
  }
}
```

### 8.4 创建最小可运行版本

**步骤 1：创建主进程入口 `src/main/index.js`**
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.show();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // 不退出
});
```

**步骤 2：创建 preload 脚本 `src/preload/preload.js`**
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onReady: (callback) => ipcRenderer.on('ready', (event, data) => callback(data))
});
```

**步骤 3：创建 HTML 页面 `src/renderer/index.html`**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Desktop Icon Hider</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: 100%; height: 100%; 
      background: transparent; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      user-select: none;
    }
    #app {
      width: 100%; height: 100%;
      background: rgba(30, 30, 30, 0.92);
      backdrop-filter: blur(20px);
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      display: flex; flex-direction: column;
    }
    .header {
      height: 40px;
      display: flex; align-items: center; padding: 0 12px;
      -webkit-app-region: drag;
      background: rgba(45, 45, 45, 0.95);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .title {
      flex: 1; color: rgba(255,255,255,0.9); font-size: 13px;
      pointer-events: none;
    }
    .btn {
      width: 26px; height: 26px; border: none;
      background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85);
      border-radius: 4px; cursor: pointer; font-size: 14px;
      -webkit-app-region: no-drag;
    }
    .btn:hover { background: rgba(255,255,255,0.15); }
    .content { flex: 1; padding: 20px; color: rgba(255,255,255,0.8); }
  </style>
</head>
<body>
  <div id="app">
    <div class="header">
      <span class="title">桌面图标分区</span>
      <button class="btn" id="quit-btn" title="关闭">×</button>
    </div>
    <div class="content">
      <p>Hello, Desktop Icon Hider!</p>
    </div>
  </div>
  <script>
    document.getElementById('quit-btn').addEventListener('click', () => {
      window.api.quitApp();
    });
  </script>
</body>
</html>
```

**步骤 4：运行**
```bash
npm start
```

### 8.5 逐步添加功能

按照以下顺序逐步添加功能：

1. **基础窗口** → 透明、无边框、置顶
2. **文件扫描** → `fs.readdir` 扫描桌面
3. **IPC 通信** → 主进程发送文件列表到渲染进程
4. **文件列表渲染** → 渲染进程显示文件网格
5. **图标提取** → 添加 C++ 原生模块
6. **折叠功能** → 窗口高度切换
7. **右键菜单** → 动态编译 C# 服务
8. **系统托盘** → 托盘图标和菜单
9. **自动隐藏** → 边缘吸附和鼠标检测
10. **主题系统** → CSS 变量主题切换
11. **配置持久化** → electron-store
12. **打包发布** → electron-builder

---

## 9. 常见问题与调试

### 9.1 开发调试

```bash
# 开启日志模式
npm run dev

# 在应用内按 F12 或 Ctrl+Shift+I 打开开发者工具
# （代码中已注册快捷键）
```

### 9.2 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 窗口不透明 | GPU 加速问题 | 添加 `app.commandLine.appendSwitch('disable-gpu-compositing')` |
| 拖拽无效 | `-webkit-app-region: drag` 缺失 | 检查 CSS 中是否添加 |
| C++ 模块编译失败 | 缺少编译工具 | 安装 Visual Studio Build Tools |
| 右键菜单首次慢 | C# 动态编译耗时 | 启动时预编译（本项目已实现） |
| 退出后桌面图标消失 | `before-quit` 未执行 | 确保调用 `app.quit()` 前设置 `app.isQuitting = true` |
| 图标显示为 Emoji | 原生模块未编译 | 运行 `npm run rebuild-native` |

### 9.3 调试技巧

```javascript
// 1. 在主进程中打印日志
console.log('获取到桌面文件:', files.length, '个');

// 2. 在渲染进程中打印日志
console.log('渲染文件列表:', files.length, '项');

// 3. 监听 IPC 通信
ipcMain.on('ipc-debug', (event, data) => {
  console.log('IPC 收到:', data);
});

// 4. 检查窗口状态
console.log('窗口位置:', mainWindow.getBounds());
console.log('是否折叠:', mainWindow.isCollapsed);
```

### 9.4 打包发布

```bash
# 构建 Windows 安装包和便携版
npm run build:win

# 输出目录：
# dist/Desktop Icon Hider-1.0.0-win-x64.exe  (NSIS 安装包)
# dist/Desktop Icon Hider-1.0.0-portable.exe  (便携版)
```

---

## 附录 A：关键 API 速查

### Electron API

| API | 用途 |
|-----|------|
| `app.whenReady()` | 应用就绪事件 |
| `app.quit()` | 退出应用 |
| `new BrowserWindow(options)` | 创建窗口 |
| `shell.openPath(filePath)` | 用系统默认程序打开文件 |
| `nativeImage.createFromPath(path)` | 加载图片 |
| `new Tray(image)` | 创建系统托盘 |
| `ipcMain.handle(channel, handler)` | 注册 IPC 处理器 |
| `ipcRenderer.invoke(channel, ...args)` | 发送 IPC 请求 |
| `contextBridge.exposeInMainWorld()` | 暴露安全 API |

### Windows API

| API | 用途 |
|-----|------|
| `FindWindow(className, windowName)` | 查找窗口 |
| `FindWindowEx(parent, childAfter, className, windowName)` | 查找子窗口 |
| `ShowWindow(hWnd, cmd)` | 控制窗口显示/隐藏 |
| `SHGetFileInfoW(path, attrs, shfi, size, flags)` | 获取文件信息和图标 |
| `SHGetDesktopFolder(out folder)` | 获取桌面 Shell 对象 |
| `SHBindToParent(pidl, riid, out parent, out childPidl)` | 获取父文件夹 |
| `TrackPopupMenuEx(hMenu, flags, x, y, hwnd, lptpm)` | 显示弹出菜单 |

### Node.js API

| API | 用途 |
|-----|------|
| `fs.promises.readdir(path)` | 读取目录 |
| `fs.promises.stat(path)` | 获取文件信息 |
| `fs.existsSync(path)` | 检查文件是否存在 |
| `path.join(...segments)` | 拼接路径 |
| `path.extname(filename)` | 获取文件扩展名 |
| `os.tmpdir()` | 获取临时目录 |
| `execSync(command, options)` | 同步执行命令 |
| `exec(command, callback)` | 异步执行命令 |

---

## 附录 B：学习路径建议

### 新手路线（4-6 周）

| 周次 | 学习内容 | 实践目标 |
|------|---------|---------|
| 第1周 | JavaScript ES6+、Node.js 基础 | 能写基本的文件读写脚本 |
| 第2周 | Electron 基础（主进程、渲染进程、IPC） | 创建一个透明窗口应用 |
| 第3周 | HTML/CSS 布局、CSS 变量 | 实现一个带主题的 UI |
| 第4周 | Windows API 基础、PowerShell | 用脚本隐藏/显示桌面图标 |
| 第5周 | C++ 基础、node-addon-api | 编译一个简单的原生模块 |
| 第6周 | 整合所有知识 | 完成 Desktop Icon Hider |

### 进阶路线

1. **性能优化**：使用虚拟列表渲染大量文件
2. **多分区支持**：类似 Fences 的多区域管理
3. **拖拽排序**：支持在窗口内拖拽文件
4. **插件系统**：扩展右键菜单功能
5. **自动更新**：使用 electron-updater

---

*文档版本：1.0.0*
*最后更新：2026-04-06*
