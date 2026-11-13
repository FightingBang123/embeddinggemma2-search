@echo off
rem ---------------------------------------------------------------
rem  Run the FastAPI backend in this console (used by start-ui.cmd).
rem  Logs to logs\api.log when started detached.
rem ---------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
set "PYTHONPATH=%ROOT%\backend\lib"
cd /d "%ROOT%"
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
python "%ROOT%\backend\run.py" >> "%ROOT%\logs\api.log" 2>&1
