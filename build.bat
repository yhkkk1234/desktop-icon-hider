@echo off
setlocal
echo Building Desktop Icon Hider for Windows...
echo.
call npm run build:win
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See the output above.
    exit /b 1
)
echo.
echo Build completed!
echo Check the 'dist' directory for the installer and portable version.
pause
