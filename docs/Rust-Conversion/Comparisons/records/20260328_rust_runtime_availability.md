# Rust Runtime Availability Record

## Meta

- Date: 2026-03-28
- Branch: main
- Stage: Rust runtime availability layer
- Change type: frontend scaffolding

## What changed

- Added a Rust runtime availability loader.
- Rust worker now checks for a future runtime manifest before failing.
- Error code now distinguishes between missing runtime assets and missing execution bridge.
- Rust manifest URL is emitted into worker logs for diagnostics.

## Validation

- Type errors: none
- Frontend build: pass
- Build artifact: dist/assets/rustWorker-\*.js emitted

## Expected runtime behavior

- Requested mode: rust
- Rust worker checks `rust/vrm2pmx_rust_manifest.json`
- Current expected result: runtime unavailable, then fallback to wasm
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: unchanged from previous stage
- External-app validation: not requested at this stage

## Decision

- Status: pass
- Reason: the runtime loading boundary is now defined and diagnostics are more precise
- Next action: define manifest schema and placeholder asset layout under frontend public path
