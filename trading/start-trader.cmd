@echo off
rem Double-click to start Crypto Signal Trader. Close this window to stop it.
title Crypto Signal Trader
cd /d "%~dp0"

rem Make sure every package is installed and complete (a half-finished
rem install leaves the folder but not the packages).
node -e "require('express');require('ccxt');require('dotenv');require('lightweight-charts')" 2>nul
if errorlevel 1 (
  echo Installing packages...
  call npm ci
  if errorlevel 1 (
    echo.
    echo Package install failed. If it says EPERM or "operation not permitted":
    echo close other platform windows or restart your computer, then try again.
    pause
    exit /b 1
  )
)

rem Open the dashboard once the server has had a few seconds to start.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:4000"

:run
node src\server.js
rem 2 = already running in another window, 3 = setup problem: retrying will not help.
if %errorlevel%==2 goto stop
if %errorlevel%==3 goto stop
echo.
echo The platform stopped. Restarting in 10 seconds. Close this window to stop it for good.
timeout /t 10 /nobreak >nul
goto run

:stop
echo.
echo Not restarting: fix the message above, then double-click start-trader.cmd again.
pause
exit /b %errorlevel%
