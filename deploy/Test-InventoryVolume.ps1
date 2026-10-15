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
$acceptance = Join-Path $checkout "script/inventory-volume-standalone.mjs"
if (-not (Test-Path -LiteralPath $acceptance -PathType Leaf)) {
    throw "The inventory acceptance test is missing. Sync the full checkout before retrying."
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
    # Node entry point works in Windows cmd.exe as well as PowerShell. It owns
    # temporary database/server processes; it cannot target an installed app.
    & node.exe ".\script\inventory-volume-standalone.mjs" --confirm-disposable-checkout
    if ($LASTEXITCODE -ne 0) {
        throw "Acceptance failed. Retain metrics.json and cleanup.json; do not relax the gates."
    }
    $report = Get-Content "generated-artifacts/inventory-volume/metrics.json" -Raw | ConvertFrom-Json
    $cleanup = Get-Content "generated-artifacts/inventory-volume/cleanup.json" -Raw | ConvertFrom-Json
    if (-not $report.passed -or $report.environment.platform -ne "win32" -or
        -not $cleanup.acceptancePassed -or -not $cleanup.cleaned -or
        $report.runId -ne $cleanup.runId) {
        throw "Missing successful Windows measurements or cleanup confirmation."
    }
    Write-Host "Windows acceptance passed. Keep generated-artifacts/inventory-volume together as evidence."
} finally {
    $env:INVENTORY_VOLUME_PG_BIN = $previousBin
    $env:INVENTORY_VOLUME_ACCEPTANCE = $previousAcceptance
    Pop-Location
}
