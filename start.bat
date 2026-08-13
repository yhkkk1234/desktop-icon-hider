@echo off
chcp 65001 >nul
setlocal
echo ========================================
echo   Desktop Icon Hider - 启动脚本
echo ========================================
echo.

REM 检查 node_modules 是否存在
if not exist "node_modules\" (
    echo [错误] 未检测到 node_modules 目录
    echo.
    echo 请先安装依赖，执行以下步骤之一：
    echo.
    echo 方法1: 双击 install.bat
    echo 方法2: 运行 npm install
    echo 方法3: 查看 INSTALL_GUIDE.md 获取详细安装指南
    echo.
    pause
    exit /b 1
)

REM 检查 electron 是否安装
if not exist "node_modules\electron\" (
    echo [警告] Electron 未正确安装
    echo.
    echo 尝试启动，如果失败请查看 INSTALL_GUIDE.md
    echo.
)

echo 正在启动 Desktop Icon Hider...
echo.

call npm start

if errorlevel 1 (
    echo.
    echo [错误] 启动失败
    echo.
    echo 可能的原因：
    echo 1. 依赖未正确安装（重新运行 install.bat）
    echo 2. 原生模块未编译（运行 npm run rebuild-native）
    echo.
    echo 解决方案：
    echo 1. 运行 install.bat 重新安装
    echo 2. 查看 INSTALL_GUIDE.md 获取帮助
    echo.
)

pause
