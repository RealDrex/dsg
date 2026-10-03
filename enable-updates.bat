@echo off
chcp 65001 >nul
title Sword Bot - Enable auto updates
cd /d "%~dp0"

echo.
echo  ==================================================
echo     SWORD BOT  -  Enable auto updates (git)
echo  ==================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo  [X] Git is not installed.
  echo      Install "Git for Windows" from https://git-scm.com/download/win
  echo      then run enable-updates.bat again.
  start "" "https://git-scm.com/download/win"
  pause
  exit /b 1
)

if exist ".git" (
  echo  [OK] This folder is already linked to git:
  git remote -v
  git status -sb
  pause
  exit /b 0
)

set REPO=https://github.com/RealDrex/dsg.git
set /p REPO=Repository URL [%REPO%]: 
set BRANCH=main
set /p BRANCH=Branch [%BRANCH%]: 

echo.
echo  Linking this folder to %REPO% (%BRANCH%)...
echo  If the repository is private, a GitHub login window will open - sign in once.
git init -q
git remote add origin "%REPO%"
git fetch origin "%BRANCH%"
if errorlevel 1 (
  echo  [X] Could not download from GitHub - check the URL, branch and your access.
  rmdir /s /q .git
  pause
  exit /b 1
)
git checkout -q -f -B "%BRANCH%" "origin/%BRANCH%"
git branch -q --set-upstream-to="origin/%BRANCH%"
call npm install --omit=dev --no-audit --no-fund

echo.
echo  [OK] Auto updates are on. Sword checks GitHub every 30 minutes and restarts itself
echo       after updating. Your .env, data and logs are kept.
echo.
pause
