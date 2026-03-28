# Rust GLB Parse Record

## Meta

- Date: 2026-03-28
- Commit: pending-local
- Branch: feature/rust-conversion-poc
- Stage: Rust GLB header + JSON chunk parse
- Change type: first real Rust logic

## What changed

- Replaced `vrm2pmx_rust_stub_version` / `vrm2pmx_rust_convert_stub` with a real API surface.
- Added `vrm2pmx_version()` — returns runtime stub version.
- Added `vrm2pmx_alloc(size)` / `vrm2pmx_free(ptr, size)` — establishes the Wasm heap memory-sharing contract with JS.
- Added `vrm2pmx_parse_glb_json_len(ptr, len)` — pure Rust GLB header validation and JSON chunk size detection.
- Updated the JS loader bridge to pass VRM bytes through the alloc/free boundary and call the parse function.
- Updated manifest status to `wasm-glb-parse` and capabilities to reflect new API surface.
- Wasm asset grew from 476 bytes to 9621 bytes.

## Validation

- Rust wasm build: pass
- Frontend build: pass
- PWA precache size: 1602 KiB

## Expected runtime behavior

- Requested mode: rust
- Manifest lookup: found
- Loader bridge import: found
- Wasm fetch + instantiate: pass
- VRM input bytes passed to Rust heap via alloc/write/free
- GLB parse result: jsonChunkSize reported in error message
- First Rust result: `RUST_CONVERT_NOT_IMPLEMENTED` (with JSON chunk size logged)
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: unchanged from previous stage
- External-app validation: not requested at this stage

## Decision

- Status: pass
- Reason: end-to-end Wasm memory boundary now established; Rust can read the VRM file and validate its structure
- Next action: expose JSON chunk bytes to JS (or implement the first PMX structure extraction step in Rust)
