@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1

if "%~1" neq "run" (
  start "Unified Runner" cmd /k "%~f0" run
  exit /b 0
)

title Unified Runner

echo ==================================================
echo   Coupang + Shopping + Place (1 by 1 per round)
echo ==================================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo [INFO] .env not found. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
  pause
  exit /b 1
)

echo Checking dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)
echo.

echo Running: Coupang -^> Shopping -^> Place paid -^> Place free -^> Shop free (loop)
echo Stop: press Ctrl+%%C
echo ==================================================
echo.

call npm start

echo.
echo ==================================================
echo   Done
echo ==================================================
pause
