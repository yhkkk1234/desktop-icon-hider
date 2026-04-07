# Desktop Icon Hider

一个类似 Fences 的桌面图标管理工具，提供简洁高效的桌面图标隐藏/显示功能。

## 功能特点

- 🖱️ **一键隐藏/显示桌面图标** - 通过折叠/展开虚拟分区快速管理桌面图标
- 🎯 **可拖拽窗口** - 标题栏可拖拽到任意位置
- 💾 **状态持久化** - 自动记住窗口位置和折叠状态
- 🚀 **开机自启动** - 支持开机自动启动
- 🎨 **透明背景** - 美观的透明窗口设计
- 🪟 **始终置顶** - 确保窗口始终在最前面

## 系统要求

- Windows 10/11
- Node.js 16.0 或更高版本

## 快速开始

### 1. 安装依赖

```bash
npm install
```

或使用 Windows 批处理脚本：

```bash
install.bat
```

### 2. 启动应用

```bash
npm start
```

或双击 `start.bat`

### 3. 开发模式（带日志）

```bash
npm run dev
```

## 使用说明

### 基本操作

1. **展开/折叠**
   - 点击标题栏左侧的三角形按钮 (▼) 展开/折叠窗口
   - 展开时显示所有桌面图标
   - 折叠时只显示标题栏

2. **拖拽窗口**
   - 按住标题栏可以拖拽窗口到任意位置
   - 窗口位置会自动保存

3. **最小化和退出**
   - 点击标题栏右侧的 "-" 按钮最小化窗口
   - 点击 "×" 按钮退出应用

### 状态保存

应用会自动保存以下状态：
- 窗口位置和大小
- 展开/折叠状态
- 开机自启动设置

下次启动时会恢复到上次的状态。

## 构建

### 构建 Windows 安装包

```bash
npm run build:win
```

构建完成后，安装包位于 `dist/` 目录。

### 构建所有平台

```bash
npm run build
```

## 项目结构

```
桌面图标隐藏/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.js       # 应用入口
│   │   ├── window-manager.js    # 窗口管理
│   │   └── desktop-api.js       # Windows API集成
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 主页面
│   │   ├── styles.css     # 样式文件
│   │   └── renderer.js    # UI逻辑
│   ├── preload/           # 预加载脚本
│   │   └── preload.js     # IPC桥接
│   └── utils/             # 工具函数
│       ├── logger.js      # 日志系统
│       ├── config.js      # 配置管理
│       ├── error-handler.js  # 错误处理
│       └── icon-helper.js # 图标辅助函数
├── __tests__/             # 测试文件
├── build/                 # 构建资源
├── package.json           # 项目配置
├── electron-builder.yml   # 构建配置
├── AGENTS.md              # 开发指南
├── CHANGELOG.md           # 变更日志
├── CONTRIBUTING.md        # 贡献指南
└── README.md              # 本文件
```

## 技术栈

- **Electron 27.0.0** - 桌面应用框架
- **Node.js** - 后端运行时
- **ffi-napi** - Windows API调用
- **electron-store** - 状态持久化
- **electron-auto-launch** - 开机自启动

## 开发命令

```bash
# 启动应用
npm start

# 启动开发模式（带日志）
npm run dev

# 运行代码检查
npm run lint

# 运行测试
npm test

# 构建Windows版本
npm run build:win

# 构建所有平台
npm run build
```

## Windows API集成

应用使用 `ffi-napi` 调用以下Windows API：

1. **FindWindowW/FindWindowExW** - 查找桌面窗口
2. **ShowWindow** - 控制窗口显示/隐藏
3. **SetWindowPos** - 设置窗口位置和大小
4. **GetWindowRect** - 获取窗口矩形
5. **EnumWindows** - 枚举所有窗口
6. **RegOpenKeyExW/RegSetValueExW** - 注册表操作（备用方案）

## 故障排除

### 桌面图标无法隐藏

如果图标无法隐藏，请尝试：

1. **以管理员身份运行**
   - 右键应用图标，选择"以管理员身份运行"

2. **检查Windows版本**
   - 确保使用Windows 10/11

3. **查看日志**
   - 运行 `npm run dev` 查看详细日志

### 窗口显示异常

1. 重启应用
2. 删除配置文件（`~/.config/desktop-icon-hider/config.json`）
3. 重新启动应用

### 依赖安装失败

1. 清除npm缓存：`npm cache clean --force`
2. 删除node_modules文件夹：`rm -rf node_modules`
3. 重新安装：`npm install`

### Windows API调用失败

如果ffi-napi相关错误：

1. 确保安装了Visual Studio Build Tools
2. 安装Windows SDK
3. 运行：`npm rebuild`

## 已知问题

1. **Windows版本兼容性**
   - 在某些Windows版本上，图标隐藏功能可能需要管理员权限

2. **性能**
   - 首次加载桌面图标可能需要几秒钟

3. **第三方主题**
   - 使用第三方桌面主题可能导致窗口显示异常

## 未来计划

- [ ] 支持多个虚拟分区
- [ ] 图标搜索功能
- [ ] 全局快捷键支持（如自定义折叠/展开快捷键）
- [ ] 图标筛选功能（按类型、大小等过滤）
- [ ] 图标拖拽重新排列

## 许可证

MIT License

## 贡献

欢迎提交问题和拉取请求！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 联系方式

如有问题或建议，请通过GitHub Issues联系。
