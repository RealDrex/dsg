@echo off
chcp 65001 >nul
title Sword Bot - Setup
cd /d "%~dp0"
if not exist "node_modules" (
  call install.bat
  exit /b
)
node scripts\setup.js
echo.
pause
