# EmbeddingGemma 2 - install to an ASCII-only path and launch.
# Called by Install.cmd. ASCII-only output on purpose (cmd codepage).
# Note: double-clicking EmbeddingGemma2.exe (or EmbeddingGemma2App.exe) works too -
# both are the same small launcher, which relocates on its own when needed.
#
# 说明：本脚本把整包复制到 %LOCALAPPDATA%\Programs\EmbeddingGemma2 再启动。
# 这条路走 PowerShell + cmd，不依赖 exe 所在目录的权限，因此在受限目录里最稳。

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Programs\EmbeddingGemma2'

Write-Host '[1/4] target: ' $dest
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# PowerShell copies Unicode paths correctly; cmd/robocopy can mangle them
Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

$launcher = Join-Path $dest 'EmbeddingGemma2.exe'
$core = Join-Path $dest 'EmbeddingGemma2Core.exe'
if (-not (Test-Path $launcher) -or -not (Test-Path $core)) {
    throw "copy failed: expected EmbeddingGemma2.exe and EmbeddingGemma2Core.exe in $dest"
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
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'EmbeddingGemma 2.lnk'))
$lnk.TargetPath = $launcher
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$launcher,0"
$lnk.Description = 'EmbeddingGemma 2 local semantic search'
$lnk.Save()

Write-Host '[4/4] starting'
# 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 直接退出
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $launcher -WorkingDirectory $dest
Write-Host 'done. shortcut: EmbeddingGemma 2'
