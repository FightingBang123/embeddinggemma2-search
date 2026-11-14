# EmbeddingGemma 2 - install to an ASCII-only path and launch.
# Called by Install.cmd. ASCII-only output on purpose (cmd codepage).

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Programs\EmbeddingGemma2'

Write-Host '[1/4] target: ' $dest
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# PowerShell copies Unicode paths correctly; cmd/robocopy can mangle them
Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

if (-not (Test-Path (Join-Path $dest 'EmbeddingGemma2.exe'))) {
    throw "copy failed: exe not found in $dest"
}

Write-Host '[2/4] model check'
$model = Join-Path $dest 'resources\models\embeddinggemma-2-Q8_0.gguf'
$userModel = Join-Path $env:APPDATA 'embeddinggemma2-desktop\data\models\embeddinggemma-2-Q8_0.gguf'
if (Test-Path $model) {
    $mb = [math]::Round((Get-Item $model).Length / 1MB)
    Write-Host "       bundled model found ($mb MB) - no download needed"
} elseif (Test-Path $userModel) {
    Write-Host '       no bundled model, but one exists in user data - will be reused'
} else {
    Write-Host '       no model found: the first launch will download it (~310 MB)'
}

Write-Host '[3/4] desktop shortcut'
$exe = Join-Path $dest 'EmbeddingGemma2.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'EmbeddingGemma 2.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'EmbeddingGemma 2 local semantic search'
$lnk.Save()

Write-Host '[4/4] starting'
# 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 直接退出
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -WorkingDirectory $dest
Write-Host 'done. shortcut: EmbeddingGemma 2'
