# 安装指南 - Desktop Icon Hider

## 🔧 快速安装方法

### 方法1：使用淘宝镜像（推荐）

```bash
# 设置淘宝镜像
npm config set registry https://registry.npmmirror.com

# 设置 Electron 镜像
npm config set electron_mirror https://npmmirror.com/mirrors/electron/

# 安装依赖
npm install
```

### 方法2：使用环境变量

```bash
# Windows CMD
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install

# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install

# Linux/Mac
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

### 方法3：使用 cnpm

```bash
# 安装 cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com

# 使用 cnpm 安装依赖
cnpm install
```

### 方法4：使用 yarn

```bash
# 安装 yarn
npm install -g yarn

# 设置镜像
yarn config set registry https://registry.npmmirror.com
yarn config set electron_mirror https://npmmirror.com/mirrors/electron/

# 安装依赖
yarn install
```

---

## ⚠️ 常见问题

### 问题1：网络超时

**原因**：Electron 文件较大（约 100-200MB），下载可能很慢

**解决方案**：
1. 使用淘宝镜像（见方法1）
2. 使用更快的网络
3. 或等待网络稳定后重试

### 问题2：Visual Studio 编译错误

**原因**：ffi-napi 需要编译原生模块

**解决方案**：
- 本项目已移除 ffi-napi 依赖
- 使用纯 JavaScript 实现
- 可以直接运行，不需要编译

### 问题3：权限错误

**解决方案**：
```bash
# 以管理员身份运行 CMD 或 PowerShell
npm install
```

---

## 📦 手动安装 Electron

如果自动安装失败，可以手动下载 Electron：

1. **下载 Electron**
   - 访问：https://npmmirror.com/mirrors/electron/
   - 下载版本：27.0.0
   - 平台：win32
   - 架构：x64 或 ia32

2. **放置文件**
   - 创建目录：`node_modules/electron/dist`
   - 解压下载的文件到该目录

3. **验证安装**
   ```bash
   npm list electron
   ```

---

## 🚀 启动应用

安装完成后，启动应用：

```bash
npm start
```

或双击 `start.bat`

---

## 🔍 验证安装

检查依赖是否安装成功：

```bash
npm list --depth=0
```

应该看到以下包：
- electron
- electron-store
- electron-auto-launch

---

## 📝 完整安装流程

### 1. 克隆或下载项目
```bash
cd 桌面图标隐藏
```

### 2. 设置镜像（推荐）
```bash
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
```

### 3. 安装依赖
```bash
npm install
```

### 4. 启动应用
```bash
npm start
```

---

## 💡 提示

### 如果安装仍然失败：

1. **清理缓存**
```bash
npm cache clean --force
```

2. **删除 node_modules**
```bash
# Windows
rmdir /s /q node_modules

# Linux/Mac
rm -rf node_modules
```

3. **重新安装**
```bash
npm install
```

4. **使用 VPN 或代理**
   - 如果网络受限，可能需要使用 VPN
   - 或设置代理：
   ```bash
   npm config set proxy http://proxy-server:port
   ```

---

## 🎯 离线安装

如果有已经下载好的 node_modules：

1. **复制 node_modules**
   - 从其他电脑复制
   - 或使用备份

2. **放置到项目目录**
   ```
   桌面图标隐藏/
   └── node_modules/  ← 放在这里
   ```

3. **验证**
   ```bash
   npm list --depth=0
   ```

---

## 📞 获取帮助

如果仍然遇到问题：

1. 查看日志
   ```bash
   npm install --verbose
   ```

2. 检查网络连接
   ```bash
   ping registry.npmjs.org
   ping npmmirror.com
   ```

3. 查看 npm 日志
   ```
   C:\Users\你的用户名\AppData\Local\npm-cache\_logs\
   ```

---

**安装成功后，双击 start.bat 或运行 npm start 启动应用！** 🎉
