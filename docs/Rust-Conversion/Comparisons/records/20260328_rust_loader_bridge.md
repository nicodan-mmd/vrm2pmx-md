# Rust Loader Bridge Record

## Meta

- Date: 2026-03-28
- Commit: 04b7cdf
- Branch: feature/rust-conversion-poc
- Stage: Rust loader bridge
- Change type: frontend runtime loading

## What changed

- Added a manifest-driven bridge loader at `frontend/src/rust/bridge.ts`.
- Added placeholder runtime bridge entry `frontend/public/rust/vrm2pmx_rust_loader.js`.
- Updated the Rust worker to load `manifest -> entryJs -> initialize()` before conversion.
- Refined runtime failure classification so missing bridge and missing Wasm asset are distinct.

## Validation

- Type errors: none
- Frontend build: pass
- Runtime worker asset emitted: pass

## Expected runtime behavior

- Requested mode: rust
- Manifest lookup: found
- Loader bridge import: found
- Bridge initialize result: `RUST_WASM_UNAVAILABLE`
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: unchanged from previous stage
- External-app validation: not requested at this stage

## Decision

- Status: pass
- Reason: the worker now consumes the manifest contract and reaches a precise "no Wasm asset yet" boundary instead of a generic not-implemented path
- Next action: add a real Wasm asset and implement the first callable Rust bridge surface
