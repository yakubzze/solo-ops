@echo off
REM Double-click to run. Installs and builds on first use, then just starts.
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)
if not exist dist (
  echo Building...
  call npm run build
)

node server/index.mjs
pause
