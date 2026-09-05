# Repository review: slideshow reliability and iPad PWA

Reviewed 5 September 2026, against `f73dd7c` plus the swipe changes described below. The user primarily runs the slideshow as an iPad Home Screen PWA. The exact iPadOS version and whether the reported black screen is device sleep or a blank application remain unknown. No physical iPad was available for testing.

## Implemented: swipe presentation

The neighbour preview now brightens with viewport-relative drag distance, capped at 42% opacity, with subtle scale and directional parallax. It remains mounted during release and fades away smoothly. Cancelled gestures spring back, including browser-owned pointer cancellation. Swiping backwards with no history no longer sends the only photograph off-screen. Reduced-motion mode removes the preview's scale and translation.

Regression tests cover progressive reveal, retained release state, cancellation and the no-history boundary. The existing browser gesture test now checks computed opacity and scale. The frontend-design skill informed restrained motion that keeps the photographs dominant, rather than additional controls or decoration.

## Highest-priority findings

### P1 — The image timeout can replace a good photograph with an unloaded image

Location: `src/screens/slideshow/SlideshowScreen.tsx`, the 6-second safety-net effect near line 2494; `src/util/slideshowCrossfade.ts`, `revealLayers`. The remix reveal hook has a similar timeout-based readiness escape hatch.

If the next request hangs, the timeout calls `revealLayers` despite the replacement never loading or decoding. This fades out the previous photograph, whose transition-end handler then removes it. The replacement can remain blank until its request resolves or the next advance. A temporary component fault-injection test reproduced the loss of the last good photograph after withholding the replacement's load/error events and completing the outgoing fade.

Recommended fix: retain the last successfully decoded photograph until a replacement is genuinely ready. A deadline should skip/retry the failed candidate, not manufacture readiness. Separate requested, decoded and presented states. Preserve a visible fallback during swipe completion too, not only automatic cross-fades. For remix, fall back to successfully decoded cells rather than making an empty grid visible.

### P1 — The PWA shell declares the slideshow healthy before a photograph is ready

Locations: `SlideshowScreen.tsx:230` and its per-photo runtime-state message; `SlideshowShellScreen.tsx:489`, `:539`, `:679`.

The initial runtime message is sent when the wrapper mounts, before database loading or image decoding. The shell sets its readiness flag on that message and stops the initial readiness watchdog. Later code checks treat matching version plus that flag as healthy. There is no continuing runtime-health lease. A stalled image, failed database operation or later runtime failure can therefore coexist with “code current”. The parent's heartbeat proves only that the parent is executing.

Recommended fix: separate boot acknowledgement, first decoded/presented photograph and continuing runtime heartbeat. Include the selected photo, last successful decode/presentation, pending load age, pause state and next scheduled advance. Expire a runtime lease without assuming that a legitimate 15-minute slide interval is a stall. A heartbeat is still not proof that the physical display is illuminated.

### P1 — Update recovery destroys the old frame and can stop retrying indefinitely

Locations: `SlideshowShellScreen.tsx:337`, `:360`, `:489`, `:740`; `src/util/slideshowShell.ts`.

Every code reload increments the iframe key, immediately unmounting the live slideshow. A slow or failed replacement therefore exposes the black shell. Three unsuccessful retries exhaust a per-version budget; the implementation deliberately waits for another target version or manual intervention. Coming online with the same version does not restore an exhausted initial-load recovery path.

Recommended fix: keep a last-good visual in the shell during replacement, and distinguish a bounded retry burst from permanent refusal to recover. Renew the budget after an appropriate cooldown or a meaningful online/resume event, while retaining backoff. Give version requests deadlines too: a pending `fetch` currently holds `checkInFlightRef` and suppresses subsequent checks indefinitely. Prefer a lightweight retained photo to blindly running two complete slideshow/map/database instances; profile memory before choosing staged double-frame updates on iPad.

The persistent parent is nevertheless the right place to own the wake lock: replacing its child does not tear down that parent document. Keep that separation.

## iPad PWA wake-lock review

### Platform limits

Home Screen web-app wake locks were fixed in iOS/iPadOS 18.4. API presence alone is therefore not a sufficient compatibility check on older installed apps. An apparent iOS 26.1 regression in the old WebKit issue was subsequently withdrawn by its reporter as a browser-detection-library error; it is not evidence of a current general regression. Sources: [WebKit 18.4 release notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [WebKit issue 254545](https://bugs.webkit.org/show_bug.cgi?id=254545).

Wake locks are advisory. The OS may refuse or revoke them, including for power-saving reasons; hidden/inactive documents lose their locks. Even successful acquisition does not prove that the OS applied the underlying lock. The API cannot undo a manual screen-off. A suspended page's retry timer cannot promise unattended recovery after the device has already slept. Source: [W3C Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/).

### P1/P2 — Recovery needs a bounded request lifecycle

Location: `src/components/useWakeLock.ts`.

- A pending `navigator.wakeLock.request()` has no deadline. `isAcquiringRef` remains true until it settles, including after deliberate release. All subsequent taps and watchdog attempts then return without making a new request. A fault-injection hook test reproduced failure to recover after release and an explicit new acquire. This demonstrates a missing recovery path, not proof that this iPad is encountering a hung platform promise.
- The hook's sentinel type omits the standard `released` property. Resume and watchdog checks trust a non-null ref. A second fault-injection test showed that an already-released sentinel with a missed release event is reported active again on resume. Add defensive validation; a missed event is a simulated platform/lifecycle failure, not established normal WebKit behaviour.
- Ordinary system releases get a 1.5-second retry, which is sensible. But if that retry rejects, the next chance is the 60-second watchdog; an exhausted budget waits ten minutes. Neither can ensure recovery before Auto-Lock. Count each actual attempt once: the release path currently increments before scheduling, and a rejection increments again.
- Public acquisition failures go only to `console.error`; persistent diagnostics omit the original DOMException reason. The shell's wake gate disappears on acknowledgement, irrespective of success, and only returns after sustained loss. Its one-second “settled” signal measures elapsed time, not request completion.

Recommended design: an explicit idle/requesting/held/retrying/blocked state machine with request generations and deadlines. Invalidate obsolete requests on lifecycle transitions, release any late sentinel, and ensure a late completion cannot clear a newer request's guard. Check visibility and `sentinel.released` at resolution and resume. Retry briefly while visible, with backoff and a budget; expose an honest unavailable state rather than an indefinite spinner or an unqualified “awake”. Do not continually fight a user lock or OS power policy.

Keep a direct shell-owned user gesture as the manual recovery path. The runtime already forwards gestures to the parent; there is no evidence here that same-origin iframe messaging itself is the cause.

### P2 — Diagnostics can miss the incident and updates leave old shell code running

Location: `SlideshowShellScreen.tsx:199`, wake-event subscription, copied diagnostics and runtime reload paths.

The heartbeat interval writes the new timestamp without checking the old one. If it runs before the resume handler, or execution resumes without a visibility change, it can erase evidence of a long gap. Check for a gap before every write. Describe it as an execution gap, not proof of sleep: suspension, a stalled main thread and a stopped process can produce similar evidence.

Existing reports already include user agent, standalone mode, shell/runtime versions, visibility events and wake-loss history. Add request start/end, elapsed time, error name/message, sentinel release state, runtime lease and last successful photo/decode. Avoid pretending that unavailable battery/thermal information is known.

Child updates intentionally do not replace the parent. Consequently a deployed wake-hook or shell fix does not reach an already-running PWA shell until that document is reopened/reloaded. Retain separate shell/runtime versions in diagnostics and offer a deliberate shell-update action with a fresh wake-lock check. Do not silently hard-reload the parent during an unattended session.

The configured PWA launch URL is `/slideshow/shell`, but ordinary gallery/album slideshow links lead to `/slideshow`. After navigating away within the PWA, entering through those links can run the unmanaged route: its build poll hard-reloads the document. Standardise persistent-session entry points while preserving query settings.

### Practical device checks and acceptance test

1. Record the iPadOS version and confirm the running route is the shell. After deploying shell fixes, explicitly reopen/reload the PWA once; a child-only update is insufficient.
2. For a dedicated frame, use external power, moderate brightness and Low Power Mode off. Apple documents that Low Power Mode affects brightness and Auto-Lock. Source: [Apple Low Power Mode guidance](https://support.apple.com/en-gb/101604).
3. Consider Auto-Lock → Never for a dedicated device, or Guided Access with its own Display Auto-Lock setting. This trades automatic locking and power savings for kiosk behaviour; do not treat it as a blanket recommendation for an everyday unlocked iPad. Sources: [Apple display settings](https://support.apple.com/en-ie/guide/ipad/ipad11dbabaf/ipados), [Apple Guided Access](https://support.apple.com/en-mide/guide/ipad/ipada16d1374/ipados).
4. Test the actual installed PWA: cold launch, app switch/return, Control Centre, deliberate lock/unlock, Wi-Fi loss/recovery, a stalled image, a failed update and an update while a photo is visible. Then run an overnight powered soak with diagnostics enabled. Browser automation cannot validate physical Auto-Lock or iPad process eviction.
5. After another black-screen incident, note whether waking it shows the lock screen or an already-unlocked blank slideshow, and copy the diagnostics before clearing/reinstalling anything. Logs may narrow the cause, but do not establish physical screen state on their own.

## Other repository findings

- **P2: semantic search plus a colour filter can omit the embeddings database.** `src/components/search/Search.tsx:117` gates vector loading on `!colorSearch`, while the results hook still accepts a semantic query with colour filtering. A cold combined query reaches the search boundary with `embeddingsDatabase: null`; the split core database cannot supply its vectors. A temporary component test reproduced the missing database. Derive database requirements from the actual query plan, including combined filters.
- **P2: ready-to-ready database replacement does not invalidate search results.** `src/components/search/useSearchResultsState.ts:132` keys by boolean database availability, not generation. A hook test replacing one ready database with another retained old results. Add a stable database generation to the query key or invalidate consumers explicitly on promotion.
- **P2: live slideshow catalogue refresh leaves loaded embeddings stale.** `SlideshowScreen.tsx:456` force-refreshes the core database only. Refresh/promote compatible core and embedding generations together, preserving the current photo while preparing them.
- **P2: album names are interpolated unescaped into filter links.** `src/screens/album/AlbumScreen.tsx:138`, `:146`, `:154`. Names containing `&`, `+` or `#` change query meaning; directory names are not restricted to safe slugs. Build these links with `URLSearchParams`.
- **P2: the geotag tool's typecheck fails.** `tools/geotag/tsconfig.json:3` uses ES2021 libraries but shared theme code uses `Object.hasOwn`. Its normal typecheck reports TS2550; overriding the library set to ES2022 passes. Align its supported runtime/compiler libraries. The root app lint does not catch this separate tool gate.

The renderer boundaries, static-data separation and existing unit-test coverage are strengths. Extracting slideshow image, gesture and lifecycle controllers would make the failure paths easier to test, but should follow regression coverage rather than become a broad rewrite. No performance optimisation is justified here without device measurements.

## Verification and scope

- Main app lint, portable typecheck, test typecheck and formatting passed.
- The original main Jest suite's 266 suites / 2,815 tests passed across the main run and sandbox-permission reruns of the FFmpeg and port-listener cases.
- After the swipe changes, 25 slideshow-related suites / 444 tests passed.
- The isolated production E2E build and all 13 Chromium slideshow tests passed. Browser inspection confirmed progressive dimming, cancellation recovery and reduced-motion behaviour.
- Python indexer: 185 tests run, OK, one skipped. Geotag: 30 tests passed; its independent typecheck fails as noted above.
- Temporary fault-injection review tests were removed after confirming findings; the swipe regression tests remain. Wake-lock, image-timeout, update and unrelated repository findings above are recommendations, not implemented fixes. Nothing was committed or deployed.
