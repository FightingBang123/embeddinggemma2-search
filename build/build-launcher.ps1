<#
.SYNOPSIS
  编译桌面启动器（launcher/Launcher.cs -> extra/EmbeddingGemma2*.exe）。
  这个 exe 是用户双击的入口：能从任意目录启动；主程序秒退时换方式重试，
  仍然不行就复制到普通目录再启动，最差也会弹窗说明原因。
  产出两份同名程序：EmbeddingGemma2.exe 和 EmbeddingGemma2App.exe
  （用户习惯点哪个名字都能走进同一条路）。
  两个 exe 都嵌入产品图标（desktop/build/icon.ico），和 Electron 主程序保持一致：
  资源管理器/任务栏/快捷方式里不会再出现"空白 exe"图标。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build\build-launcher.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build\build-launcher.ps1 -IconPath D:\my.ico
#>
param(
    [string]$Configuration = 'Release',
    [string]$IconPath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'desktop\launcher\Launcher.cs'
$outDir = Join-Path $root 'desktop\extra'
$names = @('EmbeddingGemma2.exe', 'EmbeddingGemma2App.exe')

if (-not $IconPath) { $IconPath = Join-Path $root 'desktop\build\icon.ico' }
if (-not (Test-Path $IconPath)) {
    throw "icon not found: $IconPath (run 'python build\make-icon.py' first)"
}
$IconPath = (Resolve-Path $IconPath).Path

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw "csc.exe not found (need .NET Framework 4.x on this machine)"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir $names[0]
if (Test-Path $out) { Remove-Item $out -Force }

$cscArgs = @(
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/codepage:65001',
    "/out:$out",
    "/win32icon:$IconPath",
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    $src
)

Write-Host "[build] $csc" -ForegroundColor Cyan
Write-Host "        icon: $IconPath"
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with $LASTEXITCODE" }

# 同一份启动器，两个用户会去点的文件名
foreach ($name in $names[1..($names.Count - 1)]) {
    Copy-Item -LiteralPath $out -Destination (Join-Path $outDir $name) -Force
}

foreach ($name in $names) {
    $item = Get-Item (Join-Path $outDir $name)
    Write-Host ("[done] {0} ({1:N1} KB)" -f $item.FullName, ($item.Length / 1KB)) -ForegroundColor Green
}
