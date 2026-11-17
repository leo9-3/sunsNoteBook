@echo off
chcp 65001 >nul
cd /d %~dp0
if not defined PORT set PORT=4173
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo sunsNoteBook stopped (port %PORT%).
pause
