@echo off
rem EmbeddingGemma 2 - install + launch. See Install.ps1.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\Install.ps1"
if errorlevel 1 (
  echo.
  echo [error] install failed, see message above
  pause
)
