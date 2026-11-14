<#
.SYNOPSIS
  编译桌面启动器（launcher/Launcher.cs -> extra/EmbeddingGemma2.exe）。
  这个 exe 是用户双击的入口：从任意路径（含中文）启动时，会先把应用复制到
  %LOCALAPPDATA%\Programs\EmbeddingGemma2 再启动，绕开 Chromium 的路径限制。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build\build-launcher.ps1
#>
param(
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'desktop\launcher\Launcher.cs'
$outDir = Join-Path $root 'desktop\extra'
$out = Join-Path $outDir 'EmbeddingGemma2.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
    throw "csc.exe not found (need .NET Framework 4.x on this machine)"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

$args = @(
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/codepage:65001',
    "/out:$out",
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    $src
)

Write-Host "[build] $csc" -ForegroundColor Cyan
& $csc @args
if ($LASTEXITCODE -ne 0) { throw "csc failed with $LASTEXITCODE" }

$item = Get-Item $out
Write-Host ("[done] {0} ({1:N1} KB)" -f $item.FullName, ($item.Length / 1KB)) -ForegroundColor Green
