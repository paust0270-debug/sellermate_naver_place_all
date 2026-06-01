@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1

if "%~1" neq "run" (
  start "Sellermate Remote Launcher" cmd /k "%~f0" run
  exit /b 0
)

title Sellermate Remote (Git 5min + Unified)

echo ==================================================
echo   원격 런처: Git 5분마다 pull + 통합 러너 실행
echo ==================================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js required: https://nodejs.org
  pause
  exit /b 1
)

git --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git required: https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".env" (
  echo [INFO] .env not found. Copy .env.example to .env and set Supabase keys.
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  pause
)

echo Installing dependencies...
call npm install --legacy-peer-deps
if errorlevel 1 (
  echo [WARN] npm install failed - continuing with existing node_modules
)
echo.

set GIT_CHECK_INTERVAL_MS=300000
set GIT_SYNC_HARD_RESET=1

echo Multi-PC: no extra config. Each PC auto-claims 1 job (PC_ID=computer name).
echo Running remote-watch-launcher...
echo Stop: Ctrl+C
echo ==================================================
echo.

call npx tsx rank-check/launcher/remote-watch-launcher.ts

echo.
pause
