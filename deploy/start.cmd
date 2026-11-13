@echo off
rem ---------------------------------------------------------------
rem  Start the embedding model (llama-server) in the FOREGROUND.
rem  Usage: deploy\start.cmd [port] [ctx]
rem  Stop :  Ctrl+C
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

if not exist "%MODEL%" (
  echo [error] model not found: %MODEL%
  echo         run: deploy\download.cmd
  exit /b 1
)
if not exist "%EXE%" (
  echo [error] llama-server not found under release\runtime\
  echo         run: deploy\download.cmd
  exit /b 1
)

echo [start] %EXE%
echo [start] model=%MODEL%
echo [start] http://127.0.0.1:%PORT%  ctx=%CTX%  (Ctrl+C to stop)
echo.

"%EXE%" --model "%MODEL%" --alias embeddinggemma2 --embedding --pooling mean ^
  --ctx-size %CTX% --batch-size %CTX% --ubatch-size %CTX% --parallel 1 ^
  --host 127.0.0.1 --port %PORT% -ngl 99 --no-webui
