# Browser Contract

## Input

- File bytes from VRM or GLB input
- Source filename
- Requested conversion mode
- Abort signal

## Output

- ZIP blob with PMX resources
- File extension
- Actual used mode
- Optional fallback reason
- Progress events
- Log events

## Required Invariants

- The frontend must be able to distinguish requested mode from actual used mode.
- Any fallback must be visible to both the UI and console log stream.
- Errors must remain user-readable even if the engine changes.

## Rust-Specific Rule

- The Rust path should eventually match the existing ZIP-based output contract.
- Temporary placeholders are acceptable during the branch-only validation phase.

## Runtime Manifest Contract

- Public path: `frontend/public/rust/vrm2pmx_rust_manifest.json`
- Required fields: `name`, `version`, `status`, `entryJs`, `entryWasm`, `capabilities`
- Missing manifest means runtime assets are unavailable.
- Present manifest with empty entries means asset contract exists but execution bridge is still incomplete.