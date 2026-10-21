@echo off
title FPS Gun Game - 서버 실행
cd /d "%~dp0"

echo ==================================================
echo   FPS 게임 서버 실행
echo   - schtasks.exe / 작업 스케줄러를 사용하지 않음
echo   - 관리자 권한 불필요, 레지스트리 변경 없음
echo   - 서버 주소: http://localhost:3000
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 를 찾을 수 없습니다.
  echo        https://nodejs.org 에서 설치 후 이 파일을 다시 실행하세요.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo [확인] 의존성 설치 중... (최초 1회만)
  call npm install --omit=dev
)

echo [실행] node server.js
node server.js

echo.
echo [종료] 서버가 끝났습니다.
pause