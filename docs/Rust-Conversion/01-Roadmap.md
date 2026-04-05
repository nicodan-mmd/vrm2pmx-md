# Rust Conversion Roadmap

## Phase 0: Contract Lock

- Fix the current browser-facing conversion I/O contract.
- Define how requested mode, actual mode, and fallback reason are reported.
- Keep existing Python/Wasm conversion as the baseline.

## Phase 1: Validation Scaffold

- Add an explicit Rust checkbox in the frontend next to Log.
- Propagate `requestedMode=rust` through the frontend and logging pipeline.
- Keep conversion execution on the existing Wasm route with explicit placeholder fallback.

## Phase 2: Rust Wasm Core POC

- Introduce a Rust/Wasm worker path that can accept the same browser contract.
- Start with narrow responsibilities such as parsing, mesh transforms, or archive handling.
- Return structured diagnostics that match the existing worker contract as much as practical.

## Phase 3: Feature Expansion

- Expand Rust coverage to the dominant hot paths.
- Compare output ZIPs and PMX quality against Python output.
- Add confidence gating before switching any default behavior.

## Phase 4: Optional Defaulting

- Consider `auto` behavior that tries Rust first and falls back to Python/Wasm.
- Keep the explicit checkbox available until validation confidence is high.

## Gate Conditions

- No regression in normal Wasm conversion.
- Requested mode and actual mode are always visible in logs/telemetry.
- Rust path failures are recoverable without breaking conversion UX.
