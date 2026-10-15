# Run from a separate, disposable checkout, NOT the installed application's directory.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [switch]$ConfirmDisposableCheckout
)
$ErrorActionPreference = "Stop"
if (-not $ConfirmDisposableCheckout) {
    throw "Use a separate clean checkout. Re-run with -ConfirmDisposableCheckout; this builds dist in that checkout."
}
if ($env:OS -ne "Windows_NT") { throw "This entry point records Windows measurements. Use npm directly on Linux." }
foreach ($tool in @("initdb.exe", "pg_ctl.exe", "postgres.exe")) {
    if (-not (Test-Path (Join-Path $PostgresBin $tool))) { throw "Missing PostgreSQL tool: $tool" }
}
$previousBin = $env:INVENTORY_VOLUME_PG_BIN
$resolvedBin = (Resolve-Path $PostgresBin).Path
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    $env:INVENTORY_VOLUME_PG_BIN = $resolvedBin
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed; acceptance did not run." }
    & npm.cmd run test:inventory-volume:acceptance
    if ($LASTEXITCODE -ne 0) { throw "Acceptance failed. Retain metrics.json and cleanup.json; do not relax the gates." }
    $report = Get-Content "generated-artifacts/inventory-volume/metrics.json" -Raw | ConvertFrom-Json
    $cleanup = Get-Content "generated-artifacts/inventory-volume/cleanup.json" -Raw | ConvertFrom-Json
    if (-not $report.passed -or $report.environment.platform -ne "win32" -or -not $cleanup.cleaned) {
        throw "Missing successful Windows measurements or cleanup confirmation."
    }
    Write-Host "Windows acceptance passed. Keep generated-artifacts/inventory-volume together as evidence."
} finally {
    $env:INVENTORY_VOLUME_PG_BIN = $previousBin
    Pop-Location
}
