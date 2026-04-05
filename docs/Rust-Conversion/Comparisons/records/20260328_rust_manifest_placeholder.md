# Rust Manifest Placeholder Record

## Meta

- Date: 2026-03-28
- Branch: main
- Stage: Rust manifest placeholder
- Change type: frontend asset contract

## What changed

- Added `frontend/public/rust/` directory.
- Added placeholder manifest `vrm2pmx_rust_manifest.json`.
- Added runtime manifest schema validation in the frontend runtime loader.
- Documented the manifest contract in Rust migration docs.

## Validation

- Type errors: none
- Frontend build: pass
- Runtime worker asset emitted: pass

## Expected runtime behavior

- Requested mode: rust
- Manifest lookup: found
- Current first result: `RUST_CONVERT_NOT_IMPLEMENTED`
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: unchanged from previous stage
- External-app validation: not requested at this stage

## Decision

- Status: pass
- Reason: asset path and manifest contract are now fixed for future Rust runtime drops
- Next action: implement the loader bridge that consumes `entryJs` and `entryWasm`
