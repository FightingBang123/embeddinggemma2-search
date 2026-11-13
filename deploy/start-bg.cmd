@echo off
rem ---------------------------------------------------------------
rem  Start the embedding model (llama-server) detached.
rem  Usage: deploy\start-bg.cmd [port] [ctx]
rem  Stop :  deploy\stop.cmd [port]
rem ---------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8080"
set "CTX=%~2"
if "%CTX%"=="" set "CTX=2048"

set "MODEL=%ROOT%\release\models\embeddinggemma-2-Q8_0.gguf"
set "EXE=%ROOT%\release\runtime\vulkan\llama-server.exe"
if not exist "%EXE%" set "EXE=%ROOT%\release\runtime\cpu\llama-server.exe"
if not exist "%MODEL%" ( echo [error] model not found: %MODEL% & exit /b 1 )
if not exist "%EXE%"   ( echo [error] llama-server not found under release\runtime\ & exit /b 1 )
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

set "LOG=%ROOT%\logs\server-%PORT%.log"
rem stdio -> NUL: a detached child must not hold the caller's stdout pipe,
rem otherwise scripted callers block waiting for EOF.
start "embeddinggemma2-%PORT%" /min "%EXE%" --model "%MODEL%" --alias embeddinggemma2 ^
  --embedding --pooling mean --ctx-size %CTX% --batch-size %CTX% --ubatch-size %CTX% ^
  --parallel 1 --host 127.0.0.1 --port %PORT% -ngl 99 --no-webui ^
  --log-file "%LOG%" >NUL 2>&1

echo [started] http://127.0.0.1:%PORT%  log=%LOG%
