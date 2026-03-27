# Local Run

## Current Scaffold Flow

- Start the frontend.
- Enable the Rust checkbox.
- Run a conversion sample.
- Confirm the log/console reports requested mode and actual used mode.

## Future Rust Engine Flow

- Run `npm run build:rust-runtime` in `frontend/`.
- Build the Rust/Wasm artifact.
- Ensure the worker can fetch and initialize it.
- Re-run the same sample set and compare outputs.

## Current Placeholder Asset Flow

- Keep a placeholder manifest under `frontend/public/rust/`.
- Run `npm run build:rust-runtime` to refresh the stub Wasm asset.
- Confirm Rust-requested mode reports whether the manifest, loader, and Wasm asset are present.
- Once real assets exist, replace the stub entry points with actual runtime paths.