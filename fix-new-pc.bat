@echo off
chcp 65001 >nul 2>&1
set INSTALL=D:\naverrank
if not "%NAVER_RANK_INSTALL_DIR%"=="" set INSTALL=%NAVER_RANK_INSTALL_DIR%

echo ==================================================
echo   Sellermate - Fix new PC install (wrong repo / .env)
echo ==================================================
echo   Target: %INSTALL%
echo.

if not exist "%INSTALL%\.git" (
  echo [ERROR] Not a git folder: %INSTALL%
  echo Clone first or set NAVER_RANK_INSTALL_DIR.
  pause
  exit /b 1
)

cd /d "%INSTALL%"

echo [1/3] Git origin -^> sellermate_naver_place_all ...
git remote set-url origin https://github.com/paust0270-debug/sellermate_naver_place_all.git
git fetch origin main
git reset --hard origin/main
if errorlevel 1 (
  echo [ERROR] git update failed
  pause
  exit /b 1
)

echo.
echo [2/3] npm install ...
call npm install --legacy-peer-deps --include=dev
if errorlevel 1 echo [WARN] npm install had issues - continuing

echo.
echo [3/3] Supabase check (needs sb_secret_ key in .env) ...
if exist "node_modules\tsx\dist\cli.mjs" (
  node node_modules\tsx\dist\cli.mjs rank-check\scripts\verify-supabase-env.ts
) else (
  echo [SKIP] tsx not found - run npm install first
)

echo.
echo ==================================================
echo   Next steps:
echo   1. Copy .env from a working PC (sb_secret_ keys, NOT eyJ)
echo   2. Run verify again until OK
echo   3. Start: npx tsx rank-check\launcher\remote-watch-launcher.ts
echo      Or run the NEW SellermateRemoteBootstrap.exe
echo ==================================================
pause
