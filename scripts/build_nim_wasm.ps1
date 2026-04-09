param(
    [string]$NimExe = "nim",
    [string]$OutDir = "tmp/nim-wasm",
    [string]$Source = "src/nim/pmx_lite_main.nim",
    [string]$OutWasm = "pmx_lite_main.wasm",
    [string]$ManifestName = "vrm2pmx_nim_manifest.json",
    [int]$InitialMemoryMb = 128,
    [int]$MaximumMemoryMb = 1024,
    [int]$StackSizeMb = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-CommandExists {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    return $null -ne $cmd
}

function Import-LocalEmsdkIfAvailable {
    param([string]$Root)

    $envScript = Join-Path $Root "tmp/emsdk/emsdk_env.ps1"
    if (Test-Path $envScript) {
        Write-Host "[nim-wasm] loading local emsdk env: $envScript" -ForegroundColor DarkCyan
        . $envScript
    }
}

if (-not (Test-CommandExists $NimExe)) {
    throw "Nim executable not found: $NimExe"
}

$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-CommandExists "emcc")) {
    Import-LocalEmsdkIfAvailable -Root $root
}

if (-not (Test-CommandExists "emcc")) {
    throw "emcc not found. Install emsdk under tmp/emsdk or activate Emscripten SDK in this shell."
}

if (-not (Test-Path (Join-Path $root $Source))) {
    throw "Nim source not found: $Source"
}

$absOutDir = Join-Path $root $OutDir
New-Item -ItemType Directory -Force -Path $absOutDir | Out-Null

$absOutWasm = Join-Path $absOutDir $OutWasm
$nimCache = Join-Path $absOutDir "nimcache"

$requiredExports = @(
    "nim_wasm_init",
    "nim_wasm_alloc",
    "nim_wasm_free",
    "nim_wasm_convert",
    "nim_wasm_last_error_len",
    "nim_wasm_copy_last_error"
)

$exportedFunctions = "['_nim_wasm_init','_nim_wasm_alloc','_nim_wasm_free','_nim_wasm_convert','_nim_wasm_last_error_len','_nim_wasm_copy_last_error']"
$initialMemoryBytes = $InitialMemoryMb * 1024 * 1024
$maximumMemoryBytes = $MaximumMemoryMb * 1024 * 1024
$stackSizeBytes = $StackSizeMb * 1024 * 1024

$nimArgs = @(
    "c",
    "-d:release",
    "-d:emscripten",
    "--threads:off",
    "--os:linux",
    "--cpu:wasm32",
    "--cc:clang",
    "--clang.exe:emcc.bat",
    "--clang.linkerexe:emcc.bat",
    "--passL:-Wl,--no-entry",
    "--passL:-sALLOW_MEMORY_GROWTH=1",
    "--passL:-sINITIAL_MEMORY=$initialMemoryBytes",
    "--passL:-sMAXIMUM_MEMORY=$maximumMemoryBytes",
    "--passL:-sSTACK_SIZE=$stackSizeBytes",
    "--passL:-sEXPORTED_FUNCTIONS=$exportedFunctions",
    "--nimcache:$nimCache",
    "--out:$absOutWasm",
    (Join-Path $root $Source)
)

Write-Host "[nim-wasm] building wasm from: $Source" -ForegroundColor Cyan
& $NimExe @nimArgs
if ($LASTEXITCODE -ne 0) {
    throw "Nim->Wasm build failed"
}

if (-not (Test-Path $absOutWasm)) {
    throw "Wasm output not found: $absOutWasm"
}

$wasmDisExe = Join-Path $root "tmp/emsdk/upstream/bin/wasm-dis.exe"
if (-not (Test-Path $wasmDisExe)) {
    throw "wasm-dis not found: $wasmDisExe"
}

$watPath = [System.IO.Path]::ChangeExtension($absOutWasm, ".wat")
& $wasmDisExe $absOutWasm -o $watPath
if ($LASTEXITCODE -ne 0) {
    throw "Failed to disassemble wasm: $absOutWasm"
}

$watContent = Get-Content -Raw $watPath
foreach ($name in $requiredExports) {
    if (-not $watContent.Contains("(export `"$name`"")) {
        throw "Missing required export: $name"
    }
}

$manifestPath = Join-Path $absOutDir $ManifestName
$manifestObject = [ordered]@{
    name = "vrm2pmx-nim-runtime"
    version = "0.1.0"
    status = "wasm-pmx-output"
    entryWasm = [System.IO.Path]::GetFileName($absOutWasm)
    capabilities = @(
        "glb-to-pmx-bytes",
        "c-abi-exports",
        "single-threaded-wasm",
        "worker-ready"
    )
    notes = @(
        "Current milestone returns PMX bytes from Nim Wasm. ZIP packaging is still handled by JS worker scaffolding.",
        "Built with --threads:off so the runtime does not require shared memory or cross-origin isolation.",
        "Memory growth is enabled; current defaults are initial ${InitialMemoryMb}MB, max ${MaximumMemoryMb}MB, stack ${StackSizeMb}MB."
    )
}
$manifestObject | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host "[nim-wasm] build ready" -ForegroundColor Green
Write-Host "[nim-wasm] root    : $root"
Write-Host "[nim-wasm] out dir : $absOutDir"
Write-Host "[nim-wasm] wasm    : $absOutWasm"
Write-Host "[nim-wasm] manifest: $manifestPath"
Write-Host "[nim-wasm] memory  : initial=${InitialMemoryMb}MB max=${MaximumMemoryMb}MB stack=${StackSizeMb}MB"

Write-Host "[nim-wasm] exports : " ($requiredExports -join ", ")
