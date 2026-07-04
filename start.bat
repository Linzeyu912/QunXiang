@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
set "ROOT=%~dp0"
set "DB_WIN=%ROOT%storage\prisma\dev.db"
set "DB_URL=!DB_WIN:\=/!"

echo ========================================
echo   Novel Agent - Startup Script
echo ========================================
echo.

:: [1/6] Check Node.js
echo [1/6] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install Node.js first: https://nodejs.org/
    pause
    exit /b 1
)
node --version
echo.

:: [2/6] Check pnpm
echo [2/6] Checking pnpm...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo       pnpm not found, installing...
    cmd /c npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install pnpm.
        pause
        exit /b 1
    )
    cmd /c where pnpm >nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] pnpm installed but not usable. Please run: npm install -g pnpm
        pause
        exit /b 1
    )
)
cmd /c pnpm --version
echo.

:: [3/6] Install dependencies
echo [3/6] Installing dependencies...
if not exist "api\node_modules" (
    echo       Installing API dependencies...
    cd /d "%~dp0api"
    cmd /c pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] API dependency installation failed.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

if not exist "web\node_modules" (
    echo       Installing Web frontend dependencies...
    cd /d "%~dp0web"
    cmd /c pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] Web dependency installation failed.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)

if exist "entity-resolution" (
    if not exist "entity-resolution\node_modules" (
        echo       Installing Entity Resolution dependencies...
        cd /d "%~dp0entity-resolution"
        cmd /c pnpm install
        if %errorlevel% neq 0 (
            echo [ERROR] Entity Resolution dependency installation failed.
            pause
            exit /b 1
        )
        cd /d "%~dp0"
    )
)
echo       Done.
echo.

:: [4/6] Environment config
echo [4/6] Configuring environment...
set "API_DIR=%~dp0api"

if not exist "%API_DIR%.env" (
    echo       Creating api/.env file...

    set "JWT_SECRET=novel-agent-jwt-secret-key-2024"

    (echo # Auto-generated .env file
echo PORT=3000
echo NODE_ENV=development
echo JWT_SECRET=%JWT_SECRET%
echo JWT_EXPIRES_IN=24h
echo DATABASE_URL=file:!DB_URL!
echo MAX_FILE_SIZE=52428800
echo ALLOWED_ORIGINS=http://localhost:5173
echo LOG_LEVEL=debug
echo LLM_PROVIDER=custom
echo LLM_API_KEY=
echo LLM_BASE_URL=
echo LLM_MODEL=
echo KEY_VAULTS_SECRET=novel-agent-local-dev-key-change-before-production) > "%API_DIR%.env"

    echo       Created.
) else (
    echo       api/.env already exists, skipped.
)
if not exist "%~dp0storage\.env" (
    (echo DATABASE_URL=file:!DB_URL!) > "%~dp0storage\.env"
)
echo.

echo [4.5/6] Initializing SQLite database...
if not exist "%~dp0storage\prisma\dev.db" (
    cd /d "%~dp0storage"
    cmd /c pnpm exec prisma db push --schema=./prisma/schema.prisma --skip-generate --accept-data-loss
    if errorlevel 1 (
        echo [ERROR] Database initialization failed.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
) else (
    echo       Database exists.
)
echo       Generating Prisma client...
cd /d "%~dp0storage"
cmd /c pnpm exec prisma generate --schema=./prisma/schema.prisma
cd /d "%~dp0"
echo.

:: [5/6] Start API service
echo [5/6] Starting API service...
cd /d "%~dp0api"
start "Novel Agent API" cmd /k pnpm dev
cd /d "%~dp0"
echo       API starting on http://localhost:3000
echo.

:: [6/6] Start Web frontend
echo [6/6] Starting Web frontend...
cd /d "%~dp0web"
start "Novel Agent Web" cmd /k pnpm dev
cd /d "%~dp0"
echo       Web starting on http://localhost:5173
echo.

echo ========================================
echo   Services started successfully!
echo ========================================
echo.
echo   API:  http://localhost:3000
echo   Web:  http://localhost:5173
echo.
echo   Opening browser...

:: Wait a moment for services to start, then open browser
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo   Press any key to exit (services will continue running)...
pause >nul
