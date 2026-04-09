# Nim Wasm Execution Plan

## Goal

- Run Nim conversion core in browser (frontend worker) without backend dependency.
- Keep current Nim backend route as fallback while frontend route is stabilized.
- Preserve compatibility with existing mode contract: requestedMode / usedMode / fallbackReason.

## Key Decision

- Primary route: Nim -> C backend -> Emscripten -> WebAssembly.
- Not a direct "replace current binary" path; split host-dependent code from conversion core first.

## Why Emscripten

- Most practical path for browser-targeted Nim runtime today.
- Allows explicit control over exported functions and memory model.
- Easier to integrate with existing TypeScript worker contract than custom JS glue from scratch.

## Scope Split

### Core Layer (portable)

- Input: VRM/GLB bytes, options bytes.
- Output: PMX bytes (or ZIP bytes in later phase).
- No file-system access, no environment variable dependency, no process spawn.

### Host Layer (platform)

- Current CLI handling, file path resolution, temp file operations.
- Backend-specific packaging behavior.
- Keep this for native executable route.

## Milestones

### M0: Interface Freeze

- Define C ABI-compatible exported functions:
  - init()
  - alloc(size)
  - free(ptr)
  - convert(ptrIn, lenIn, ptrOutMeta)
- Define output metadata struct (ptr, len, status, error_code).
- Define error code table used by frontend worker logs.

### M1: Browser Build Spike

- Build minimal wasm artifact from Nim core with Emscripten.
- Run one known-good model (e.g. RingRing) in worker.
- Verify deterministic output length/hash across repeated runs in same session.

### M2: Frontend Worker Integration

- Add Nim Wasm worker client next to current workers.
- Keep convert mode behavior:
  - requested nim -> try nim-wasm
  - on failure -> fallback wasm(pyodide) or backend (configurable)
- Add telemetry fields for usedMode=fallback reasons.

### M3: Packaging + Texture Strategy

- Move current texture extraction/packaging logic needed for preview into frontend-side route.
- Ensure PMX preview receives same asset set shape as existing flow.

### M4: Quality + Perf Gate

- Run existing multi-model probe subset in frontend runtime environment.
- Compare against baseline metrics:
  - success rate
  - first_diff section trend
  - conversion latency (median/p95)

## Flatty / BinaryLang Positioning

- Do not introduce at M0/M1.
- Evaluate after first end-to-end wasm convert is stable.
- Candidate usage:
  - Internal metadata transport between worker and UI.
  - Compact binary option payloads to reduce marshal overhead.
- Exit criteria for adoption:
  - measurable latency reduction in worker boundary cost,
  - no regression in determinism/debuggability.

## Risks

- Nim stdlib features used in current path may not be wasm-friendly.
- Memory pressure in browser for large VRM models.
- Binary compatibility drift between native Nim and wasm Nim builds.

## Immediate Next Tasks

1. Extract pure conversion entrypoint from current Nim source (bytes in/out).
2. Add minimal C ABI wrapper module for wasm export.
3. Add reproducible local build script for wasm artifact generation.
4. Add a tiny frontend worker spike that loads wasm and calls a no-op/export test.
