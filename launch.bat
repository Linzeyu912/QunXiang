@echo off
chcp 65001 >nul 2>&1
setlocal

set "ROOT=%~dp0"

echo 正在启动 Novel Agent 服务...
echo.

start "Novel Agent - API" cmd /k "cd /d ""%ROOT%api"" && pnpm dev"
start "Novel Agent - Web" cmd /k "cd /d ""%ROOT%web"" && pnpm dev"

echo   API: http://localhost:3001
echo   Web: http://localhost:5173
echo.
echo 等待 5 秒后打开浏览器...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo 已打开两个新窗口运行服务。
echo 关闭对应窗口即可停止服务。
echo.
echo 按任意键退出...
pause >nul
