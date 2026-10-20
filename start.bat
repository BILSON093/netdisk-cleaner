@echo off
title Netdisk Cleaner
cd /d "%~dp0"
echo Starting Netdisk Cleaner on http://localhost:37471
echo Close this window to stop the server.
echo.
node "%~dp0src\main.js"
pause
