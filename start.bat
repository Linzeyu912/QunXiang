@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "DB_URL=postgresql://qunxiang:change_me_in_production@127.0.0.1:5432/qunxiang"

echo ========================================
echo   群像 - 启动脚本
echo ========================================
echo.

:: [1/6] Check Node.js
echo [1/6] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未安装 Node.js。
    echo 请先安装 Node.js：https://nodejs.org/
    pause
    exit /b 1
)
node --version
echo.

:: [2/6] Check pnpm
echo [2/6] 检查 pnpm...
where pnpm >nul 2>&1
if errorlevel 1 (
    echo       未找到 pnpm，正在安装...
    cmd /c npm install -g pnpm
    if errorlevel 1 (
        echo [错误] pnpm 安装失败。
        pause
        exit /b 1
    )
    cmd /c where pnpm >nul 2>&1
    if errorlevel 1 (
        echo [错误] pnpm 已安装但未生效。请手动运行：npm install -g pnpm
        pause
        exit /b 1
    )
)
cmd /c pnpm --version
echo.

:: [3/6] Install dependencies
echo [3/6] 安装依赖...
if not exist "node_modules" (
    echo       正在安装根依赖（首次需下载嵌入式 PostgreSQL，约 30MB）...
    cmd /c pnpm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败。
        pause
        exit /b 1
    )
)
if not exist "api\node_modules" (
    echo       正在安装 API 依赖...
    cd /d "%~dp0api"
    cmd /c pnpm install
    if errorlevel 1 (
        echo [错误] API 依赖安装失败。
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

if not exist "web\node_modules" (
    echo       正在安装 Web 前端依赖...
    cd /d "%~dp0web"
    cmd /c pnpm install
    if errorlevel 1 (
        echo [错误] Web 依赖安装失败。
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

if exist "entity-resolution" (
    if not exist "entity-resolution\node_modules" (
        echo       正在安装实体消歧模块依赖...
        cd /d "%~dp0entity-resolution"
        cmd /c pnpm install
        if errorlevel 1 (
            echo [错误] 实体消歧模块依赖安装失败。
            pause
            exit /b 1
        )
        cd /d "%~dp0"
    )
)
echo       完成。
echo.

:: [4/6] Environment config
echo [4/6] 配置环境...
set "API_DIR=%~dp0api"

if not exist "%API_DIR%\.env" (
    echo       正在创建 api/.env 文件...

    set "JWT_SECRET=qunxiang-jwt-secret-key-2024"

    (echo # Auto-generated .env file
echo PORT=3001
echo NODE_ENV=development
echo JWT_SECRET=%JWT_SECRET%
echo JWT_EXPIRES_IN=24h
echo DATABASE_URL=!DB_URL!
echo DIRECT_DATABASE_URL=!DB_URL!
echo MAX_FILE_SIZE=52428800
echo ALLOWED_ORIGINS=http://localhost:5173
echo LOG_LEVEL=debug
echo LLM_PROVIDER=custom
echo LLM_API_KEY=
echo LLM_BASE_URL=
echo LLM_MODEL=
echo KEY_VAULTS_SECRET=qunxiang-local-dev-key-change-before-production
echo OBJECT_STORAGE_PROVIDER=fs
echo OBJECT_STORAGE_SIGN_SECRET=qunxiang-local-object-sign-secret-change-before-production) > "%API_DIR%\.env"

    echo       已创建。
) else (
    echo       api/.env 已存在，跳过。
)
if not exist "%~dp0storage\.env" (
    (echo DATABASE_URL=!DB_URL!
echo DIRECT_DATABASE_URL=!DB_URL!) > "%~dp0storage\.env"
    echo       已创建 storage/.env。
) else (
    echo       storage/.env 已存在，跳过。
)

:: 自动修复旧版 SQLite 配置为 PostgreSQL
echo       检查数据库配置...
call :fix_sqlite_env "%API_DIR%\.env"
call :fix_sqlite_env "%~dp0storage\.env"

:: 确保有 DIRECT_DATABASE_URL
findstr /B /I /C:"DIRECT_DATABASE_URL=" "%API_DIR%\.env" >nul 2>&1
if errorlevel 1 (
    echo DIRECT_DATABASE_URL=!DB_URL! >> "%API_DIR%\.env"
    echo       已补充 api/.env 的 DIRECT_DATABASE_URL。
)
findstr /B /I /C:"DIRECT_DATABASE_URL=" "%~dp0storage\.env" >nul 2>&1
if errorlevel 1 (
    echo DIRECT_DATABASE_URL=!DB_URL! >> "%~dp0storage\.env"
    echo       已补充 storage/.env 的 DIRECT_DATABASE_URL。
)
findstr /B /I /C:"OBJECT_STORAGE_PROVIDER=" "%API_DIR%\.env" >nul 2>&1
if errorlevel 1 (
    echo OBJECT_STORAGE_PROVIDER=fs >> "%API_DIR%\.env"
    echo       已补充 api/.env 的对象存储类型。
)
findstr /B /I /C:"OBJECT_STORAGE_SIGN_SECRET=" "%API_DIR%\.env" >nul 2>&1
if errorlevel 1 (
    echo OBJECT_STORAGE_SIGN_SECRET=qunxiang-local-object-sign-secret-change-before-production >> "%API_DIR%\.env"
    echo       已补充 api/.env 的对象存储签名密钥。
)
echo       数据库配置检查完成。
echo.

:: [4.5/6] Start PostgreSQL (Docker)
echo [4.5/6] 启动 PostgreSQL（Docker）...
docker info >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker Desktop 未运行。请先启动 Docker Desktop 后重试。
    pause
    exit /b 1
)
docker compose -f "%~dp0docker-compose.yml" up -d --wait postgres
if errorlevel 1 (
    echo [错误] PostgreSQL 容器启动失败。请检查 Docker 与 docker-compose.yml。
    pause
    exit /b 1
)
echo.

:: [4.6/6] Run database migrations
echo [4.6/6] 运行数据库迁移...
:: 迁移前先同步数据库密码，修复 PostgreSQL volume 密码漂移导致的 P1000 认证失败
echo       同步数据库密码（自动修复 volume 密码漂移）...
cmd /c node "%~dp0scripts\sync-db-password.mjs"
if errorlevel 1 (
    echo [错误] 数据库密码同步失败，迁移无法继续。
    pause
    exit /b 1
)
cd /d "%~dp0storage"
cmd /c pnpm exec prisma migrate deploy --schema=./prisma/schema.prisma
if errorlevel 1 (
    echo [错误] PostgreSQL 迁移失败。
    pause
    exit /b 1
)
cd /d "%~dp0"
echo       正在生成 Prisma Client...
cd /d "%~dp0storage"
cmd /c pnpm exec prisma generate --schema=./prisma/schema.prisma
cd /d "%~dp0"
echo       完成。
echo.

:: [5/6] Start API service
echo [5/6] 启动 API 服务...
cd /d "%~dp0api"
start "群像 API" cmd /k "chcp 65001>nul & pnpm dev"
cd /d "%~dp0"
echo       API 服务已启动：http://localhost:3001
echo.

:: [6/6] Start Web frontend
echo [6/6] 启动 Web 前端...
cd /d "%~dp0web"
start "群像 Web" cmd /k "chcp 65001>nul & pnpm dev"
cd /d "%~dp0"
echo       Web 服务已启动：http://localhost:5173
echo.

echo ========================================
echo   启动完成！
echo ========================================
echo.
echo   API:  http://localhost:3001
echo   Web:  http://localhost:5173
echo.
echo   正在打开浏览器...

:: 等待服务启动
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo   请勿关闭此窗口，服务在后台运行中...
pause >nul
exit /b 0

:: ── 辅助函数：自动修复 SQLite 配置 ──
:fix_sqlite_env
set "FIX_FILE=%~1"
if not exist "%FIX_FILE%" exit /b 0
findstr /B /I /C:"DATABASE_URL=file:" "%FIX_FILE%" >nul 2>&1
if errorlevel 1 exit /b 0
echo       检测到 %FIX_FILE% 使用旧版 SQLite，自动修正为 PostgreSQL...
:: 读取除 DATABASE_URL 外的所有行，写入临时文件
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
echo       已自动修正。
exit /b 0
