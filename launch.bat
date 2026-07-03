@echo off
setlocal

set "ROOT=%~dp0"

echo Starting Novel Agent services...
echo.

start "Novel Agent - API" cmd /k "cd /d %ROOT%api && pnpm dev"
start "Novel Agent - Web" cmd /k "cd /d %ROOT%web && pnpm dev"

echo   API: http://localhost:3000
echo   Web: http://localhost:5173
echo.
echo Waiting 5 seconds, then opening browser...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo Two new windows are running the services.
echo Close them to stop the services.
echo.
pause
