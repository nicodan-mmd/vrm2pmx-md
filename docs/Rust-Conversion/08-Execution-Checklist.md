# Execution Checklist

- Create a branch-only Rust validation path.
- Add and persist a Rust checkbox in the frontend.
- Propagate requested mode through client and worker logging.
- Add explicit placeholder fallback behavior.
- Validate no regression in Wasm conversion.
- Prepare the worker boundary for a future Rust/Wasm engine.
- Revisit checkbox visibility after validation stabilizes.

## User Notification Gates (3)

- Gate 1: notify user after stage 03 and request external-app loadability check.
- Gate 2: notify user after stage 06 and request external-app loadability check.
- Gate 3: notify user after stage 09 and request external-app loadability check.