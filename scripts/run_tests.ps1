<#
.SYNOPSIS
  Run all Cross Arena checks: git root guard, Python validator tests, full content & asset validation,
  TypeScript strict typecheck, Vitest combat/AI/rollback suite, and Vite production build (including PUBLIC_RELEASE check).
#>
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$top = (git -C $root rev-parse --show-toplevel).Replace("/", "\")
if ($top -ne $root) { throw "git toplevel '$top' != project root '$root'" }

$py = Join-Path $root ".venv\Scripts\python.exe"
$fail = 0

Write-Host "== Python validator unit tests"
& $py -m unittest discover -s (Join-Path $root "asset_pipeline\tests")
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host "== Whole-project data, asset, and core IP-isolation validation"
& $py (Join-Path $root "asset_pipeline\validate.py") --no-report
if ($LASTEXITCODE -ne 0) { $fail++ }

if (Test-Path (Join-Path $root "src\main.ts")) {
    Push-Location $root
    try {
        Write-Host "== TypeScript strict typecheck"
        & npm.cmd run typecheck
        if ($LASTEXITCODE -ne 0) { $fail++ }

        Write-Host "== Vitest unit & deterministic simulation suite"
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { $fail++ }

        Write-Host "== Vite production build (PUBLIC_RELEASE=1 compliance check)"
        $env:PUBLIC_RELEASE = "1"
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { $fail++ }
        Remove-Item Env:\PUBLIC_RELEASE -ErrorAction SilentlyContinue
    } finally {
        Pop-Location
    }
}

if ($fail -gt 0) { Write-Host "FAILED ($fail suite(s))"; exit 1 }
Write-Host "ALL PASSED"
