@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Sellermate 통합 러너

echo ==================================================
echo   Sellermate - 통합 러너 (쇼핑/쿠팡/플레이스)
echo ==================================================
echo   경로: %CD%
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js 필요: https://nodejs.org
  pause
  exit /b 1
)

git --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git 필요: https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERROR] .env 없음. prepare-portable.bat 으로 폴더를 다시 만드세요.
  pause
  exit /b 1
)

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo npm install...
  call npm install --legacy-peer-deps --include=dev
  if errorlevel 1 (
    echo [ERROR] npm install 실패
    pause
    exit /b 1
  )
)

set GIT_SYNC_HARD_RESET=1
set GIT_CHECK_INTERVAL_MS=300000

echo 시작: remote-watch (Git 5분 + 통합 실행)
echo 종료: Ctrl+C
echo.

node node_modules\tsx\dist\cli.mjs rank-check\launcher\remote-watch-launcher.ts
pause
