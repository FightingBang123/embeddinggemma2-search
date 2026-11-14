# EmbeddingGemma 2 - start from this folder.
# The exe here is a launcher: if this folder (or the working directory) contains
# non-ASCII characters, it copies the app to an ASCII path first and starts it
# from there, so no special handling is needed here.

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$exe = Join-Path $src 'EmbeddingGemma2.exe'

if (-not (Test-Path $exe)) {
    Write-Host "[error] EmbeddingGemma2.exe not found in $src"
    exit 1
}

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory $src
