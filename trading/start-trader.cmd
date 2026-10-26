@echo off
rem Double-click to start Crypto Signal Trader. Close this window to stop it.
title Crypto Signal Trader
cd /d "%~dp0"

if not exist node_modules (
  echo Installing packages, first run only...
  call npm ci
  if errorlevel 1 (
    echo Package install failed. See the messages above.
    pause
    exit /b 1
  )
)

rem Open the dashboard once the server has had a few seconds to start.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:4000"

:run
node src\server.js
rem Exit code 2 = already running in another window: do not restart.
if %errorlevel%==2 (
  pause
  exit /b 2
)
echo.
echo The platform stopped. Restarting in 10 seconds. Close this window to stop it for good.
timeout /t 10 /nobreak >nul
goto run
