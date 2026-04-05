# Rust Worker Boundary Record

## Meta

- Date: 2026-03-28
- Branch: main
- Stage: Rust worker boundary
- Change type: frontend scaffolding

## What changed

- Added a dedicated Rust worker client boundary.
- Added a dedicated Rust worker module.
- Rust-requested mode now attempts the Rust worker first.
- Current Rust worker returns an explicit not-implemented error.
- The convert client falls back to Wasm after that error.

## Validation

- Type errors: none
- Frontend build: pass
- Build artifact: dist/assets/rustWorker-\*.js emitted

## Expected runtime behavior

- Requested mode: rust
- First attempt: rust worker
- Current result: RUST_CONVERT_NOT_IMPLEMENTED
- Final used mode: wasm

## MMD-equivalence checks

- Output comparison: not run in automation for this stage
- External-app validation: pending next executable output checkpoint

## Decision

- Status: pass
- Reason: boundary is in place and normal frontend build still succeeds
- Next action: start moving real conversion responsibility into the Rust path and record the next comparison result
