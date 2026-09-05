# Review fix checklist

Scope: the September repository reviews and `review-2026-09-slideshow-ipad.md`.
Already committed in `fff8251` / `56f9c75`: progressive swipe preview and cancellation,
decoded-photo update readiness, retained presentation, bounded update retries with
cooldown, and version-fetch deadlines. This checklist tracks the remaining work;
items are complete only after their regression checks pass.

- [x] Non-destructive album/sidecar discovery, including sidecar-like photo names.
- [x] Geotag draft/write and folder-load race protection for GPS and lenses.
- [x] Explicit geotag camera-offset override and match preview.
- [x] Geotag compiler libraries aligned with shared code.
- [x] Shared database refresh completion ordering.
- [x] Search database identity invalidation and combined semantic/colour readiness.
- [x] Slideshow core/embedding refresh promotion together.
- [x] Cross-fade backtracking without duplicate layer keys or a second load event.
- [x] Encoded album filter links.
- [x] Wake-request generations, deadlines, late-sentinel cleanup and released checks.
- [x] Bounded visible wake retries, honest settling and persistent error diagnostics.
- [x] Heartbeat gap detection before every write.
- [x] Continuous, visibility-aware runtime health recovery retaining the photograph.
- [x] Persistent-shell slideshow entry points preserving query settings.
- [x] Deliberate shell update action and version diagnostics.
- [x] iPad-emulated WebKit slideshow fault tests in CI.
- [x] Full relevant lint, typecheck, unit, integration and browser verification.

Physical iPad Auto-Lock/OS eviction and an overnight device soak cannot be proved
with browser emulation; report that boundary explicitly rather than treating a
synthetic wake-lock shim as hardware verification. Controller extraction should
support these lifecycle fixes, not become an unrelated broad rewrite.

## Implementation notes

The wake-retry action is now a small, touch-sized recovery pill, not a full-screen
gate. A refused request remains actionable without blocking photographs or the
diagnostics controls. The frontend-design skill guided that restrained treatment.
Detailed wake-request errors coalesce through repeated retry cycles, preserving
the incident's onset instead of evicting it from the capped overnight log.

The geotag tool ignores old folder/track responses and clears only the exact draft
that a successful write submitted. It retains newer GPS/lens edits and asks before
discarding drafts on navigation. The offset override changes matching instants,
never the displayed camera wall clock; matches are previewed before assignment.
Compatible dependency updates also removed five audit findings from its lockfile.

## Verification

- Main app: lint, app/portable/test typechecks and formatting passed.
- Jest: 267 suites / 2,852 tests passed in one permission-enabled run. Jest reported
  a worker teardown warning but exited successfully; no test failures remained.
- Geotag: 8 files / 37 tests, independent typecheck and production build passed.
- Fresh production E2E build passed. Browser verification: 34 passed / 3 existing
  smoke skips (28 Chromium passes, six iPad-emulated WebKit passes). Coverage
  includes the real offline-PWA restart, gestures, core smoke journeys, blank
  update recovery and loss of runtime health reports. Both injected failures
  retain the last photograph and recover with zero parent wake-lock releases.

One local WebKit limitation was isolated during verification: an iPad-emulated
album containing a native video element could stop responding, including with
application JavaScript disabled; removing that element from the script-disabled
response restored responsiveness. A photo-only album loaded normally. The shell
context-link test therefore uses a minimal destination document to prove real
outer-window navigation independently of album/video rendering. Chromium smoke
retains the real album/video journey; the existing CI WebKit smoke case remains
unchanged. This is not evidence that a physical iPad shares the local runner issue.

At the end of this verification pass, these follow-up changes remained local and
uncommitted; publication was a separate follow-up step.
An already-open PWA needs one deliberate shell reload/reopen to install the new
parent lifecycle code; child-only code updates cannot replace their parent.
