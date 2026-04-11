@echo off
setlocal
echo OpenShock status
echo.
wsl.exe bash -lc "cd /home/lark/OpenShock && node ./scripts/dev-fresh-stack.mjs status"
echo.
pause
