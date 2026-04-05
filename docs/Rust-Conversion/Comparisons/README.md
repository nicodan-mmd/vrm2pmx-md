# Comparison Records

This folder stores reproducible comparison outputs while Rust conversion is developed.

## Goal

Track whether conversion outputs remain equivalent for MMD usage, not whether bytes are identical.

## Folder layout

- records/: per-run markdown and JSON summaries
- artifacts/: optional extracted outputs and diff payloads

## Per-change workflow

1. Run baseline conversion (Python/Wasm path).
2. Run Rust-requested conversion.
3. Record timing, requested/used mode, and fallback reason.
4. Validate MMD-equivalence checks.
5. Save a markdown report and a JSON summary under records/.

## Checkpoint Notifications

- Notify user at stage 03, stage 06, and stage 09.
- At each notification, ask for external-app readability confirmation.
- Save that confirmation result in the report under MMD-equivalence checks.

## Suggested pass criteria

- No load error in MMD-compatible pipeline
- Same practical appearance/rig behavior in preview checks
- Structural counts within expected range (bones/materials/textures)
- Any fallback is explicitly logged

## Naming

- Markdown: `YYYYMMDD_{sample}_{env}_comparison.md`
- JSON: `YYYYMMDD_{sample}_{env}_comparison.json`
