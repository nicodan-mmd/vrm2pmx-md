# PWA Migration Notes

Updated: 2026-03-24
Status: On hold (postponed)

## Preparation Artifacts

- Execution checklist: `docs/PWA-Migration/01-Execution-Checklist.md`
- Use this checklist when restarting implementation on a dedicated branch.

## Purpose

- Keep current PWA discussion in one place so implementation can resume smoothly later.
- Define a staged plan that minimizes regression risk for the VRM to PMX conversion flow.

## Current Decision

- PWA work is postponed for now.
- Continue with current features first, and resume PWA in a dedicated phase.

## Why This Is Medium to Large Work

- This project is not a simple static UI app. It includes Pyodide, worker-based conversion, and synced Python source files.
- PWA behavior needs to be aligned with runtime asset loading and cache invalidation strategy.
- Offline expectations need a clear scope definition (partial offline vs full offline).

## Existing Frontend Baseline

- Vite + React frontend is already in place.
- No PWA plugin or service worker registration is currently enabled.
- Conversion flow relies on worker and runtime-fetched assets (including py_src manifest/files).

## Proposed Phases

### Phase 1: Installable App Baseline

Goal:
- Make app installable with basic PWA metadata and service worker setup.

Tasks:
1. Add PWA plugin for Vite.
2. Add web app manifest (name, short_name, icons, theme_color).
3. Add service worker registration in app entry.
4. Add basic head metadata (theme color, mobile-related tags).

Expected result:
- App can be installed on supported browsers.
- Static assets are managed by PWA build pipeline.

### Phase 2: Conversion-Aware Caching

Goal:
- Stabilize runtime file availability for conversion workflow.

Tasks:
1. Define cache policy for py_src manifest and synced Python files.
2. Ensure worker-related runtime files are included in caching strategy.
3. Add cache versioning and invalidation rules.

Expected result:
- Revisit/startup reliability improves.
- Reduced runtime fetch failures due to stale cache mismatch.

### Phase 3: Offline Scope Definition and Implementation

Goal:
- Decide and implement realistic offline behavior.

Tasks:
1. Decide target: partial offline or full offline.
2. Evaluate Pyodide dependency strategy (CDN vs bundled/local).
3. Validate impact on bundle size and first-load time.

Expected result:
- Clear offline support statement and tested behavior.

### Phase 4: QA and Release Readiness

Goal:
- Ship safely without breaking conversion behavior.

Tasks:
1. Validate install/update lifecycle on major targets.
2. Run regression checks for conversion and preview workflows.
3. Prepare release notes and README updates.

Expected result:
- Predictable updates and stable user experience.

## Open Questions (To Decide Before Resuming)

1. What is the required offline level?
2. Is larger app size acceptable if runtime assets are bundled?
3. Should update prompt UX be shown when a new version is available?
4. What browser/platform support is mandatory for release?

## Suggested Re-Entry Plan

When resuming PWA work:
1. Start from Phase 1 only.
2. Merge and verify in small PRs.
3. Move to Phase 2 after install/update behavior is confirmed.
4. Do Phase 3 only after offline scope is agreed.

## Done Criteria for PWA Track (Draft)

- Installable app behavior works on target browsers.
- Conversion workflow remains stable after PWA introduction.
- Cache update behavior is documented and reproducible.
- README includes scope and known limitations.
