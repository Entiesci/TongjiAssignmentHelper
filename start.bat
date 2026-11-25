@echo off
setlocal
set "TRAY_MODE=0"
if /I "%~1"=="--tray" set "TRAY_MODE=1"
cd /d "%~dp0"
title Tongji Hub

echo ========================================
echo   Tongji Hub
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 goto nO_nODE

if not exist "node_modules\playwright-core" (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 goto nPM_FAIL
)

echo Starting server...
if "%TRAY_MODE%"=="1" (
  start "" "%SystemRoot%\System32\wscript.exe" "%~dp0desktop\run-server.vbs"
) else (
  start "Tongji Hub Server" cmd /k "node server.mjs"
)
ping -n 3 127.0.0.1 >nul
if "%TRAY_MODE%"=="0" start "" http://127.0.0.1:4173
exit /b 0

:nO_nODE
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0desktop\node-missing.ps1"
exit /b 1

:nPM_FAIL
echo.
echo [ERROR] npm install failed. Check your network and try again.
echo.
if "%TRAY_MODE%"=="1" exit /b 1
pause
exit /b 1
