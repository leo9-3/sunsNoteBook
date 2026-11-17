@echo off
cd /d %~dp0
rem Silent start: the server runs hidden in the background via start-windows.vbs.
rem No console window stays open. Stop it later with stop-windows.bat.
wscript "%~dp0start-windows.vbs"
