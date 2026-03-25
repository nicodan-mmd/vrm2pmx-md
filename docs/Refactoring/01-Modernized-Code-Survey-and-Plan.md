# Modernized Code Refactoring Survey and Plan

Updated: 2026-03-25
Status: Draft (survey completed, implementation not started)

## Scope Policy (Important)

This refactoring track focuses on modernized Web/Wasm code and excludes the original forked desktop conversion core.

In scope:

- frontend/src/**
- backend/app/** (if needed)
- frontend scripts/config only when directly required by feature split

Out of scope (fork-origin side):

- src/** (legacy desktop Python implementation)
- mmd/**, module/**, service/** under legacy tree
- legacy GUI/form pipeline and related conversion internals

## Survey Summary

Largest files in scoped areas:

1. frontend/src/App.tsx: 2143 lines
2. frontend/src/app.css: 655 lines
3. frontend/src/services/convertClient.ts: 199 lines
4. frontend/src/workers/convertWorker.ts: 196 lines
5. backend/app/main.py: 118 lines

Primary hotspot is App.tsx.

## App.tsx Responsibility Inventory

The current App.tsx mixes the following responsibilities:

1. Domain utility logic
   - quality signal detection and Sentry reporting
   - GLB chunk parsing/editing and upper-arm pose rewrite
   - PMX preview lighting calculations

1. Runtime orchestration
   - conversion submit/cancel/download flow
   - worker log/progress handling
   - backend fallback + user-friendly error mapping

1. 3D preview lifecycle
   - VRM preview scene setup and teardown
   - PMX preview scene setup and teardown
   - camera/orbit sync and grid toggles

1. UI state and persistence
   - mode, pose slider, log visibility, error reporting consent
   - localStorage hydration/persistence

1. View rendering
   - main page layout
   - footer actions (About, reset, reporting)
   - modals and diagnostics panel

## Refactoring Objectives

1. Reduce App.tsx from ~2143 lines to under 700 lines.
2. Keep behavior unchanged during phase 1 (structure-first refactor).
3. Split by feature boundary first, then split by technical layer where useful.
4. Introduce strict boundaries: UI component, hook/orchestrator, pure utility.

## Proposed Target Structure

```text
frontend/src/
  features/
    convert/
      hooks/
        useConvertFlow.ts
        useQualitySignals.ts
      services/
        convertOrchestrator.ts
      types/
        convertUiState.ts
    preview/
      hooks/
        useVrmPreview.ts
        usePmxPreview.ts
        useOrbitSync.ts
      lib/
        pmxLight.ts
        glbPose.ts
      components/
        PreviewGrid.tsx
        PreviewTools.tsx
    settings/
      hooks/
        useUiSettings.ts
        useErrorReportingConsent.ts
  components/
    forms/
      ConvertForm.tsx
      FilePickerRow.tsx
    panels/
      LogPanel.tsx
    layout/
      AppFooter.tsx
  styles/
    base.css
    preview.css
    form.css
    footer.css
    modal.css
  App.tsx
```

## Step-by-Step Execution Plan

### Phase 0: Safety Net

1. Add snapshot-level smoke checks for key handlers (convert, cancel, reset, download).
2. Lock regression checklist for:
   - VRM preview
   - conversion success/failure
   - log panel behavior
   - About and error-reporting dialogs

### Phase 1: Pure Utility Extraction (Low Risk)

Extract out of App.tsx into pure modules:

1. quality/sentry helpers
   - detectQualityRiskSignals
   - normalizeQualitySignalCode
   - reportQualitySignals

1. glb pose helpers
   - parseGlbChunks
   - buildGlbBuffer
   - poseUpperArmsInGlb and related helpers

1. pmx light helpers
   - computePmxLightPreset
   - applyPmxLightTuning

Acceptance:

- App.tsx line count significantly reduced
- no UI behavior difference

### Phase 2: Hook-Level Orchestration Split (Medium Risk)

1. useConvertFlow.ts
   - onConvert/onCancel/onDownload
   - progress + status transitions
   - worker/backend fallback coordination

1. useUiSettings.ts
   - mode/log/grid/orbit/pose persistence
   - hydration and storage writeback

1. useErrorReportingConsent.ts
   - consent state + prompt logic

Acceptance:

- side effects isolated in hooks
- App.tsx mostly wiring + render

### Phase 3: UI Component Decomposition (Medium Risk)

1. extract LogPanel component
2. extract ConvertForm component
3. extract PreviewGrid component
4. extract AppFooter component

Acceptance:

- each component has clear props contract
- App.tsx mainly composes components

### Phase 4: CSS Split by Feature (Low to Medium Risk)

Split app.css into:

1. styles/base.css
2. styles/preview.css
3. styles/form.css
4. styles/footer.css
5. styles/modal.css

Acceptance:

- no visual regressions (desktop/mobile)
- style ownership aligns with component boundaries

## Order of Work (Recommended PR Slices)

1. PR-1: Extract pure utilities only
2. PR-2: Extract state hooks only
3. PR-3: Extract UI components only
4. PR-4: CSS split and naming cleanup
5. PR-5: optional typing hardening and dead code cleanup

## Risks and Mitigations

1. Risk: hidden side effects while moving preview logic
   - Mitigation: move pure helpers first, hooks second, UI last

1. Risk: localStorage hydration timing regressions
   - Mitigation: keep hydration guard and add explicit test cases

1. Risk: conversion flow regressions in cancel/fallback
   - Mitigation: preserve state machine transitions before any API shape changes

## Done Criteria

1. App.tsx <= 700 lines
2. app.css split into >= 4 focused files
3. all existing manual conversion scenarios pass
4. no new Problems tab errors
5. behavior parity confirmed for:
   - convert success
   - convert error
   - cancel in progress
   - VRM preview reload
   - About/version footer actions

## First Concrete Tasks (Next 1-2 sessions)

1. Create features/preview/lib/glbPose.ts and move GLB pose helper block.
2. Create features/preview/lib/pmxLight.ts and move PMX light tuning block.
3. Create features/convert/hooks/useQualitySignals.ts and move quality signal helpers.
4. Replace moved implementations in App.tsx with imports only.
5. Verify with local build + Problems tab.
