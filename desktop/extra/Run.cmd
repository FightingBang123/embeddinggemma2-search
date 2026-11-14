@echo off
rem EmbeddingGemma 2 - run in place (ASCII path only). See Run.ps1.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\Run.ps1"
if errorlevel 1 pause
