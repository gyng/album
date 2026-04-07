# Guess Where — Design Plan

A GeoGuessr-style game using your own photos. You're shown a photo, you click the map to guess where it was taken, and you're scored by distance.

## Core loop

1. Load a random GPS-tagged photo from `search.sqlite`
2. Show the photo full-bleed (no EXIF, no geocode — that's cheating)
3. Player clicks the map to place a guess pin
4. On confirm: reveal the actual location, draw a line between guess and truth, show distance
5. After 5 rounds, show a summary scorecard

## Page: `/guess`

Client-side only (no `getStaticProps`). Same pattern as `/slideshow` — loads the SQLite DB via `useDatabase()`, fetches photos with `fetchGuessPhotos`, parses GPS from the EXIF string.

### URL parameters

| Param     | Default | Description                                    |
|-----------|---------|------------------------------------------------|
| `rounds`  | `5`     | Number of rounds per game (1–20)               |
| `filter`  | (all)   | Album name filter (e.g. `?filter=24japan`)     |
| `difficulty` | `medium` | `easy` / `medium` / `hard` (see below)      |

### Difficulty modes

- **Easy** — shows the geocode country as a hint overlay
- **Medium** — no hints, world map
- **Hard** — no hints (photo cropping deferred to future)

## Components

### `GuessGame` (page-level orchestrator)

- `useReducer`-based state: `photos`, `currentRound`, `results`, `error`, `gameKey`, `ready`
- Fetches a pool of N+5 random GPS-tagged photos on mount (single query, filters to N with valid GPS)
- Query: `SELECT path, exif, geocode FROM images WHERE exif LIKE '%GPSLatitude%' ORDER BY RANDOM() LIMIT ?`
- `gameKey` increment triggers a fresh fetch for "Play again"

### `GuessRound` (single round)

- **Playing phase:**
  - Photo displayed at `@1600.avif` — scroll-to-zoom (1x–6x), drag-to-pan, double-click to reset
  - `GuessMap` beside it — click to place a pin
  - "Confirm" button with pulsing accent glow when a guess is placed
  - "I have no idea" subtle skip link
  - Keyboard: Enter to confirm

- **Reveal phase:**
  - Map zooms to fit both pins (guess + actual) with animated fitBounds
  - Dashed red line with glow layer connecting the two
  - Guess pin: bouncy drop + expanding ripple
  - Actual pin: drop + continuous pulse ring
  - Distance + animated score counter (counts up via rAF, imperative DOM updates)
  - Score bar animates with tier colour (green ≥70%, amber ≥35%, accent below)
  - Confetti burst on good guesses (≥70% score)
  - Geocode label shown (city, country)
  - Keyboard: Space/ArrowRight/Enter for next
  - Cumulative score in top bar bumps on update

### `GuessMap`

- Minimal MapLibre via `react-map-gl/maplibre`, OpenFreeMap liberty style
- `ssr: false` dynamic import (same as `MapWorldDeferred`)
- `cooperativeGestures={false}` for immediate scroll zoom
- Click handler places/moves a single circular pin (anchor: center)
- During reveal: second green pin + dashed line with glow + fitBounds animation

### `GuessSummary` (end screen)

- Total score counts up from 0 (animated counter)
- Rating text fades in after count (delayed 0.5s)
- Round rows cascade in from left (staggered 0.08s)
- Each row: thumbnail, geocode label, distance, score bar (tier-coloured), score
- Score bars animate with staggered delay
- "Play again" button fades in last, has scale hover/active feedback

## Scoring

Exponential decay, capped at 5,000 points per round. Tight curve rewards precision:

```
score = Math.round(5000 * Math.exp(-distance_km / 250))
```

| Distance | Score | Feel |
|---|---|---|
| 1 km | 4,980 | Nailed it |
| 10 km | 4,804 | Right neighbourhood |
| 50 km | 4,094 | Right city |
| 100 km | 3,352 | Right region |
| 200 km | 2,247 | Right area |
| 400 km | 1,010 | Wrong city |
| 1,000 km | 91 | Wrong country |

Total max: 25,000 for a 5-round game.

Confetti triggers at ≥70% (3,500+ pts, within ~90km).

## Data flow

```
search.sqlite (WASM)
  → fetchGuessPhotos(database, { count, filter })
    → SELECT path, exif, geocode FROM images
       WHERE exif LIKE '%GPSLatitude%'
       AND path LIKE ?
       ORDER BY RANDOM() LIMIT ?
    → parse GPS via extractGPSFromExifString()
    → return GuessPhoto[] { path, lat, lng, geocode, albumName, photoName }

GuessPhoto.path
  → /data/albums/{album}/.resized_images/{photo}@1600.avif
```

## Files

```
src/pages/guess/
  index.tsx                        — page entry, URL param parsing
  guess.module.css

src/components/guess/
  GuessGame.tsx                    — game orchestrator (useReducer)
  GuessGame.module.css
  GuessRound.tsx                   — single round (photo + map + scoring + zoom)
  GuessRound.module.css
  GuessMap.tsx                     — minimal MapLibre for guessing
  GuessMap.module.css
  GuessMapExport.ts                — default export wrapper for dynamic import
  GuessSummary.tsx                 — end-of-game scorecard
  GuessSummary.module.css
  guessTypes.ts                    — GuessPhoto type
  confetti.ts                      — canvas confetti burst

src/components/search/api.ts       — fetchGuessPhotos added
src/components/GlobalNav.tsx        — "Guess" nav link added
```

## Layout (responsive)

- **Desktop:** photo 60% / map 40% side by side, full viewport height minus nav
- **Mobile:** stacked vertically, photo then map

## Design decisions

- **Map style:** OpenFreeMap liberty — no API key, clean cartography
- **Map zoom:** Always starts at world view. Easy mode shows country label as the only hint.
- **Skip button:** Subtle underlined link, 0 points, still shows the reveal.
- **Photo size:** `@1600.avif` — never wider than its panel, cuts load time vs 3200.
- **Markers:** `anchor="center"` with custom CSS dot pins — no offset from click point.
- **Scoring curve:** Tight decay (250km) rewards neighbourhood-level precision, especially in dense photo areas.
- **Density scaling:** Not needed — the tight curve already punishes imprecise guesses in dense regions.

## Out of scope (future)

- Multiplayer / leaderboard (needs a server)
- Timed rounds
- Hard mode photo cropping
- Streak mode (consecutive close guesses)
- "Daily challenge" with a fixed seed
- Region deduplication (spread pool across distinct geocode clusters)
