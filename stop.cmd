@echo off
REM Stops the app server. Double-click, or: stop.cmd 4322 for another port.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
if "%1"=="" pause