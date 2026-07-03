@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "DB_WIN=%ROOT%storage\prisma\dev.db"
set "DB_URL=!DB_WIN:\=/!"

echo ========================================
echo   Novel Agent - First-time Setup
echo ========================================
echo.

echo [1/4] Checking Node.js and pnpm...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not installed. Install from https://nodejs.org/
    goto :end
)
where pnpm >nul 2>&1
if errorlevel 1 (
    echo Installing pnpm...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] pnpm install failed.
        goto :end
    )
)
echo   OK
echo.

echo [2/4] Installing workspace dependencies (may take a few minutes)...
call pnpm install
if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    goto :end
)
call pnpm rebuild esbuild >nul 2>&1
echo   OK
echo.

echo [3/4] Writing env files...
if not exist "api\.env" (
    (
        echo PORT=3000
        echo NODE_ENV=development
        echo JWT_SECRET=novel-agent-jwt-secret-key-2024
        echo JWT_EXPIRES_IN=24h
        echo DATABASE_URL=file:!DB_URL!
        echo MAX_FILE_SIZE=52428800
        echo ALLOWED_ORIGINS=http://localhost:5173
        echo LOG_LEVEL=info
        echo LLM_PROVIDER=custom
        echo LLM_API_KEY=
        echo LLM_BASE_URL=
        echo LLM_MODEL=
        echo KEY_VAULTS_SECRET=novel-agent-local-dev-key-change-before-production
    ) > "api\.env"
    echo   api\.env created
) else (
    echo   api\.env exists
)
if not exist "storage\.env" (
    (
        echo DATABASE_URL=file:!DB_URL!
    ) > "storage\.env"
    echo   storage\.env created
) else (
    echo   storage\.env exists
)
echo.

echo [4/4] Initializing SQLite database...
if not exist "storage\prisma\dev.db" (
    pushd storage
    call pnpm exec prisma db push --schema=./prisma/schema.prisma --skip-generate --accept-data-loss
    popd
) else (
    echo   Database exists
)
echo.

echo ========================================
echo   Setup complete. Now run: launch.bat
echo ========================================

:end
echo.
pause
