# Rust Runtime Assets

This directory is reserved for future Rust/Wasm runtime assets used by the browser worker.

## Current state

- Manifest file exists as a placeholder contract.
- No executable Rust/Wasm binary is shipped yet.

## Planned files

- vrm2pmx_rust_manifest.json
- vrm2pmx_rust_bg.wasm
- vrm2pmx_rust.js or equivalent loader bridge

## Notes

- The worker currently uses the manifest to distinguish "runtime assets missing" from "bridge not implemented".
- Once the real runtime is added, update the manifest rather than changing the fetch path.
