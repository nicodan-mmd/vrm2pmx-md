# PWA Migration Execution Checklist

Updated: 2026-03-25
Owner: frontend
Branch: feature/pwa-migration-prep

## Scope Guard

- [ ] Keep conversion behavior unchanged while introducing PWA baseline.
- [ ] Do not include full-offline support until scope is explicitly approved.
- [ ] Ship Phase 1 first, then evaluate with regression checks.

## Phase 1: Installable App Baseline

### Planning

- [ ] Select Vite PWA plugin and version.
- [ ] Define manifest fields (`name`, `short_name`, `icons`, `theme_color`, `display`).
- [ ] Decide service worker registration timing and update policy.

### Implementation

- [ ] Add plugin config in Vite.
- [ ] Add manifest file and icon set.
- [ ] Add service worker registration entry point.
- [ ] Add head meta tags for installability/mobile support.

### Verification

- [ ] Confirm install prompt appears in supported browsers.
- [ ] Confirm app launches standalone after install.
- [ ] Confirm no regression in VRM -> PMX conversion flow.

## Phase 2: Conversion-Aware Caching

### Design

- [ ] Classify runtime assets: static, versioned runtime, worker assets, py_src files.
- [ ] Define cache strategy per class (precache vs runtime cache).
- [ ] Define cache key/versioning rules.

### Implementation

- [ ] Add cache rules for `public/py_src/` and manifest.
- [ ] Add cache rules for worker runtime artifacts.
- [ ] Add invalidation and cleanup policy on version update.

### Verification

- [ ] Validate refresh/reopen behavior after deployment update.
- [ ] Validate no stale cache mismatch in conversion runtime.
- [ ] Validate first-load and warm-load behavior.

## Phase 3: Offline Policy

### Decision

- [ ] Decide target level: partial offline or full offline.
- [ ] Decide Pyodide dependency strategy (CDN vs bundled/local).
- [ ] Set acceptance criteria for offline behavior.

### Validation

- [ ] Test offline startup behavior against agreed scope.
- [ ] Test offline conversion behavior against agreed scope.
- [ ] Document limitations clearly.

## Phase 4: QA and Release Readiness

- [ ] Regression test conversion and preview pipelines.
- [ ] Validate update lifecycle (new SW activation and stale tab behavior).
- [ ] Prepare release notes and user-facing notes.
- [ ] Update docs with supported browser/platform matrix.

## PR Split Plan

- [ ] PR1: Phase 1 only (installable baseline)
- [ ] PR2: Phase 2 cache policy and invalidation
- [ ] PR3: Phase 3 offline scope implementation (optional)
- [ ] PR4: QA hardening and documentation

## Done Criteria

- [ ] Installability works on agreed target browsers.
- [ ] Conversion flow remains stable with no functional regressions.
- [ ] Cache update behavior is predictable and documented.
- [ ] Known limitations and support scope are explicitly documented.
