# Rust Conversion Test Strategy

## Baseline

- Treat current Python/Wasm conversion output as the baseline.
- Compare requested mode, used mode, and output ZIP validity.

## Validation Layers

- Unit-level checks for mode resolution and fallback behavior.
- Worker integration checks for progress/log event flow.
- Snapshot or sample-model checks for output existence and preview viability.

## Acceptance Criteria

- Rust toggle does not break current Wasm conversion.
- Console logs clearly show whether Rust was requested and whether it actually ran.
- Fallback path is deterministic and user-visible.
