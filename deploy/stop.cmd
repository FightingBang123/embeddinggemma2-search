@echo off
rem ---------------------------------------------------------------
rem  Stop the embedding model listening on the given port.
rem  Only kills processes whose image name is llama-server.
rem  Usage: deploy\stop.cmd [port]
rem ---------------------------------------------------------------
setlocal enabledelayedexpansion
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8080"

set FOUND=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = Get-Process -Id %%P -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'llama-server') { Stop-Process -Id %%P -Force; exit 0 } exit 3"
  if errorlevel 1 (
    echo [skip] pid %%P is not llama-server
  ) else (
    echo [stopped] pid %%P on port %PORT%
    set FOUND=1
  )
)
if "%FOUND%"=="0" echo [info] nothing listening on port %PORT%
