@echo off
rem ---------------------------------------------------------------
rem  Stop the whole stack: web backend (:8000) + model (:8080).
rem ---------------------------------------------------------------
setlocal enabledelayedexpansion
set "ROOT=%~dp0.."

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING"') do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = Get-Process -Id %%P -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -match 'python') { Stop-Process -Id %%P -Force; exit 0 } exit 3"
  if errorlevel 1 ( echo [skip] pid %%P on :8000 is not python ) else ( echo [stopped] backend pid %%P )
)

call "%ROOT%\deploy\stop.cmd" 8080
