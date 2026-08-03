@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "FAILED=0"
set "WORKSPACE_DIRS=agent api core entity-prescan entity-resolution exporters extractors import llm preprocess prompts scheduler schemas storage story-arcs validators web"

echo ========================================
echo   Novel Agent - 卸载与本地清理
echo ========================================
echo.
echo 此脚本用于清理本项目生成的本地文件。
echo 不会自动卸载整台电脑上的 Node.js、npm 或 pnpm，避免影响其他项目。
echo.
echo 可清理的内容包括：
echo   用户数据：环境配置、本地数据库、output、.intermediate
echo   程序文件：node_modules、各工作区 dist 构建产物
echo.
choice /c YN /n /m "开始卸载清理流程吗？[Y/N] "
if errorlevel 2 (
    echo 已取消。
    goto :end
)

echo.
echo [1/2] 用户数据...
echo 将删除本地环境配置、本地 SQLite 数据库、提取输出和中间文件。
choice /c YN /n /m "是否删除用户数据？[Y/N] "
if errorlevel 2 (
    echo 已保留用户数据。
    goto :program_files
)

call :delete_file ".env"
call :delete_file "api.env"
call :delete_file "api\.env"
call :delete_file "storage\.env"
call :delete_file "web\.env"
call :delete_file "web\.env.local"
call :delete_file "storage\prisma\dev.db"
call :delete_file "storage\prisma\dev.db-shm"
call :delete_file "storage\prisma\dev.db-wal"
call :delete_file "storage\prisma\dev.db-journal"
call :delete_dir "output"
call :delete_dir ".intermediate"

:program_files
echo.
echo [2/2] 程序文件...
echo 将删除本项目依赖和构建产物：node_modules、各工作区 dist。
echo 不会删除源代码；如需完全移除项目文件夹，请关闭程序后手动删除整个目录。
choice /c YN /n /m "是否删除程序文件？[Y/N] "
if errorlevel 2 (
    echo 已保留程序文件。
    goto :summary
)

for %%D in (%WORKSPACE_DIRS%) do (
    call :delete_dir "%%D\node_modules"
    call :delete_dir "%%D\dist"
)
call :delete_dir "node_modules"

:summary
echo.
if "%FAILED%"=="0" (
    echo 清理完成。
) else (
    echo 清理完成，但有文件删除失败，请检查上方错误信息。
)

:end
echo.
echo 按任意键退出...
pause >nul
exit /b %FAILED%

:delete_file
set "TARGET=%~1"
if exist "%TARGET%" (
    del /f /q "%TARGET%" >nul 2>&1
    if errorlevel 1 (
        echo [错误] 删除失败：%TARGET%
        set "FAILED=1"
    ) else (
        echo 已删除：%TARGET%
    )
) else (
    echo 不存在，跳过：%TARGET%
)
exit /b 0

:delete_dir
set "TARGET=%~1"
if exist "%TARGET%\" (
    rmdir /s /q "%TARGET%" >nul 2>&1
    if errorlevel 1 (
        echo [错误] 删除失败：%TARGET%
        set "FAILED=1"
    ) else (
        echo 已删除：%TARGET%
    )
) else (
    echo 不存在，跳过：%TARGET%
)
exit /b 0
