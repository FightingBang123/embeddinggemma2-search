@echo off
rem ---------------------------------------------------------------
rem  Download llama.cpp runtime + GGUF into release\ (uses hf-mirror,
rem  because the Windows curl/schannel stack on this box is broken).
rem  Usage: deploy\download.cmd [quant-file]
rem ---------------------------------------------------------------
setlocal
set "ROOT=%~dp0.."
set "BUILD=b12360"
set "QUANT=%~1"
if "%QUANT%"=="" set "QUANT=embeddinggemma-2-Q8_0.gguf"

if not exist "%ROOT%\release\models"    mkdir "%ROOT%\release\models"
if not exist "%ROOT%\release\runtime\vulkan" mkdir "%ROOT%\release\runtime\vulkan"
if not exist "%ROOT%\build\cache"       mkdir "%ROOT%\build\cache"

set "ZIP=llama-%BUILD%-bin-win-vulkan-x64.zip"
if not exist "%ROOT%\build\cache\%ZIP%" (
  python "%ROOT%\deploy\fetch.py" "https://github.com/ggml-org/llama.cpp/releases/download/%BUILD%/%ZIP%" "%ROOT%\build\cache\%ZIP%" || exit /b 1
)
if not exist "%ROOT%\release\models\%QUANT%" (
  python "%ROOT%\deploy\fetch.py" "https://hf-mirror.com/unsloth/embeddinggemma-2-GGUF/resolve/main/%QUANT%" "%ROOT%\release\models\%QUANT%" || exit /b 1
)
if not exist "%ROOT%\release\runtime\vulkan\llama-server.exe" (
  tar -xf "%ROOT%\build\cache\%ZIP%" -C "%ROOT%\release\runtime\vulkan" || exit /b 1
)
echo [done] runtime="%ROOT%\release\runtime\vulkan"  model="%ROOT%\release\models\%QUANT%"
