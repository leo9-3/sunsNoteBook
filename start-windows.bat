@echo off
chcp 65001 >nul
cd /d %~dp0
if not defined PORT set PORT=4173
set "NODE=node"
if exist "%~dp0runtime\win-x64\node.exe" set "NODE=%~dp0runtime\win-x64\node.exe"
echo.
echo   Intranet Notebook starting: http://localhost:%PORT%
echo   Teammates on the intranet can open: http://THIS-PC-IP:%PORT%
echo   Keep this window open. Close it (or Ctrl+C) to stop.
echo.
start "" powershell -NoProfile -Command "Start-Sleep 2; Start-Process 'http://localhost:%PORT%'"
"%NODE%" server.js
pause
