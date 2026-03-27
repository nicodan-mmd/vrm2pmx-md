# Local Run

## Current Scaffold Flow

- Start the frontend.
- Enable the Rust checkbox.
- Run a conversion sample.
- Confirm the log/console reports requested mode and actual used mode.

## Future Rust Engine Flow

- Build the Rust/Wasm artifact.
- Ensure the worker can fetch and initialize it.
- Re-run the same sample set and compare outputs.

## Current Placeholder Asset Flow

- Keep a placeholder manifest under `frontend/public/rust/`.
- Confirm Rust-requested mode reports whether the manifest is present.
- Once real assets exist, replace empty `entryJs` and `entryWasm` with actual runtime paths.