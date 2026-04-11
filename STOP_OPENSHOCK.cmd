@echo off
setlocal
echo Stopping OpenShock fresh workspace...
echo.
wsl.exe bash -lc "cd /home/lark/OpenShock && node ./scripts/dev-fresh-stack.mjs stop"
echo.
pause
