@echo off
chcp 65001 >nul 2>&1
set TARGET=D:\naverrank
if not "%~1"=="" set TARGET=%~1

if not exist "%TARGET%" (
  echo [ERROR] Folder not found: %TARGET%
  echo   Run the installer once, or: APPLY-TO-D-NAVERRANK.bat D:\your\path
  pause
  exit /b 1
)

if not exist "%~dp0local.env" (
  echo [ERROR] deploy\local.env missing.
  echo   On dev PC: copy deploy\local.env.example to deploy\local.env and add keys.
  pause
  exit /b 1
)

copy /Y "%~dp0local.env" "%TARGET%\.env" >nul
copy /Y "%~dp0local.env" "%TARGET%\.env.defaults" >nul
echo [OK] Keys copied to %TARGET%\.env
echo      Re-run SellermateRemoteBootstrap.exe or START.bat
pause
