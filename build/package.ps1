<#
.SYNOPSIS
  打包可分发产物到 build\out\（默认不含模型与运行时，体积小）。
  加 -WithRuntime 生成"开箱即跑"的完整包（含 llama.cpp 与 GGUF，约 500 MB）。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build\package.ps1
  powershell -ExecutionPolicy Bypass -File build\package.ps1 -WithRuntime
#>
param(
    [switch]$WithRuntime
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $PSScriptRoot 'out'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$name = "embeddinggemma2-search-$stamp"
$stage = Join-Path $outDir $name

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "[1/3] staging sources" -ForegroundColor Cyan
foreach ($dir in 'backend', 'frontend', 'deploy', 'build', 'docs') {
    $src = Join-Path $root $dir
    if (-not (Test-Path $src)) { continue }
    robocopy $src (Join-Path $stage $dir) /E /XD node_modules lib out cache dist __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
}
Copy-Item (Join-Path $root 'README.md') $stage -Force
Copy-Item (Join-Path $root 'ARCHITECTURE.md') $stage -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'data') | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $stage 'data\.gitkeep') | Out-Null

Write-Host "[2/3] staging release\web" -ForegroundColor Cyan
$web = Join-Path $root 'release\web'
if (-not (Test-Path (Join-Path $web 'index.html'))) {
    throw "release\web not built; run build\build.ps1 first"
}
robocopy $web (Join-Path $stage 'release\web') /E /NFL /NDL /NJH /NJS /NP | Out-Null

if ($WithRuntime) {
    Write-Host "      including model + runtime (large)" -ForegroundColor Yellow
    robocopy (Join-Path $root 'release\models') (Join-Path $stage 'release\models') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    robocopy (Join-Path $root 'release\runtime') (Join-Path $stage 'release\runtime') /E /NFL /NDL /NJH /NJS /NP | Out-Null
}

Write-Host "[3/3] compressing" -ForegroundColor Cyan
$zip = Join-Path $outDir "$name.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$mb = (Get-Item $zip).Length / 1MB
Write-Host ("[done] {0} ({1:N1} MB)" -f $zip, $mb) -ForegroundColor Green
