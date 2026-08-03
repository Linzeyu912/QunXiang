@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "DB_URL=postgresql://novel_agent:change_me@127.0.0.1:5432/novel_agent"

echo ========================================
echo   Novel Agent - 首次安装
echo ========================================
echo.

echo [1/4] 检查 Node.js 和 pnpm...
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未安装 Node.js。请从 https://nodejs.org/ 安装。
    goto :end
)
where pnpm >nul 2>&1
if errorlevel 1 (
    echo 正在安装 pnpm...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [错误] pnpm 安装失败。
        goto :end
    )
    where pnpm >nul 2>&1
    if errorlevel 1 (
        echo [错误] pnpm 已安装但当前终端未生效，请重新打开终端后运行 setup.bat。
        goto :end
    )
)
echo   OK
echo.

echo [2/4] 安装所有依赖（首次需下载嵌入式 PostgreSQL，约 30MB，请耐心等待）...
call pnpm install
if errorlevel 1 (
    echo [错误] pnpm install 执行失败。
    goto :end
)
call pnpm rebuild esbuild >nul 2>&1
echo   OK
echo.

echo [3/4] 写入环境配置文件...
if not exist "api\.env" (
    (
        echo PORT=3001
        echo NODE_ENV=development
        echo JWT_SECRET=novel-agent-jwt-secret-key-2024
        echo JWT_EXPIRES_IN=24h
        echo DATABASE_URL=!DB_URL!
        echo DIRECT_DATABASE_URL=!DB_URL!
        echo MAX_FILE_SIZE=52428800
        echo ALLOWED_ORIGINS=http://localhost:5173
        echo LOG_LEVEL=info
        echo LLM_PROVIDER=custom
        echo LLM_API_KEY=
        echo LLM_BASE_URL=
        echo LLM_MODEL=
        echo KEY_VAULTS_SECRET=novel-agent-local-dev-key-change-before-production
        echo OBJECT_STORAGE_PROVIDER=fs
        echo OBJECT_STORAGE_SIGN_SECRET=novel-agent-local-object-sign-secret-change-before-production
    ) > "api\.env"
    echo   已创建 api\.env
) else (
    echo   api\.env 已存在
    findstr /B /I /C:"DATABASE_URL=file:" "api\.env" >nul 2>&1
    if not errorlevel 1 (
        echo   检测到旧版 SQLite 配置，自动修正...
        call :fix_sqlite_env "api\.env"
    )
    findstr /B /I /C:"DIRECT_DATABASE_URL=" "api\.env" >nul 2>&1
    if errorlevel 1 (
        echo DIRECT_DATABASE_URL=!DB_URL! >> "api\.env"
    )
    findstr /B /I /C:"OBJECT_STORAGE_PROVIDER=" "api\.env" >nul 2>&1
    if errorlevel 1 (
        echo OBJECT_STORAGE_PROVIDER=fs >> "api\.env"
    )
    findstr /B /I /C:"OBJECT_STORAGE_SIGN_SECRET=" "api\.env" >nul 2>&1
    if errorlevel 1 (
        echo OBJECT_STORAGE_SIGN_SECRET=novel-agent-local-object-sign-secret-change-before-production >> "api\.env"
    )
)
if not exist "storage\.env" (
    (
        echo DATABASE_URL=!DB_URL!
        echo DIRECT_DATABASE_URL=!DB_URL!
    ) > "storage\.env"
    echo   已创建 storage\.env
) else (
    echo   storage\.env 已存在
    findstr /B /I /C:"DATABASE_URL=file:" "storage\.env" >nul 2>&1
    if not errorlevel 1 (
        echo   检测到旧版 SQLite 配置，自动修正...
        call :fix_sqlite_env "storage\.env"
    )
    findstr /B /I /C:"DIRECT_DATABASE_URL=" "storage\.env" >nul 2>&1
    if errorlevel 1 (
        echo DIRECT_DATABASE_URL=!DB_URL! >> "storage\.env"
    )
)
echo.

echo [4/4] 启动 PostgreSQL 并运行数据库迁移...
node "%~dp0scripts\pg-server.mjs" start
if errorlevel 1 (
    echo [错误] PostgreSQL 启动失败。
    goto :end
)
pushd storage
call pnpm exec prisma migrate deploy --schema=./prisma/schema.prisma
if errorlevel 1 (
    popd
    echo [错误] PostgreSQL 迁移失败。
    goto :end
)
popd
echo   正在生成 Prisma Client...
pushd storage
call pnpm exec prisma generate --schema=./prisma/schema.prisma
if errorlevel 1 (
    popd
    echo [错误] Prisma Client 生成失败。
    goto :end
)
popd
echo.

echo ========================================
echo   安装完成！现在可以运行 start.bat
echo ========================================

:end
echo.
echo 按任意键退出...
pause >nul
exit /b 0

:: ── 辅助函数：自动修复 SQLite 配置 ──
:fix_sqlite_env
set "FIX_FILE=%~1"
if not exist "%FIX_FILE%" exit /b 0
set "TMP_FILE=%FIX_FILE%.tmp"
> "%TMP_FILE%" (
    for /f "usebackq delims=" %%a in ("%FIX_FILE%") do (
        set "LINE=%%a"
        set "PREFIX=!LINE:~0,13!"
        if /i "!PREFIX!"=="DATABASE_URL=" (
            echo DATABASE_URL=!DB_URL!
        ) else (
            echo !LINE!
        )
    )
)
move /y "%TMP_FILE%" "%FIX_FILE%" >nul
exit /b 0
