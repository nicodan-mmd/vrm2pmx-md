# Risks and Diagnostics

## Risks

- Rust mode appears available before the actual engine is ready.
- Browser worker startup cost masks performance improvements.
- Output contract drift between Rust and Python paths.
- PMX Tailor v2 integration adds unrelated complexity too early.

## Mitigations

- Log requested and used mode separately.
- Keep fallback reason explicit.
- Preserve Python/Wasm as the reference path.
- Delay PMX Tailor v2 coupling until conversion contract is stable.