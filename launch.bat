@echo off
chcp 65001 >nul 2>&1
setlocal

set "ROOT=%~dp0"

echo �������� 群像 ����...
echo.

start "群像 - API" cmd /k "cd /d ""%ROOT%api"" && pnpm dev"
start "群像 - Web" cmd /k "cd /d ""%ROOT%web"" && pnpm dev"

echo   API: http://localhost:3001
echo   Web: http://localhost:5173
echo.
echo �ȴ� 5 ���������...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo �Ѵ������´������з���
echo �رն�Ӧ���ڼ���ֹͣ����
echo.
echo ��������˳�...
pause >nul
