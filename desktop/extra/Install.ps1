# EmbeddingGemma 2 - install to an ASCII-only path and launch.
# Called by Install.cmd. ASCII-only output on purpose (cmd codepage).

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Programs\EmbeddingGemma2'

Write-Host "[1/3] target: $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# PowerShell copies Unicode paths correctly; cmd/robocopy can mangle them
Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

if (-not (Test-Path (Join-Path $dest 'EmbeddingGemma2.exe'))) {
    throw "copy failed: exe not found in $dest"
}

Write-Host '[2/3] desktop shortcut'
$exe = Join-Path $dest 'EmbeddingGemma2.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'EmbeddingGemma 2.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'EmbeddingGemma 2 local semantic search'
$lnk.Save()

Write-Host '[3/3] starting'
# 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 直接退出
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory $dest
Write-Host 'done. shortcut: EmbeddingGemma 2'
