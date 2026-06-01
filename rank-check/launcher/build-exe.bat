@echo off
REM EXE 빌드 (Node.js + Git 은 원격 PC에 별도 설치 필요)
REM 결과: dist\SellermateRemoteBootstrap.exe
cd /d "%~dp0\..\.."
chcp 65001 >nul 2>&1

echo [1/4] embed deploy/local.env into installer...
node scripts/generate-embedded-env.mjs
if errorlevel 1 exit /b 1

echo [2/4] esbuild bundle...
if not exist "dist" mkdir dist
call npx esbuild rank-check/launcher/bootstrap-launcher.ts ^
  --bundle --platform=node --format=cjs ^
  --outfile=dist/bootstrap-launcher.cjs
if errorlevel 1 exit /b 1

echo [3/4] pkg (Windows x64)...
call npx pkg dist/bootstrap-launcher.cjs --targets node18-win-x64 --output dist/SellermateRemoteBootstrap.exe
if errorlevel 1 (
  echo pkg failed. Install: npm i -D pkg
  exit /b 1
)

echo [4/4] Done: dist\SellermateRemoteBootstrap.exe
echo.
echo 원격 PC: EXE 실행 -^> D:\naverrank 클론 -^> Git 5분 감시 + 통합 러너
pause
