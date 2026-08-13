@echo off
chcp 65001 >nul
setlocal
echo ========================================
echo   Desktop Icon Hider - 安装脚本
echo ========================================
echo.

echo [步骤 1/2] 使用淘宝镜像加速下载...
echo 提示: 仅本次安装生效，不会修改你的全局 npm 配置
echo.

REM 使用 --registry 参数一次性生效，不再永久改写全局 npm registry（避免影响用户其他项目）
call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com

if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败！
    echo.
    echo 可能的原因：
    echo 1. 网络连接问题
    echo 2. Electron 下载超时
    echo 3. npm 配置问题
    echo.
    echo 解决方案：
    echo 1. 查看 INSTALL_GUIDE.md 获取详细安装指南
    echo 2. 尝试使用不同的镜像源
    echo 3. 手动下载 Electron（见 INSTALL_GUIDE.md）
    echo.
    echo 按任意键查看详细的安装指南...
    pause >nul
    start INSTALL_GUIDE.md
    exit /b 1
)

echo.
echo [步骤 2/2] 验证安装...
call npm list --depth=0 >nul 2>&1

if errorlevel 1 (
    echo [警告] 某些包可能未正确安装
) else (
    echo [成功] 依赖安装成功！
)
echo.

echo ========================================
echo   安装完成！
echo ========================================
echo.
echo 下一步：
echo 1. 双击 start.bat 启动应用
echo 2. 或运行: npm start
echo.
echo 如有问题，请查看：
echo - INSTALL_GUIDE.md (详细安装指南)
echo - README.md (使用说明)
echo.

pause
