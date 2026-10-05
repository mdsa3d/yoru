@echo off
title YORU
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)
echo YORU — starting local game server
echo Open http://localhost:8080 in your browser. Close this window to stop.
node server.mjs
pause
