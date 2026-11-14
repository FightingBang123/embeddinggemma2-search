# EmbeddingGemma 2 - run from this folder, or explain why it cannot.
# Electron/Chromium fails silently when its path (or cwd) contains
# non-ASCII characters, so detect that first.

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

if ($src -match '[^\x20-\x7E]') {
    Write-Host '[error] this path contains non-ASCII characters:'
    Write-Host "        $src"
    Write-Host ''
    Write-Host '        Electron exits silently from such a path.'
    Write-Host '        Run Install.cmd instead - it copies the app to'
    Write-Host '        %LOCALAPPDATA%\Programs\EmbeddingGemma2 and starts it.'
    exit 1
}

$exe = Join-Path $src 'EmbeddingGemma2.exe'
# 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 直接退出
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory $src
