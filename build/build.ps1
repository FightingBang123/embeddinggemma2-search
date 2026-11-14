<#
.SYNOPSIS
  构建前端到 release\web，并做一次后端导入自检。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File build\build.ps1
  powershell -ExecutionPolicy Bypass -File build\build.ps1 -SkipInstall
#>
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$webOut = Join-Path $root 'release\web'

# 缓存放在工程内，避免沙箱/受限账户写不了 %LOCALAPPDATA%\npm-cache
$env:npm_config_cache = Join-Path $PSScriptRoot 'cache\npm'
New-Item -ItemType Directory -Force -Path $env:npm_config_cache | Out-Null

Write-Host "[1/3] frontend dependencies" -ForegroundColor Cyan
Push-Location $frontend
try {
    if (-not $SkipInstall) {
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    } else {
        Write-Host "      skipped"
    }

    Write-Host "[2/3] vite build -> release\web" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $webOut 'index.html'))) {
    throw "build output missing: $webOut\index.html"
}

Write-Host "[3/4] backend import check" -ForegroundColor Cyan
$env:PYTHONPATH = Join-Path $root 'backend\lib'
python -c "import sys; sys.path.insert(0, r'$root\backend'); import app.main as m; print('ok  routes:', len(m.app.routes))"
if ($LASTEXITCODE -ne 0) { throw "backend import failed" }

Write-Host "[4/4] desktop launcher" -ForegroundColor Cyan
$launcherScript = Join-Path $PSScriptRoot 'build-launcher.ps1'
if (Test-Path $launcherScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $launcherScript
    if ($LASTEXITCODE -ne 0) { throw "launcher build failed" }
} else {
    Write-Host '      skipped (build-launcher.ps1 not found)'
}

$files = Get-ChildItem $webOut -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("[done] {0} files, {1:N1} KB in release\web" -f $files.Count, ($total / 1KB)) -ForegroundColor Green
