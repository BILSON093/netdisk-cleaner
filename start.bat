@echo off
chcp 65001 >nul
title 百度网盘和谐文件清理工具 - 免费开源版
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║     百度网盘和谐文件清理工具 - 免费开源版 v1.0           ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

REM 检查 node.exe 是否存在
if exist "%~dp0node.exe" (
    set NODE_PATH="%~dp0node.exe"
    goto :start
)

REM 检查系统是否安装了 Node.js
where node >nul 2>&1
if %errorlevel%==0 (
    set NODE_PATH=node
    echo 检测到系统已安装 Node.js
    goto :start
)

echo.
echo [错误] 未找到 Node.js 运行环境！
echo.
echo 请选择以下任一方式：
echo   1. 将 node.exe 放到本程序同目录下
echo   2. 安装 Node.js: https://nodejs.org/
echo.
echo 安装完成后重新运行此程序
echo.
pause
exit /b 1

:start
echo.
echo 正在启动服务器...
echo.

REM 检查端口是否被占用
netstat -ano | findstr ":37471" >nul 2>&1
if %errorlevel%==0 (
    echo 检测到程序可能已在运行，直接打开浏览器...
    goto :open_browser
)

REM 启动服务器（后台运行）
start "" /B %NODE_PATH% "%~dp0src\main.js"

REM 等待服务器启动
timeout /t 2 /nobreak >nul

:open_browser
echo.
echo ============================================================
echo   启动成功！正在打开浏览器...
echo   如果浏览器没有自动打开，请手动访问：
echo   http://localhost:37471
echo.
echo   提示：关闭此窗口不会停止程序
echo   要完全退出，请关闭 node.exe 进程
echo ============================================================
echo.

REM 打开浏览器
start http://localhost:37471

echo 按任意键关闭此窗口（程序继续在后台运行）...
pause >nul
exit /b 0
