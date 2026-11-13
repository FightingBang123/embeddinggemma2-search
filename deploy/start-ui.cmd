@echo off
rem ---------------------------------------------------------------
rem  Start the whole stack (model + web backend) and open the UI.
rem  Usage: deploy\start-ui.cmd
rem  Stop :  deploy\stop-ui.cmd
rem ---------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
set "PY=python"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

if not exist "%ROOT%\release\web\index.html" (
  echo [warn] release\web not built - the UI will 404. Run: build\build.ps1
)

if not exist "%ROOT%\release\models\embeddinggemma-2-Q8_0.gguf" (
  echo [warn] model missing. Run: deploy\download.cmd
)

echo [1/3] embedding model (llama-server :8080)
"%PY%" "%ROOT%\deploy\health.py" 8080 /health 2 >nul
if errorlevel 1 (
  call "%ROOT%\deploy\start-bg.cmd" 8080 2048
  "%PY%" "%ROOT%\deploy\health.py" 8080 /health 60
  if errorlevel 1 echo    [warn] model not ready in 60s, check logs\server-8080.log
) else (
  echo       already running
)

echo [2/3] web backend (:8000)
"%PY%" "%ROOT%\deploy\health.py" 8000 /api/health 2 >nul
if errorlevel 1 (
  start "embeddinggemma2-api" /min "%ROOT%\deploy\serve-api.cmd"
  "%PY%" "%ROOT%\deploy\health.py" 8000 /api/health 60
  if errorlevel 1 echo    [warn] backend not ready, check logs\api.log
) else (
  echo       already running
)

echo [3/3] opening http://127.0.0.1:8000
start "" "http://127.0.0.1:8000"
