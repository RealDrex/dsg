@echo off
chcp 65001 >nul
title Sword Bot - Update
cd /d "%~dp0"

echo.
echo  Updating Sword...
if exist ".git" (
  where git >nul 2>nul
  if errorlevel 1 (
    echo  [!] Git is not installed - skipping code update.
  ) else (
    git pull
    if errorlevel 1 (
      echo  [X] git pull failed - resolve it and run update.bat again.
      pause
      exit /b 1
    )
  )
) else (
  echo  [!] Not a git folder - copy the new files over this folder, then run update.bat.
)

call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo  [X] npm install failed.
  pause
  exit /b 1
)
call node scripts\check.js >nul
if errorlevel 1 (
  echo  [X] Command check failed - run: node scripts\check.js
  pause
  exit /b 1
)
echo.
echo  [OK] Updated. Close the running Sword window and open start.bat again.
echo.
pause
