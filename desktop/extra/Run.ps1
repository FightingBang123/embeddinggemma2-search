# EmbeddingGemma 2 - start from this folder.
# EmbeddingGemma2.exe is a small launcher: it starts EmbeddingGemma2Core.exe in
# place, retries once in relaxed mode if the folder is restricted, and only then
# copies the app to a normal directory. So no special handling is needed here.

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$exe = Join-Path $src 'EmbeddingGemma2.exe'

if (-not (Test-Path $exe)) {
    Write-Host "[error] EmbeddingGemma2.exe not found in $src"
    exit 1
}

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory $src
