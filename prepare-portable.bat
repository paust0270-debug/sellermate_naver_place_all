@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set DEST=%~dp0SellermatePortable
set ENV_SRC=%~dp0deploy\local.env
set ENV_FALLBACK=%~dp0.env

echo ==================================================
echo   SellermatePortable 배포 폴더 만들기
echo ==================================================
echo   출력: %DEST%
echo.

if not exist "%ENV_SRC%" (
  if exist "%ENV_FALLBACK%" (
    set ENV_SRC=%ENV_FALLBACK%
    echo .env 사용: %ENV_FALLBACK%
  ) else (
    echo [ERROR] deploy\local.env 또는 프로젝트 .env 가 없습니다.
    echo        deploy\local.env.example 를 deploy\local.env 로 복사 후 키를 넣으세요.
    pause
    exit /b 1
  )
) else (
  echo 키 파일: %ENV_SRC%
)

if exist "%DEST%" (
  echo 기존 SellermatePortable 삭제 중...
  rmdir /s /q "%DEST%"
)

mkdir "%DEST%"

echo 파일 복사 중...
robocopy "%~dp0" "%DEST%" /E /XD node_modules SellermatePortable /XF prepare-portable.bat /NFL /NDL /NJH /NJS
if errorlevel 8 (
  echo [ERROR] robocopy 실패
  pause
  exit /b 1
)

copy /Y "%ENV_SRC%" "%DEST%\.env" >nul
copy /Y "%~dp0deploy\START.bat" "%DEST%\START.bat" >nul
copy /Y "%~dp0deploy\다른PC-복사방법.txt" "%DEST%\다른PC-복사방법.txt" >nul

echo.
echo npm install (처음엔 몇 분 걸릴 수 있음)...
cd /d "%DEST%"
call npm install --legacy-peer-deps --include=dev
if errorlevel 1 (
  echo [WARN] npm install 일부 실패 - 새 PC에서 START.bat 이 재시도합니다.
)

echo.
echo Supabase 연결 확인...
if exist "node_modules\tsx\dist\cli.mjs" (
  node node_modules\tsx\dist\cli.mjs rank-check\scripts\verify-supabase-env.ts
)

echo.
echo ==================================================
echo   완료: %DEST%
echo   이 폴더 통째로 다른 PC에 복사 후 START.bat 실행
echo ==================================================
pause
