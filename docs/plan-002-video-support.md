# Plan: First-Class Video Support

## Context

Videos can already appear inline on album pages — `VideoBlock.tsx` renders `<video>` with IntersectionObserver play/pause, `video.ts` transcodes to H.264 MP4 via FFmpeg, and `deserialize.ts` wires it into the build pipeline. But videos are invisible everywhere else: no poster thumbnails, excluded from search, timeline, map, slideshow, explore stats, and similar-photos features. This plan makes videos first-class across the entire gallery.

## Scope boundaries

**In scope:** local videos (files in album directories).
**Out of scope:** YouTube embeds — they have no local file, no thumbnail extraction, no indexing. They continue to work only on album pages as they do today. No changes to `YoutubeBlockEl` or YouTube-related code.
**No changes needed:** `albumFeed.ts` / `generate-feeds.cjs` — RSS feed generation already handles both photo and video blocks.

---

## Phase 1: Thumbnail Extraction + Type Foundation

The foundation everything else depends on: extracting a poster frame from each video at build time.

### `src/util/mediaType.ts` (new file)

Extract video extension list and helpers into a shared util that both server and client code can import. `services/video.ts` imports `ffmpeg-static` at the top level, making it un-importable from client-side pages (slideshow, search).

```typescript
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];
export const isVideoFile = (filepath: string): boolean =>
  VIDEO_EXTENSIONS.includes(filepath.slice(filepath.lastIndexOf(".")).toLowerCase());
```

Update `services/video.ts` to re-export from this util instead of defining its own.

### `src/services/video.ts` — add `extractVideoThumbnail()`

- Accepts the **original** video path (higher quality than the transcoded output), output directory, and `durationSeconds`
- Needs `durationSeconds` from `getOriginalVideoTechnicalData()` — caller must run FFprobe first
- Extracts up to 3 candidate frames at evenly-spaced timestamps (10%, 50%, 90% of duration) via FFmpeg (`-f image2pipe` to stdout as PNG). **Short video adaptation:** `candidateCount = min(3, max(1, floor(duration)))` — 1 frame for <2s, 2 for <3s, 3 for >=3s
- Converts each to AVIF via Sharp (reuse `AVIF_OPTIONS` from `photo.ts`), reads `stats()` to compute image variance (sum of channel standard deviations)
- **Black-frame rejection:** discard frames where all channel means <10. If all candidates are black, fall back to a single extraction at 0.5s
- **Picks the highest-variance survivor** and saves to `.resized_videos/{filename}@thumb.avif`. Non-winners are discarded (temp buffers, not persisted)
- Returns `{ src: string; width: number; height: number }` — `src` is web-accessible (via `stripPublicFromPath`)
- **Caching:** if `@thumb.avif` already exists and is >0 bytes, skip extraction. Read `width`/`height` from the cached file via `sharp(path).metadata()` and return immediately

### `src/services/types.ts` — extend `VideoBlock._build`

```typescript
_build?: {
  src: string;
  originalSrc?: string;
  mimeType: string;
  thumbnail?: { src: string; width: number; height: number };
  originalTechnicalData?: {
    // ...existing fields...
    lat?: number;   // GPS — parsed in Phase 4
    lng?: number;
  };
};
```

No `keyframes` field — candidates are internal to `extractVideoThumbnail()` and discarded after selection. The Python indexer extracts its own keyframes independently.

Also add `lat?: number; lng?: number` to `OriginalVideoTechnicalData` in `video.ts` now (parsed in Phase 4, but adding the type slot here avoids a second type change).

### `src/services/deserialize.ts` — wire thumbnail into build

In `deserializeVideoBlock()`, run FFprobe first, then **parallelise** transcoding and thumbnail extraction (both read from the original file, write to different outputs):

```typescript
const originalTechnicalData = await getOriginalVideoTechnicalData(localFilepath);
const [optimised, thumbnail] = await Promise.all([
  optimiseVideo(localFilepath, "public/data/albums"),
  extractVideoThumbnail(localFilepath, "public/data/albums", originalTechnicalData.durationSeconds),
]);
```

Store `thumbnail` in `_build.thumbnail`.

### `src/components/VideoBlock.tsx` — add `poster` to existing album renderer

`LocalVideoBlockEl` currently has no `poster` attribute — the video is blank until metadata loads. Add `poster?: string` to `LocalVideoBlockElProps` and set `poster={props.poster}` on the `<video>` element.

### `src/components/PhotoAlbum.tsx` — thread `poster` prop

The `Block` component (line 37) constructs `LocalVideoBlockEl` props from the `VideoBlock`. Add:
```typescript
poster={(props.b as VideoBlock)._build?.thumbnail?.src}
```
to the `<LocalVideoBlockEl>` call.

### Tests

- `src/services/video.test.ts`: cache-hit path, return shape `{ src, width, height }`, `src` ends with `@thumb.avif`
- `src/util/mediaType.test.ts`: `isVideoFile` matches known extensions, rejects `.jpg`

---

## Phase 2: Video-Aware Thumb Component + Album Covers

### `src/components/ui/Thumb.tsx` — play indicator overlay

- Add `isVideo?: boolean` prop, **destructure it out** before spreading `...rest` onto `<img>` (React warns about unknown DOM attributes on native elements)
- When `isVideo` is false (or omitted): return the bare `<img>` as today — no wrapper, no extra DOM
- When `isVideo` is true: wrap `<img>` in a `<span className={styles.wrapper}>` and add a `<span className={styles.playOverlay} />` sibling

### `src/components/ui/Thumb.module.css` (new co-located CSS module)

```css
.wrapper { position: relative; display: inline-block; line-height: 0; }
.playOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.playOverlay::after {
  content: "";
  border-style: solid;
  border-width: 10px 0 10px 18px;
  border-color: transparent transparent transparent rgba(255,255,255,0.85);
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
}
```

### `src/components/Albums.tsx` — cover fallback for video-only albums

Extend cover selection to fall back to a video block's thumbnail when no photo exists:
```typescript
const cover = album.blocks.find(b => b.kind === "photo" && b.formatting?.cover)
  ?? album.blocks.find(b => b.kind === "photo")
  ?? album.blocks.find(b => b.kind === "video" && b._build?.thumbnail);
```
When cover is a `VideoBlock`, render `<Thumb src={cover._build.thumbnail.src} isVideo />` instead of `<Picture>`.

### `src/util/getResizedAlbumImageSrc.ts` — add video thumbnail URL helper

Add named exports:
```typescript
import { isVideoFile } from "./mediaType";

export const getResizedAlbumVideoThumbnailSrc = (path: string): string => {
  // ../albums/trip/clip.mp4 → /data/albums/trip/.resized_videos/clip.mp4@thumb.avif
  const mediaSrc = path.replace("..", "data");
  return "/" + [...mediaSrc.split("/").slice(0, -1), ".resized_videos",
    ...mediaSrc.split("/").slice(-1)].join("/") + "@thumb.avif";
};

export const getResizedAlbumMediaSrc = (path: string): string =>
  isVideoFile(path) ? getResizedAlbumVideoThumbnailSrc(path) : getResizedAlbumImageSrc(path);
```

### Tests

- Thumb render test: `isVideo` renders wrapper + play overlay; omitted renders bare `<img>`
- `getResizedAlbumVideoThumbnailSrc`: correct path transformation
- `getResizedAlbumMediaSrc`: dispatches based on extension

---

## Phase 3: Timeline

### `src/pages/timeline/index.tsx`

Add `isTimelineVideo` predicate alongside `isTimelinePhoto`. Matches local videos that have both a date (from `data.date` or `originalTechnicalData.originalDate`) and a thumbnail:
```typescript
const isTimelineVideo = (block: Block): block is VideoBlock => {
  if (block.kind !== "video") return false;
  const v = block as VideoBlock;
  return v.data.type === "local"
    && Boolean(v.data.date ?? v._build?.originalTechnicalData?.originalDate)
    && Boolean(v._build?.thumbnail);
};
```

In the `getStaticProps` flatMap, add a second branch mapping `isTimelineVideo` blocks into `TimelineEntry`:
- `src` → `_build.thumbnail` (already `{ src, width, height }`, matching `OptimisedPhoto` shape)
- `dateTimeOriginal` → `data.date` (already resolved by deserialize to ISO string)
- `href` → `/album/${slug}#${video.id}`
- `isVideo` → `true`

Merge video entries into the same sorted array.

### `src/components/timelineTypes.ts`

Add `isVideo?: boolean` to `TimelineEntry`.

### `src/components/TimelineDayGrid.tsx`

Pass `isVideo={entry.isVideo}` to `<Thumb>` to show the play overlay.

---

## Phase 4: Map — GPS from Videos

### `src/services/video.ts` — parse GPS from FFprobe

Extend `getOriginalVideoTechnicalData()` to extract GPS. FFprobe surfaces location as:
- `format.tags.location` — ISO 6709: `+35.6762+139.6503/`
- `format.tags["com.apple.quicktime.location.ISO6709"]` — same format

Add `parseISO6709(raw: string): { lat: number; lng: number } | null`:
```typescript
const match = raw.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)\/?\s*$/);
if (!match) return null;
return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
```

In the FFprobe result handler, try both tag names and populate `lat`/`lng` on the result.

### `src/pages/map/index.tsx`

After the existing photo loop in `getStaticProps`, add a second pass for video blocks with `lat`/`lng` and `thumbnail`. Map to `MapWorldEntry` using thumbnail as `src`. Merge into the same array.

### `src/components/MapWorld.tsx`

Add `isVideo?: boolean` to `MapWorldEntry`. Pass through to thumbnail rendering for play overlay.

### Tests

- `parseISO6709`: parses `+35.6762+139.6503/`, handles missing trailing slash, rejects garbage

---

## Phase 5: Search Indexing (Python) — independent track

Can proceed in parallel with phases 1–4. Uses system `ffmpeg`/`ffprobe` binaries (not Node's `ffmpeg-static`).

### `index/index.py`

- Add `VIDEO_EXTENSIONS` set and `is_video_file()` helper (matching the same extensions as the TS side)
- Add `extract_video_keyframes(path: str, count: int = 3) -> list[str]`:
  - Shells out to `ffprobe` to get duration
  - **Short video adaptation:** `count = min(count, max(1, floor(duration)))` — 1 frame for <2s, 2 for <3s, 3 for >=3s
  - Extracts frames at evenly-spaced timestamps as temp PNGs via `ffmpeg`
  - Returns list of temp file paths
- In the main indexing loop, when `is_video_file(path)`:
  - Extract up to 3 keyframes (adaptive count as above)
  - **Captioning (Janus/Gemma):** run on each keyframe independently. Merge results:
    - `tags`: union across frames, deduplicated
    - `alt_text`: concatenate per-frame descriptions separated by ` | ` (narrative arc: "market entrance | vendor preparing food | crowded street")
    - `subject`: pick the longest (most descriptive) across frames
  - **SigLIP v1 embeddings:** compute per-keyframe, **average** into a single vector. Broader semantic coverage — search for any scene in the video has a reasonable chance of matching. Store as one row in `embeddings` table.
  - **Colours:** extract palette from each keyframe via `fast_colorthief`, merge into a single palette (top colours across all frames, deduplicated by proximity in LAB space)
  - **Date/GPS:** from `ffprobe` `creation_time` and `location` tag (same ISO 6709 parsing as the TS side)
  - **EXIF-equivalent metadata:** store video metadata in the `exif` column as a stringified key-value block (same format as photo EXIF) with keys like `DurationSeconds`, `Width`, `Height`, `Codec`, `DateTimeOriginal`. This allows search-time access to duration and date without a schema change.
  - Insert into `images` FTS5 table (same schema — path column identifies it as video)
  - Clean up temp keyframe files
- Incremental skip logic works unchanged — video paths are just strings
- **Cost:** 3 keyframes means ~3x Janus inference per video (~3–6s GPU). For <100 videos adds a few minutes to a full index.

### Shell scripts

Update `do-full-index.sh` / `do-embeddings-index.sh` glob from `../albums/**/*.jpg` to include video extensions. Either brace expansion (`*.{jpg,mp4,mov,m4v}`) or multiple `--glob` passes.

### No schema changes

Videos are rows in the existing `images` table. The `path` column distinguishes them.

---

## Phase 6: Search & Similar Photos Display

### `src/components/search/SearchResultTile.tsx`

```typescript
import { isVideoFile } from "../../util/mediaType";
import { getResizedAlbumMediaSrc } from "../../util/getResizedAlbumImageSrc";
```

Replace `getResizedAlbumImageSrc(result.path)` with `getResizedAlbumMediaSrc(result.path)`. Pass `isVideo={isVideoFile(result.path)}` to `<Thumb>`.

### `src/components/search/SimilarTrailBar.tsx`

Replace `getResizedAlbumImageSrc(path)` with `getResizedAlbumMediaSrc(path)` — video paths in the similarity trail would produce broken thumbnail URLs otherwise. Note: the breadcrumb preview (line 227) uses a bare `<img>` rather than `<Thumb>`, so no play overlay here. Acceptable — the trail is small and the icon would be too cramped.

### `src/components/search/useSearchResultsState.ts`

Same: replace `getResizedAlbumImageSrc(similarPath)` with `getResizedAlbumMediaSrc(similarPath)`.

### `src/components/PhotoSimilarPhotos.tsx`

No changes — renders `SearchResultTile` which handles the dispatch.

---

## Phase 7: Slideshow

### `src/pages/slideshow/index.tsx`

Import `isVideoFile` from `util/mediaType` (not from `services/video` — that would pull in FFmpeg).

`fetchSlideshowPhotos` queries all rows from `images` with no type filter, so once Phase 5 indexes videos they'll automatically appear in the results. The slideshow just needs to detect and render them differently.

**Source URL helpers:**
```typescript
const getSlideshowVideoSrc = (photo: RandomPhotoRow | null): string | null => {
  // ../albums/{album}/{file} → /data/albums/{album}/.resized_videos/{file}@1920.mp4
};
const getSlideshowVideoThumbnailSrc = (photo: RandomPhotoRow | null): string | null => {
  // ../albums/{album}/{file} → /data/albums/{album}/.resized_videos/{file}@thumb.avif
};
```

**Rendering:**
- When `isVideoFile(currentPhoto.path)`, render `<video>` instead of `<img>`:
  - `poster={getSlideshowVideoThumbnailSrc(currentPhoto)}` — immediate visual while buffering
  - `muted`, `playsInline`, `autoPlay`
  - **Not** `loop` (unlike album `VideoBlock` which loops — slideshow should advance)
  - `onEnded` → wait `timeDelay` → advance to next
  - `onError` → skip after 1s (same as existing image error handling)
- **Pause/resume sync:** when user pauses slideshow, also call `videoRef.current.pause()`; on resume, `videoRef.current.play()`
- Skip the hidden-image preload buffer (`bufferedPhotoSrc`) for video items — too expensive to preload full video

### `src/pages/slideshow/slideshow.module.css`

Add `<video>` styles matching the existing `.image` class (same `max-height`, `max-width`, `object-fit`).

---

## Phase 8: Explore Stats + Guess Where

### Explore: `src/util/computeStats.ts` + `src/pages/explore/index.tsx`

- Add `totalVideos: number` and `totalVideoDurationSeconds: number` to `PhotoStats`
- In `computePhotoStats`: count video blocks, sum `_build.originalTechnicalData.durationSeconds`
- Add a stat card on the explore page showing count and formatted total duration

### Guess Where: `src/components/search/api.ts`

In `fetchGuessPhotos()`, extend the WHERE clause to exclude video paths:
```sql
AND path NOT LIKE '%.mp4' AND path NOT LIKE '%.mov' AND path NOT LIKE '%.m4v'
```
Videos don't suit the timed guessing interaction.

### `src/util/computeEmbeddingStats.ts`

Currently filters `block.kind === "photo"` (line 277). Extend to also include video blocks with embeddings, so embedding coverage stats reflect the full indexed media set.

---

## Execution Order

```
Phase 1 (thumbnails + types + mediaType util)
  └──→ Phase 2 (Thumb + covers + URL helper)
         ├──→ Phase 3 (timeline)
         ├──→ Phase 4 (map + GPS)
         ├──→ Phase 8 (explore stats + guess exclude)
         │
         ├──→ Phase 6 (search + similar display) ←── also needs Phase 5
         └──→ Phase 7 (slideshow)               ←── also needs Phase 5

Phase 5 (Python indexer) — independent, can start immediately
```

Phases 3, 4, 8 are parallel after Phase 2.
Phases 6, 7 require **both** Phase 2 (Thumb + URL helpers) and Phase 5 (indexed data).
Phase 5 is fully independent of the JS/TS track and can start immediately.

---

## Future Enhancements (out of scope for this plan)

- **Duration overlay on thumbnails** — show formatted duration (e.g., "0:15") bottom-right of video thumbnails in search results, timeline, and map previews. Data already available from `originalTechnicalData.durationSeconds` (build-time) and from the `exif` column in the search DB (runtime).
- **Media type search facet** — "Type: photo | video" filter in the search panel. Simple extension: detect by path extension in SQL `LIKE` clause or add a `media_type` column.
- **Per-keyframe embeddings** — instead of averaging SigLIP vectors, store one embedding row per keyframe. Trades DB size for higher recall on diverse videos.
- **Animated thumbnail preview** — short 2–3 second muted WebP/MP4 loop, shown on hover in grid views. Significantly more build time and storage.

---

## Key Files

| File | Changes |
|------|---------|
| `src/util/mediaType.ts` | **New.** Shared `VIDEO_EXTENSIONS`, `isVideoFile()` — importable client-side |
| `src/services/video.ts` | `extractVideoThumbnail()`, `parseISO6709()`, GPS fields, re-export from `mediaType` |
| `src/services/types.ts` | `thumbnail` + GPS in `VideoBlock._build` |
| `src/services/deserialize.ts` | Wire thumbnail; parallelise with `optimiseVideo` via `Promise.all` |
| `src/components/ui/Thumb.tsx` | `isVideo` prop + conditional play overlay wrapper |
| `src/components/ui/Thumb.module.css` | **New.** Play overlay styles |
| `src/components/Albums.tsx` | Cover fallback to video thumbnail |
| `src/components/VideoBlock.tsx` | Add `poster` prop to `<video>` |
| `src/components/PhotoAlbum.tsx` | Thread `poster` from `_build.thumbnail.src` to `LocalVideoBlockEl` |
| `src/util/getResizedAlbumImageSrc.ts` | `getResizedAlbumVideoThumbnailSrc`, `getResizedAlbumMediaSrc` |
| `src/pages/timeline/index.tsx` | Video entries in timeline |
| `src/components/timelineTypes.ts` | `isVideo` field |
| `src/pages/map/index.tsx` | Geotagged video entries |
| `src/components/MapWorld.tsx` | `isVideo` in `MapWorldEntry` |
| `src/pages/slideshow/index.tsx` | `<video>` rendering + `onEnded` advance |
| `src/pages/explore/index.tsx` | Video stat card |
| `src/util/computeStats.ts` | Video count + total duration |
| `src/util/computeEmbeddingStats.ts` | Include videos in embedding stats |
| `src/components/search/SearchResultTile.tsx` | Video thumbnail + play indicator |
| `src/components/search/SimilarTrailBar.tsx` | `getResizedAlbumMediaSrc` |
| `src/components/search/useSearchResultsState.ts` | `getResizedAlbumMediaSrc` |
| `src/components/search/api.ts` | Guess Where video exclusion |
| `index/index.py` | Multi-keyframe extraction, captioning, embeddings, colours |
| `index/do-full-index.sh` | Expanded glob patterns |

## Test Fixtures

Need a small test video with GPS and creation date in `albums/test-video/` (or `albums/test-simple/`). To keep the repo small, generate a synthetic one:
```bash
ffmpeg -f lavfi -i testsrc=duration=2:size=640x480:rate=25 \
  -metadata creation_time="2025-01-15T10:30:00Z" \
  -metadata location="+35.6762+139.6503/" \
  -c:v libx264 -pix_fmt yuv420p \
  albums/test-video/test-clip.mp4
```
~50 KB, has both date and GPS metadata.

## Verification

1. Run `npm run build` from `src/` — verify `.resized_videos/*@thumb.avif` generated alongside `*@1920.mp4`
2. Check album page: video has poster frame visible before playback
3. Check home page: video-only album shows cover thumbnail with play overlay
4. Check timeline: video appears on correct date with play indicator
5. Check map: video marker appears at GPS coordinates
6. Run `npx jest` from `src/` — all existing + new tests pass
7. Run `cd index && ./do-full-index.sh` with expanded globs — verify video rows in `search.sqlite` with tags, embeddings, and colours derived from multi-keyframe analysis
8. Check search: query matching video tags returns tile with play overlay
9. Check slideshow: video plays muted, advances after ending, pause pauses playback
10. Check explore: video count and total duration stat card
11. Check Guess Where: no video paths appear in rounds
