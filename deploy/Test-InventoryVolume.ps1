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
if ($env:OS -ne "Windows_NT") {
    throw "This entry point records Windows measurements. Use npm directly on Linux."
}
foreach ($tool in @("initdb.exe", "pg_ctl.exe", "postgres.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin $tool) -PathType Leaf)) {
        throw "Missing PostgreSQL tool: $tool"
    }
}

$checkout = Split-Path $PSScriptRoot -Parent
$acceptance = Join-Path $checkout "tests/inventory-volume-integration.test.ts"
if (-not (Test-Path -LiteralPath $acceptance -PathType Leaf)) {
    throw "The inventory acceptance test is missing. Sync the full checkout before retrying."
}
# The old harness only targets a running Replit development preview. Do not
# pretend that it can produce standalone Windows evidence or use a live server.
$standaloneSupport = Get-ChildItem -LiteralPath (Join-Path $checkout "tests") -Recurse -Filter "*.ts" |
    Select-String -SimpleMatch "INVENTORY_VOLUME_PG_BIN" -Quiet
if (-not ($standaloneSupport -contains $true)) {
    throw "This checkout does not yet include the standalone Windows acceptance harness. Merge/sync the Windows test harness before running this launcher. Do not point it at the installed app or its database."
}

$resolvedBin = (Resolve-Path -LiteralPath $PostgresBin).Path
$previousBin = $env:INVENTORY_VOLUME_PG_BIN
$previousAcceptance = $env:INVENTORY_VOLUME_ACCEPTANCE
Push-Location $checkout
try {
    $env:INVENTORY_VOLUME_PG_BIN = $resolvedBin
    $env:INVENTORY_VOLUME_ACCEPTANCE = "1"
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed; acceptance did not run."
    }
    # Invoke tsx directly: the npm script's POSIX VAR=1 prefix is not valid in
    # Windows cmd.exe. The opt-in variable is set above and restored below.
    & ".\node_modules\.bin\tsx.cmd" --test "tests/inventory-volume-integration.test.ts"
    if ($LASTEXITCODE -ne 0) {
        throw "Acceptance failed. Retain metrics.json and cleanup.json; do not relax the gates."
    }
    $report = Get-Content "generated-artifacts/inventory-volume/metrics.json" -Raw | ConvertFrom-Json
    $cleanup = Get-Content "generated-artifacts/inventory-volume/cleanup.json" -Raw | ConvertFrom-Json
    if (-not $report.passed -or $report.environment.platform -ne "win32" -or -not $cleanup.cleaned) {
        throw "Missing successful Windows measurements or cleanup confirmation."
    }
    Write-Host "Windows acceptance passed. Keep generated-artifacts/inventory-volume together as evidence."
} finally {
    $env:INVENTORY_VOLUME_PG_BIN = $previousBin
    $env:INVENTORY_VOLUME_ACCEPTANCE = $previousAcceptance
    Pop-Location
}
