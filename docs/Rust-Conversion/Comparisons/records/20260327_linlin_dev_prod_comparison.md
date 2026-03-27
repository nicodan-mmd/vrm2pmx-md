# Rust Conversion Comparison Report

## Meta

- Date: 2026-03-27
- Commit: working tree
- Branch: main
- Environment: dev and prod (frontend)
- Input file: D:/Users/maedashingo/Downloads/MMD/VRoid/Booth/プロレスラー リンリン/プロレスラー_リンリン.vrm

## Run setup

- Warmup runs: unknown
- Measured runs: 1 each (user-provided snapshot)
- Requested mode: python baseline vs rust requested toggle
- Expected fallback behavior: rust request currently falls back to wasm path

## Timing summary

- dev python sec: 48
- dev rust requested sec: 49
- prod python sec: 50
- prod rust requested sec: 46

## Mode and fallback

- Requested mode seen in log: rust (expected)
- Used mode seen in log: wasm (expected for current scaffold)
- Fallback reason: Rust conversion mode is not implemented yet in this build. Falling back to Wasm.

## MMD-equivalence checks

- Load success: pending manual confirmation
- Visual equivalence note: pending
- Bone/material/texture count note: pending
- Issues: none reported yet

## Decision

- Status: warn
- Reason: timing numbers collected, but equivalence checks not yet completed for this run
- Next action: run MMD-equivalence checklist and export structural counts into artifact JSON
