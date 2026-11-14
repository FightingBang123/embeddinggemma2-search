@echo off
rem EmbeddingGemma 2 - run from this folder. See Run.ps1.
rem Uses cmd + PowerShell so it also works when the folder itself is restricted.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\Run.ps1"
if errorlevel 1 pause
