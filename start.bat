@echo off
title NetLink — Pothole Reporting System
cd /d "%~dp0"

echo.
echo  =========================================
echo   NetLink — Pothole Reporting System
echo   Computer Networks Project (CNS AAT)
echo  =========================================
echo.

:: Check for executables; offer to compile if missing
where gcc >nul 2>&1
set GCC_FOUND=%ERRORLEVEL%

if not exist server.exe (
  if %GCC_FOUND%==0 (
    echo [*] Compiling server.exe ...
    gcc -o server.exe server.c -lws2_32
    if errorlevel 1 ( echo [ERROR] Compilation failed. & pause & exit /b 1 )
    echo [OK] server.exe compiled.
  ) else (
    echo [ERROR] server.exe not found and GCC is not in PATH.
    echo         Please compile manually: gcc -o server.exe server.c -lws2_32
    pause & exit /b 1
  )
)

if not exist bridge.exe (
  if %GCC_FOUND%==0 (
    echo [*] Compiling bridge.exe ...
    gcc -o bridge.exe bridge.c -lws2_32
    if errorlevel 1 ( echo [ERROR] Compilation failed. & pause & exit /b 1 )
    echo [OK] bridge.exe compiled.
  ) else (
    echo [ERROR] bridge.exe not found and GCC is not in PATH.
    pause & exit /b 1
  )
)

echo [*] Starting server.exe (TCP port 9090, UDP port 9091) ...
start "NetLink Server" /min server.exe

:: Give server a moment to bind
ping -n 2 127.0.0.1 >nul

echo [*] Starting bridge.exe (HTTP port 5000) ...
start "NetLink Bridge" /min bridge.exe

:: Give bridge a moment to bind
ping -n 2 127.0.0.1 >nul

echo.
echo [OK] Both processes started.
echo.
echo  Open your browser and navigate to:
echo.
echo     http://127.0.0.1:5000/
echo.
echo  Press any key to open the browser now...
pause >nul

start "" http://127.0.0.1:5000/

echo.
echo  Both server windows are minimised.
echo  Close this window to STOP the servers.
echo.
pause
