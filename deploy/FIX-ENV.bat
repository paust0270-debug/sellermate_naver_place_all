@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if exist ".env.defaults" (
  copy /Y ".env.defaults" ".env" >nul
  echo [OK] .env.defaults -^> .env 복사 완료
) else if exist "deploy\local.env" (
  copy /Y "deploy\local.env" ".env" >nul
  echo [OK] deploy\local.env -^> .env 복사 완료
) else (
  echo [ERROR] .env.defaults 없음. prepare-portable.bat 으로 폴더를 다시 만드세요.
  pause
  exit /b 1
)

if exist "node_modules\tsx\dist\cli.mjs" (
  node node_modules\tsx\dist\cli.mjs rank-check\scripts\verify-supabase-env.ts
)
pause
