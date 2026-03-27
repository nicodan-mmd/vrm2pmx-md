# Rust Conversion Notes

This directory tracks the plan for introducing a Rust-based conversion path into vrm2pmx without replacing the current Python path upfront.

## Goals

- Add an experimental Rust conversion mode behind an explicit frontend toggle.
- Keep the current Python/Wasm route intact as the safe fallback path.
- Stabilize the browser-facing input/output contract before porting heavy logic.
- Treat PMX Tailor v2 integration as a separate post-conversion stage.
- Avoid user-facing regressions while validating Rust quality and performance.

## Recommended Branch Flow

- Branch A: feature/rust-conversion-poc
- Branch B: feature/rust-wasm-core
- Branch C: feature/rust-worker-validation
- Branch D: feature/pmx-tailor-v2-postprocess

## Document Index

- 01-Roadmap.md: phases, milestones, and gates
- 02-Architecture.md: target architecture and boundaries
- 03-Browser-Contract.md: browser runtime input/output contract
- 04-Frontend-Vite.md: UI, worker, and toggle behavior
- 05-Test-Strategy.md: comparison and regression strategy
- 06-Local-Run.md: local development and verification flow
- 07_Risks-Diagnostics.md: risks, diagnostics, and rollback rules
- 08-Execution-Checklist.md: step-by-step implementation checklist
- 09-Phase0-Inventory.md: existing Python path inventory for port planning
- 10-PMX-Tailor-v2-Coordination.md: post-conversion integration boundary
- Comparisons/README.md: continuous comparison workflow and record format
- Comparisons/CHECKPOINTS.md: user verification checkpoints (3 times)

## Notes

- The initial Rust mode can ship as an experimental path with explicit fallback.
- The Rust checkbox is for validation only and can be hidden after stabilization.
- PMX Tailor v2 should be integrated after the Rust conversion contract is stable.
- Keep per-change comparison records under Comparisons/records for rollback and audit.

## User Verification Checkpoints

- Checkpoint 1: after stage 03 (contract and mode visibility are stable)
- Checkpoint 2: after stage 06 (local run flow and artifacts are stable)
- Checkpoint 3: after stage 09 (phase-0 inventory-based parity check is stable)
- At each checkpoint, notify the user to validate loadability with external applications.