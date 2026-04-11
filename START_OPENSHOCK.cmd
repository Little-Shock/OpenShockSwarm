@echo off
setlocal
echo Starting OpenShock fresh workspace...
echo.
wsl.exe bash -lc "cd /home/lark/OpenShock && node ./scripts/dev-fresh-stack.mjs start"
echo.
echo If the browser did not open, use the Entry URL printed above.
echo.
pause
