@echo off
echo Building Desktop Icon Hider for Windows...
echo.
call npm run build:win
echo.
echo Build completed!
echo Check the 'dist' directory for the installer and portable version.
pause
