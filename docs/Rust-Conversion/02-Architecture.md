# Rust Conversion Architecture

## High-Level Shape

- Frontend UI selects the requested mode.
- A worker-side orchestrator resolves the actual execution path.
- Rust/Wasm and Python/Wasm share the same browser contract where possible.
- Output remains a ZIP containing PMX resources.

## Separation Rules

- UI mode selection must not depend on Rust implementation details.
- Worker orchestration owns fallback and progress reporting.
- Rust code should target pure data transformation, not frontend concerns.
- PMX Tailor v2 stays outside the initial Rust conversion core.

## Initial Execution Rule

- If Rust is requested during the scaffold phase, log the request explicitly.
- If no Rust engine is available yet, fall back to the existing Wasm path with a clear reason.

## Future Target

- A dedicated Rust/Wasm worker path that can be invoked through the same client API.
- Structured diagnostics for requested mode, used mode, elapsed time, and fallback reason.
