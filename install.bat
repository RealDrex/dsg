@echo off
chcp 65001 >nul
title Sword Bot - Install
cd /d "%~dp0"

echo.
echo  ==================================================
echo     SWORD BOT  -  Install / Setup
echo  ==================================================
echo.

rem ---- 1) Node.js 22.5+ ----------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed.
  echo      Install Node.js 22 LTS ^(or newer^) from https://nodejs.org
  echo      then run install.bat again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo  [X] Node.js %%v is too old - Sword needs 22.5 or newer.
  echo      Update from https://nodejs.org
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
for /f %%v in ('node -v') do echo  [OK] Node.js %%v

rem ---- 2) Packages ---------------------------------------------------
echo.
echo  Installing packages...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo  [X] npm install failed. Check the internet connection and try again.
  pause
  exit /b 1
)
echo  [OK] Packages installed

rem ---- 3) .env -------------------------------------------------------
echo.
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo  [!] Created .env - fill in DISCORD_TOKEN, CLIENT_ID, CLIENT_SECRET, GUILD_ID
  echo      Notepad will open now. Save and close it to continue.
  start /wait notepad ".env"
) else (
  echo  [OK] .env already exists
)

rem ---- 4) Check commands ---------------------------------------------
echo.
call node scripts\check.js >nul
if errorlevel 1 (
  echo  [X] Command check failed - run: node scripts\check.js
  pause
  exit /b 1
)
echo  [OK] All commands are valid

echo.
echo  ==================================================
echo     Done!  Run start.bat to launch Sword.
echo  ==================================================
echo.
pause
