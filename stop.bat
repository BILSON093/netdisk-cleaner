@echo off
chcp 65001 >nul
title 停止百度网盘和谐文件清理工具

echo.
echo 正在停止百度网盘和谐文件清理工具...
echo.

REM 查找并结束 node.exe 进程（运行 main.js 的）
tasklist /fi "imagename eq node.exe" /v | findstr "main.js" >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=2" %%a in ('tasklist /fi "imagename eq node.exe" /v /fo csv ^| findstr "main.js"') do (
        set "pid=%%~a"
    )
    taskkill /f /im node.exe 2>&1
    echo 已停止程序
) else (
    REM 尝试通过端口查找
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":37471" ^| findstr LISTENING') do (
        taskkill /f /pid %%a 2>&1
        echo 已停止程序 (PID: %%a)
        goto :done
    )
    echo 未检测到运行中的程序
)

:done
echo.
pause
