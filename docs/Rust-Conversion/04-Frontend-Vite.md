# Frontend / Vite Plan

## UI

- Add a `Rust` checkbox next to `Log` for validation builds.
- Keep it explicit and user-controlled during development.
- Plan to hide the checkbox after the Rust path stabilizes.

## State

- Persist the Rust toggle in local storage with the other UI settings.
- Resolve the requested mode at convert time rather than replacing the existing mode selector logic.

## Logging

- Emit a console info event when Rust mode is requested.
- Emit another event for the actual mode used.
- If Rust is not yet active, log the fallback reason explicitly.

## Worker Behavior

- Route `requestedMode=rust` through the same client entrypoint.
- Keep placeholder fallback behavior simple until a real Rust worker exists.