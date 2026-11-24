<#
.SYNOPSIS
  Run all Cross Arena checks: git root guard, Python tool tests, content & asset validation, GUT.
  Tool paths come from tools.local.json (gitignored). System PATH is not used or modified.
#>
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$top = (git -C $root rev-parse --show-toplevel).Replace("/", "\")
if ($top -ne $root) { throw "git toplevel '$top' != project root '$root'" }

$cfgPath = Join-Path $root "tools.local.json"
if (-not (Test-Path $cfgPath)) { throw "tools.local.json missing; copy tools.local.example.json and fill in paths" }
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$py = Join-Path $root ".venv\Scripts\python.exe"
$fail = 0

Write-Host "== Python unit tests"
& $py -m unittest discover -s (Join-Path $root "asset_pipeline\tests")
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host "== Whole-project data & core-isolation validation"
& $py (Join-Path $root "asset_pipeline\validate.py") --skip-assets
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host "== Full asset & frame sequence validation (test_pack)"
& $py (Join-Path $root "asset_pipeline\validate.py") --ip test_pack
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host "== GUT (unit + combat mechanics + deterministic replay)"
& $cfg.godot_console --headless --path $root --import | Out-Null
& $cfg.godot_console --headless --path $root -s res://addons/gut/gut_cmdln.gd
if ($LASTEXITCODE -ne 0) { $fail++ }

if ($fail -gt 0) { Write-Host "FAILED ($fail suite(s))"; exit 1 }
Write-Host "ALL PASSED"
