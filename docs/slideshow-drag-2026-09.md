# Slideshow finger-follow investigation — 6 September 2026

The reported lag is while dragging, before release, not waiting for the next
photograph to download. Profiling the current production build (`95d08145`)
found repeated ICU formatter construction in the toolbar and both bottom-overlay
copies, including hidden chrome. Those formatters are now reused; formatted ages
are not cached, so they continue to advance. Gesture thresholds, transforms,
preview opacity, release animations and image fetching are unchanged.

## Measurement

Compared production builds in headless Chromium at 834 × 1112 with 4× CPU
throttling, a dated/geotagged single photograph and the inset map fully loaded.
Each round sends 90 animation-frame-paced touch-pointer moves, from −30 to
−210 px. Browser capture is stubbed for synthetic pointers; the final computed
image transform must be −210 px. Cancellation then waits for the spring-back's
transition end before the next round. CPU sampling runs over the gestures.

Two paired rounds, milliseconds:

| Metric | Original | Formatter reuse |
| --- | --- | --- |
| Median pointer-dispatch-to-next-task delay | 25.1 / 26.0 | 20.4 / 18.6 |
| 95th-percentile dispatch-to-next-task delay | 34.4 / 33.5 | 30.4 / 31.3 |
| Median animation-frame interval | 135.8 / 138.2 | 142.0 / 143.1 |

The measured dispatch-to-next-task delay includes React's update work, not just
the pointer handler. It is **not input-to-present latency**. Reusing formatters
reduces that cost, but does not demonstrate improved frame pacing: that remains
poor in this headless environment. Physical iPad PWA verification is still
needed before calling the reported lag fully resolved.

Browser-only experiments adding compositor hints or hiding the drag preview
did not improve frame pacing. Neither experiment was kept in application code.

## Diagnostics chip

The existing shell chip now shows Online/Offline using the shell's existing
network state. Browser checks exercised offline/online transitions at 834 px and
390 px widths, with no chip overflow. The addition uses the existing pill,
spacing and border tokens; no new controls or network polling were introduced.

## Return-to-centre follow-up — 9 September 2026

The reader clarified that the toolbar is hidden and the lag happens while
returning to the centre and dragging again, in either direction. The earlier
fading change added preview scaling/translation and retained the preview through
release. Hiding the preview or removing its motion did not demonstrate an
improvement, so the dim fade and movement are retained.

The preview now uses at most two reusable neighbour images, replacing the tiny
forward preload. Each source is explicitly decoded when it changes, outside the
gesture; crossing the centre, reversing direction and cancelling/re-grabbing do
not replace those images. The drag keeps a zero offset at the centre instead of
discarding its state. Cancellation at zero cleans up immediately, since there is
no transform transition to signal completion. The outgoing preview's source
remains pinned through its release fade, even when the queue advances. No album
download or unbounded image collection is added.

Backdrop sampling is disabled on toolbar/gesture surfaces only during live
horizontal dragging; their backgrounds, cues and release treatment remain.
Open-toolbar tracing found a much larger blur cost, but that is **not** the
reader's reported scenario and must not be offered as its explanation.

### Matched production-build traces

Headless Chromium, 834 × 1112, touch enabled, no CPU throttling, service workers
blocked. Both builds include the formatter reuse above. Deterministic random
draws select the same two-photo remix and neighbours. Wait for the current
presentation, preload downloads and maps, explicitly hide the toolbar and wait
for its opacity to reach zero. Dispatch 31 animation-frame-paced moves: out,
back to exactly zero, out again, then the same in the opposite direction. Verify
each actual inline transform. Pointer capture is stubbed for synthetic contacts.
Run before/after, then after/before to reduce run-order bias. Traces and CPU
profiles were written under `/tmp/slideshow-return-{before,after}-{1,2}.*`.

| Metric per trace | Before (two runs) | After (two runs) |
| --- | --- | --- |
| Median animation-frame interval | 30.8 / 29.6 ms | 27.5 / 25.9 ms |
| Median dispatch-to-observed-update delay | 7.8 / 9.3 ms | 7.5 / 8.0 ms |
| Preview image insertions + removals | 8 / 8 | 0 / 0 |
| Complete AVIF `Decode Image` events during drag | 344.8 / 379.7 ms | none / none |
| Network request events during drag | 0 / 1 image request | 0 / 0 |

Decode durations are background work, **not** synchronous main-thread stalls.
Chromium still performs smaller image-cache/raster tasks after the change; zero
full AVIF decodes does not mean zero image processing. A network request event
does not establish transferred bytes. These traces prove removal of preview
churn and moving full decode out of the gesture, with a modest frame-pacing
improvement. They do not prove smooth physical iPad PWA input or identify every
cause of the reported stall.

Component regressions cover both directions, centre crossings, interrupted
spring-back, pre-decoding and source retention through queue advancement. The
browser preview case now hides the toolbar and checks the actual opacity at
the centre and on re-drag, plus the absence of live cue blur.

Verification: 2,877 unit tests passed across the full run and the rerun of the
sandbox-blocked ffmpeg/port suites; lint, portable/application/test typechecks
and formatting passed. All 20 slideshow/PWA/shell browser cases and 14 map cases
passed. A separate WebKit run with iPad Pro 11 emulation verified both-direction
reversals, stable neighbour elements, zero opacity at the centre and no advance
on cancellation, with no page errors. This is browser-engine coverage, not a
physical-device performance measurement.

## Initial movement follow-up

The published `0c7347b` still waited for 24px of horizontal travel before moving
the photograph. A browser check held the neighbour's image request open: the
current photograph could move while that neighbour's `decode()` was pending.
With decoding complete, the same 0–23px stationary region remained in both
directions. No full AVIF decode occurred in the warm-gesture trace. This
identifies a gesture-response delay, not a synchronous wait for an image.

Finger-following now responds to the first horizontal-dominant movement rather
than sharing the hint's threshold. The hint still starts at 24px and navigation
still commits at 48px. Early movement does not commit the navigation axis, so a
diagonal start can become a vertical pull. Centre crossings retain the existing
preview buffers. The no-blur drag treatment consequently starts with that first
movement too. Small tap movements keep tap navigation but spring back instead
of being mistaken for a committed swipe's exit glide; mouse input is unchanged.

Regression coverage exercises offsets down to 1px, both signs, centre crossings,
re-grabbing during spring-back, vertical takeover and tap jitter. The browser
preview test also checks the rendered transform at 16px, before the hint can
start. This removes the measured distance threshold; it is not a claim of a
particular frame rate on an iPad. The profiling host was heavily loaded during
this follow-up, so its absolute timing measurements are not used as a speedup
claim.

Verification: all 2,885 unit tests passed across the full run and an isolated
rerun of the serialization suite (the concurrent build had removed its generated
fixture directory). Lint, typechecks and formatting passed. All 13 slideshow
Chromium cases passed. WebKit with iPad Pro 11 emulation also followed early
movement in both directions, retained the neighbour elements and returned the
preview to zero opacity at the centre, without advancing on cancellation or
reporting page errors. Physical iPad frame pacing remains unmeasured.
