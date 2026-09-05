# Site refinements — 5 September 2026

Scope: the follow-up improvements requested after `756e6ba`. No download button,
album prefetch or bulk offline-library feature was added.

## Navigation and accessibility

Trips reads year, kind and sort from URL state, preserving unrelated parameters.
A hash naming an older trip reveals it before scrolling, including when its
incoming filter excludes it. The live regression was a ninth trip absent from
the first six mounted entries. The local production build reaches it and
preserves a selected year through reload. Explore's four technical selectors now
have explicit Time/Settings camera/lens accessible names. The frontend-design
skill guided the restrained treatment using existing controls and spacing.

## Measured performance

Calendar labels constructed an ICU formatter for every day on every render.
Three paired Node runs over 4,745 dates took 498–627 ms with the original code
versus 9–26 ms with one formatter. Every label matched. No years, dates, keyboard
targets or interactions were removed.

Three cold Chromium runs at 834×1112 compared the previous production deployment
with the local production build. Largest main-thread tasks were 889/770/890 ms
before and 145/140/140 ms after; summed time beyond the 50 ms long-task threshold
was 1763/1460/1595 ms versus 327/279/293 ms. These are local desktop-browser
observations, not physical iPad measurements or network-load benchmarks.

Explore's detailed gear and colour ribbons now use lossless rows and a shared
string dictionary. Exact round-trip equality was checked against the full real
archive; unpacking averaged 0.62 ms over 100 iterations. Complete page props fell
from 1,504,815 to 1,120,599 bytes. HTML fell from 1,534,622 to 1,149,325 bytes.
Compression already handled much of the redundancy: gzip HTML fell only from
175,503 to 171,258 bytes, Brotli from 112,605 to 111,044 bytes. The main benefit is
less JSON/HTML to parse, not a claimed 25% network improvement. Content remains
available without an additional data request.

## Cold search

The observed large download was `text_model_q4.onnx`: 154,693,262 bytes. The local
embedding database is 3,346,432 bytes. Opening an empty search page no longer
starts the model download. Hybrid queries show keyword matches as soon as the
core database is ready and refine the same query when semantic resources arrive.
Pure semantic queries still wait for semantic results, rather than silently
changing meaning. Similarity-index failures now have a retry action.

The model and its ranking space remain unchanged. A native comparison across 12
queries found q8 top-ten overlaps of 7–10, two changed first results, and roughly
2.1 seconds to encode the set versus 1.2 seconds for q4. The q4f16 candidate failed
ONNX Runtime initialisation. Neither candidate was adopted on file size alone.
First use of actual semantic search still needs the large model; its existing
browser cache avoids repeat downloads when storage remains available.

## Brief network outages

Database downloads bound response headers and gaps between body chunks to
15 seconds; failed in-flight loads remain retryable. Service-worker network-first
requests fall back to cached responses after eight seconds without headers.

Only slideshow-referred, same-origin AVIF requests enter a rolling Cache Storage
buffer: at most 24 images, at most 2 MiB each (48 MiB payload ceiling). Successful
requests are reused; no album is downloaded in advance. Oversized and failed
responses are excluded, writes are serialised, and old entries are evicted before
insertion. The buffer survives code-cache generations. Gallery/map thumbnails
remain on the browser's native cache path, preserving the Firefox fast path.

Offline advances cycle cached photographs from the current pool/album filter.
Image errors also enable a brief fallback window because a broken Wi-Fi link can
leave `navigator.onLine` true. Online recovery restores normal selection without
changing the saved playback mode. The last good photograph remains the fallback
when no replacement is available. This is a short-outage buffer, not guaranteed
offline availability for the whole library; browser eviction still applies.

## Verification

Regression tests cover trip links/URL state, immediate hybrid results, model-free
empty search, dictionary round-trips, download stalls, cache limits and filtered
offline selection. The real service-worker browser test reloads offline, checks
decoded image pixels are available, and advances to another cached photograph.
Its initial keyboard attempt did not focus the iframe; driving the visible Next
control verified the application path without an arbitrary sleep or retry.

Final gates: lint, formatting and all three TypeScript checks passed; Jest passed
270 suites / 2,866 tests. The fresh-production Chromium browser selection passed
24 tests with three pre-existing skips. All six iPad-sized WebKit slideshow-shell
checks passed, including blank-update and missing-heartbeat recovery. These use
synthetic wake-lock support and do not prove physical iPad Auto-Lock behaviour.
The real-data production build and album/index publish preflight also passed.
