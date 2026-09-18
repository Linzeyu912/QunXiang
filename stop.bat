@echo off
rem 注意：本文件必须以 GBK(ANSI/CP936) 编码保存，代码页保持 936（原因同 start.bat 头部注释）。
chcp 936 >nul 2>&1
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "LOGDIR=%ROOT%logs"

echo ========================================
echo   群像 - 停止服务
echo ========================================
echo.

set "STOPPED="

:: 优先按启动时记录的 PID 停止（静默模式启动的服务）
for %%N in (api web) do (
    set "SVC_PID="
    if exist "%LOGDIR%\%%N.pid" (
        set /p SVC_PID=<"%LOGDIR%\%%N.pid"
        del "%LOGDIR%\%%N.pid" >nul 2>&1
    )
    if defined SVC_PID (
        taskkill /PID !SVC_PID! /T /F >nul 2>&1 && (
            echo [√] %%N 服务已停止（PID !SVC_PID!）
            set "STOPPED=1"
        )
    )
)

:: 兜底：按端口清理（兼容窗口方式或其他方式启动的服务）
for %%P in (3001 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":%%P " ^| findstr /I "LISTENING"') do (
        taskkill /PID %%a /T /F >nul 2>&1 && (
            echo [√] 端口 %%P 的服务已停止（PID %%a）
            set "STOPPED=1"
        )
    )
)

:: 关闭快捷方式模式弹出的服务窗口（服务被杀后 cmd /k 窗口会残留为空白提示符）
for %%T in ("群像 API" "群像 Web") do (
    taskkill /FI "WINDOWTITLE eq %%~T*" /T /F >nul 2>&1 && echo [√] %%~T 窗口已关闭
)

:: 可选：stop.bat --db 同时停止 PostgreSQL 容器（默认保持运行，下次启动更快）
if /i "%~1"=="--db" (
    docker compose -f "%ROOT%docker-compose.yml" stop postgres >nul 2>&1 && echo [√] PostgreSQL 容器已停止
)

if not defined STOPPED (
    echo   没有发现正在运行的服务。
) else (
    echo.
    echo   已全部停止。数据库容器仍在运行（停止请加参数：stop.bat --db）
)
echo.
pause
