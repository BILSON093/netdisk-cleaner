@echo off
title Stop Netdisk Cleaner
for /f "tokens=5" %a in ('netstat -ano ^| findstr ":37471" ^| findstr LISTENING') do (
    echo Stopping PID %a ...
    taskkill /f /pid %a
    pause
    exit /b 0
)
echo No server running on port 37471.
pause
