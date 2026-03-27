# Rust Wasm Stub Record

## Meta

- Date: 2026-03-28
- Commit: pending-local
- Branch: feature/rust-conversion-poc
- Stage: Rust Wasm stub
- Change type: frontend runtime asset

## What changed

- Added a minimal Rust crate under `frontend/rust-runtime/` that builds to `wasm32-unknown-unknown`.
- Added `npm run build:rust-runtime` to compile and copy the Wasm asset into `frontend/public/rust/`.
- Updated the manifest so `entryWasm` points to a real Wasm file.
- Updated the loader bridge to fetch and instantiate the Wasm stub before calling `convert()`.

## Validation

- Rust stub build: pass
- Frontend build: pass
- PWA precache entries: 15

## Expected runtime behavior

- Requested mode: rust
- Manifest lookup: found
- Loader bridge import: found
- Wasm instantiate: pass
- First Rust result: `RUST_CONVERT_NOT_IMPLEMENTED`
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: unchanged from previous stage
- External-app validation: not requested at this stage

## Decision

- Status: pass
- Reason: the Rust path now proves end-to-end asset loading through manifest, JS bridge, and real Wasm stub while still falling back safely
- Next action: replace the stub export surface with the first real conversion-oriented API