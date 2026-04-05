# Phase 0 Inventory

## Existing Path

- Frontend prepares the input file and requests conversion.
- Wasm worker runs Python conversion through Pyodide.
- Output is returned as ZIP bytes for preview and download.

## Inventory Focus

- Mode selection and fallback plumbing
- Worker progress and log events
- ZIP output assumptions
- PMX preview assumptions

## Porting Priority

- First port boundaries and contracts.
- Then port heavy transformation stages.
- Leave optional post-processing out of the initial Rust scope.
