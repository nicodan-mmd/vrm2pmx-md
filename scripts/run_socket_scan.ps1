param(
    [string]$ApiKey = "",
    [switch]$Upgrade
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$pythonPath = Join-Path $repoRoot ".venv\Scripts\python.exe"
$socketCliPath = Join-Path $repoRoot ".venv\Scripts\socketcli.exe"

if (-not (Test-Path $pythonPath)) {
    throw ".venv not found. Create the virtual environment first."
}

if ($ApiKey) {
    $env:SOCKET_SECURITY_API_KEY = $ApiKey
}

if (-not $env:SOCKET_SECURITY_API_KEY) {
    throw "SOCKET_SECURITY_API_KEY is not set. Pass -ApiKey or set the environment variable first."
}

if ($Upgrade -or -not (Test-Path $socketCliPath)) {
    & $pythonPath -m pip install --upgrade socketsecurity
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install or upgrade socketsecurity."
    }
}

Push-Location $repoRoot
try {
    & $socketCliPath --target-path $repoRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Socket scan failed."
    }
}
finally {
    Pop-Location
}