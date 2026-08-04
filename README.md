# Desktop Icon Hider

一个类似 Fences 的桌面图标管理工具，提供简洁高效的桌面图标隐藏/显示功能。

## 功能特点

- 🖱️ **一键隐藏/显示桌面图标** - 通过折叠/展开虚拟分区快速管理桌面图标
- 🎯 **可拖拽窗口** - 标题栏可拖拽到任意位置
- 🧲 **边缘自动隐藏** - 窗口吸附屏幕边缘，鼠标移开自动缩回，鼠标移到边缘自动弹出，全程不干扰当前工作
- 🔄 **实时刷新** - 文件系统监听，桌面文件变化自动更新图标
- 🔍 **快速搜索** - Ctrl+F 按文件名/扩展名实时过滤
- ✂️ **多选批量操作** - Ctrl/Shift 点击或拖框多选，批量打开/复制/剪切/删除
- 📋 **剪贴板文件操作** - Ctrl+C/X/V 在图标间复制/剪切/粘贴到桌面
- 📁 **文件夹悬停预览** - 鼠标悬停文件夹即弹出内容预览
- 📐 **自动整理规则** - 按关键词/扩展名自动归类图标到分组
- ⌨️ **自定义快捷键** - 全局快捷键可自由录制修改
- 🔒 **图标锁定** - 防止误拖拽，保护图标布局
- 🌐 **中英双语** - 支持简体中文 / English 切换
- 💾 **布局导出/导入** - JSON 快照备份与恢复
- 🚀 **开机自启动** - 支持延迟启动，避免开机抢占焦点
- 🎨 **主题/透明度/图标大小** - 深色/浅色/跟随系统，实时调节
- 💾 **状态持久化** - 自动记住窗口位置、折叠状态和所有设置

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

2. **边缘自动隐藏（核心交互）**
   - 在设置中启用"边缘自动隐藏"并选择吸附边缘（上/下/左/右）
   - 使用时将窗口拖到屏幕边缘，鼠标移开窗口自动缩回，只露出 2 像素
   - 鼠标移到屏幕边缘，窗口自动弹出，可快速查看/操作桌面图标
   - 全程不干扰正在使用的其他软件

3. **图标多选**
   - 单击选中，Ctrl+点击 多选，Shift+点击 范围选择
   - 按住空白处拖框批量选择
   - 选中后底部工具栏支持批量打开/复制/剪切/粘贴/删除

4. **剪贴板操作**
   - Ctrl+C / Ctrl+X 复制/剪切选中图标
   - Ctrl+V 粘贴到桌面（重名自动追加编号）

5. **隐藏与恢复**
   - 双击窗口空白处隐藏/恢复全部图标
   - 拖动图标到分组栏可快速归类

### 快捷键

| 快捷键 | 功能 |
| ------ | ---- |
| Ctrl + F | 搜索图标 |
| Ctrl + Alt + D | 显示/隐藏窗口 |
| Ctrl + Alt + R | 刷新文件列表 |
| F2 | 重命名选中图标 |
| Del / Shift + Del | 移入回收站 / 永久删除 |
| F5 | 刷新 |
| Ctrl + A | 全选 |
| Ctrl + C / X / V | 复制 / 剪切 / 粘贴 |
| Ctrl + 滚轮 | 调整图标大小 |
| 双击空白 | 隐藏/显示全部图标 |

全局快捷键（Ctrl+Alt+D/R）可在设置中自定义。

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
