@echo off
chcp 65001 >nul
title Sword Bot
cd /d "%~dp0"

if not exist "node_modules" (
  echo  First run - starting the installer...
  call install.bat || exit /b 1
)
if not exist ".env" (
  echo  [X] .env is missing - run install.bat first.
  pause
  exit /b 1
)

echo.
echo  ==================================================
echo     SWORD BOT
echo     Website / Dashboard:  http://localhost:3000
echo     Logs folder:          %~dp0logs
echo     Stop:                 Ctrl+C  then  Y
echo  ==================================================
echo.

echo  Registering slash commands...
call node src\deploy.js
if errorlevel 1 echo  [!] Could not register commands - check DISCORD_TOKEN and CLIENT_ID in .env

:loop
echo.
echo  [%date% %time%] Starting Sword...
node src\index.js
set CODE=%errorlevel%
if "%CODE%"=="78" (
  echo.
  echo  [X] Configuration problem ^(see the message above^). Fix .env and run start.bat again.
  pause
  exit /b 78
)
echo  [%date% %time%] Sword stopped ^(code %CODE%^) - restarting in 5 seconds...  ^(Ctrl+C to quit^)
timeout /t 5 /nobreak >nul
goto loop
