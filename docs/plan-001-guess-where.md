# Guess Where — Design Plan

A GeoGuessr-style game using your own photos. You're shown a photo, you click the map to guess where it was taken, and you're scored by distance.

## Core loop

1. Configure game on the start screen (or skip via challenge link)
2. Load GPS-tagged photos from `search.sqlite`, filtered by region if set
3. Show a photo full-bleed — no EXIF, no geocode
4. Player clicks the map to place a guess pin
5. On confirm: reveal actual location, draw a connecting line, show distance + score
6. After all rounds, show a summary scorecard with share link

## Page: `/guess`

Client-side only (no `getStaticProps`). Loads SQLite DB via `useDatabase()`.

### URL parameters

| Param    | Default      | Description                                     |
|----------|--------------|-------------------------------------------------|
| `rounds` | `5`          | Number of rounds (3, 5, or 10)                  |
| `region` | (everywhere) | Country name filter (e.g. `?region=Japan`)      |
| `timer`  | (off)        | Seconds per round: `15` or `30`                 |
| `seed`   | (random)     | Deterministic photo selection for challenge links |

No `difficulty` param — the lobby's concrete options (timer, region) replace the vague easy/medium/hard modes.

## Start screen

Shown on first load. Challenge links (`?seed=...`) skip straight to gameplay.

### Layout

Centred card, max-width ~480px. Title at top, options stacked below, prominent "Play" button at bottom. Game lobby feel, not a settings form.

### Options

**1. Region** — `Select` dropdown: `Everywhere` (default) / per-country options
- Populated at mount: `SELECT geocode FROM images WHERE exif LIKE '%GPSLatitude%'`, parse each via `getGeocodeCountry()`, deduplicate, sort by count descending.
- Show photo count: "Japan (342)" / "Türkiye (89)".
- Countries with fewer than 3 GPS-tagged photos are excluded (not enough for a meaningful game).
- "Everywhere" = no filter.

**2. Timer** — `SegmentedToggle`: `Off` (default) / `30s` / `15s`
- When enabled, each round has a countdown bar on the photo panel.
- Time expires with a guess placed → auto-confirm (the player made an effort).
- Time expires with no guess → auto-skip (0 pts).
- Still shows the reveal either way.

**3. Rounds** — `SegmentedToggle`: `3` / `5` (default) / `10`

### Behaviour

- Defaults pre-selected, "Play" always enabled — zero friction to start.
- Enter key starts the game.
- Settings persist in component state across games (not lost on "Play again").

### Component: `GuessLobby`

```ts
type GuessLobbyProps = {
  database: Database;
  defaults: GameSettings;
  onStart: (settings: GameSettings) => void;
};
```

Fetches the country list from the DB on mount. Renders the three options + Play button.

## Components

### `GuessGame` (orchestrator)

Reducer-based state machine with phases: `"lobby"` → `"playing"` → `"summary"` → `"lobby"`.

```
type Phase = "lobby" | "loading" | "playing" | "summary";
```

- **Lobby phase:** renders `GuessLobby`. On start, stores settings in state, transitions to loading.
- **Loading phase:** fetches photos (seeded or random), parses GPS, transitions to playing.
- **Playing phase:** renders `GuessRound` for each round. On round complete, advances or transitions to summary.
- **Summary phase:** renders `GuessSummary`. Two actions:
  - "Play again" → back to loading with same settings, new seed.
  - "Change settings" → back to lobby with current settings as defaults.

Challenge links (`?seed=...`) skip lobby — go straight to loading with URL params as settings.

### `GuessRound` (single round)

- **Playing phase:**
  - Photo at `@1600.avif` — scroll-to-zoom (1×–6×), drag-to-pan, double-click reset
  - `GuessMap` beside it — click to place/move pin
  - "Confirm" button with pulsing glow when guess is placed
  - "I have no idea" subtle skip link
  - Keyboard: Enter/Space to confirm, Enter/Space/ArrowRight for next
  - Optional timer bar at top of photo panel (see timer section)

- **Reveal phase:**
  - Map fitBounds to show both pins
  - Dashed red line with glow connecting guess → actual
  - Guess pin: bouncy drop + ripple. Actual pin: drop + pulse ring.
  - Animated score counter + tier-coloured score bar
  - Confetti on ≥70% score
  - Geocode label (city, country)

### `GuessMap`

- Minimal MapLibre, OpenFreeMap liberty style, `ssr: false`
- `cooperativeGestures={false}` for immediate scroll zoom
- Click places/moves a single pin (`anchor="center"`, CSS dot)
- Reveal: second green pin + dashed line + fitBounds

### `GuessSummary` (end screen)

- Animated total score counter, rating text
- Round rows with thumbnails (linked to album), geocode labels, distances, tier-coloured score bars
- "Play again" button — same settings, new photos
- "Change settings" link — returns to lobby
- "Copy challenge link" button — copies URL with seed + settings

## Scoring

Exponential decay, 5,000 points per round, tight curve (250km decay):

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

Confetti at ≥70% (3,500+ pts, within ~90km).

## Timer implementation

Lives in `GuessRound` as a `timeLimit: number | null` prop.

- `useEffect` with `setInterval(1000)` counting down.
- On reaching 0:
  - If guess is placed → call `handleConfirm()` (auto-confirm).
  - If no guess → call `handleSkip()` (auto-skip).
- Visual: thin bar across the top of `.photoPanel`.
  - Width: `transition: width ${timeLimit}s linear` from 100% to 0%.
  - Colour: CSS variable swap at thresholds — green → amber (≤50%) → red (≤25%).
  - Bar is `position: absolute` inside the photo panel, doesn't affect layout.
- Timer pauses on reveal (no countdown during the reveal phase).

## Region filtering

SQL approach — keeps it in the DB layer, avoids fetching all rows:

```sql
SELECT path, exif, geocode FROM images
WHERE exif LIKE '%GPSLatitude%'
  AND geocode LIKE '%\n' || ? -- country name at end of geocode string
ORDER BY RANDOM() LIMIT ?
```

For seeded games: same approach but fetch all matching paths first, then seed-shuffle in JS.

The `region` param is a country name string (e.g. "Japan"), not an album name. Separate from the legacy `filter` param which is album-based and retained for backwards compatibility but not exposed in the lobby.

## Data flow

```
/guess page
  ├── ?seed=... → skip lobby, use URL params
  └── no seed → GuessLobby
        ├── fetches country list from DB
        └── onStart(settings) → GuessGame loads photos

GuessGame (loading phase)
  → fetchGuessPhotos(database, { count, region, seed })
    → SQL: filter by GPS + region
    → seeded shuffle if seed provided
    → parse GPS via extractGPSFromExifString()
    → GuessPhoto[] { path, lat, lng, geocode, albumName, photoName }

GuessPhoto.path
  → /data/albums/{album}/.resized_images/{photo}@1600.avif
```

## Share / challenge links

Built by `GuessSummary` from the active settings + seed:

```
/guess?seed=a1b2c3&rounds=5&region=Japan&timer=30
```

- `seed` makes the photo selection deterministic — friend gets the same photos.
- Other params encode the game settings so they match.
- "Copy challenge link" button copies the full URL. Brief "Copied!" confirmation.
- Hint text: "Challenge a friend to the same N photos".

## Files

```
src/pages/guess/
  index.tsx                        — page entry, URL param parsing
  guess.module.css

src/components/guess/
  GuessGame.tsx                    — orchestrator (reducer, phase machine)
  GuessGame.module.css
  GuessLobby.tsx                   — start screen with options    [NEW]
  GuessLobby.module.css                                           [NEW]
  GuessRound.tsx                   — single round (photo + map + scoring + zoom + timer)
  GuessRound.module.css
  GuessMap.tsx                     — minimal MapLibre for guessing
  GuessMap.module.css
  GuessMapExport.ts                — default export wrapper for dynamic import
  GuessSummary.tsx                 — end-of-game scorecard + share
  GuessSummary.module.css
  guessTypes.ts                    — GuessPhoto, GameSettings types
  confetti.ts                      — canvas confetti burst

src/components/search/api.ts       — fetchGuessPhotos (region filter + seed)
src/components/GlobalNav.tsx        — "Guess" nav link
```

## Layout (responsive)

- **Desktop:** photo 60% / map 40% side by side, full viewport height minus nav. No max-width — stretches edge-to-edge.
- **Mobile:** stacked vertically — photo 2fr / map 3fr. `100dvh` minus nav, `overflow: hidden` prevents scrolling.
- **Lobby + Summary:** centred card, max-width 480–560px.

## Design decisions

- **Map style:** OpenFreeMap liberty — no API key, clean cartography.
- **No difficulty modes:** replaced by concrete options (timer, region) that give players real control. The vague easy/medium/hard is dropped.
- **Skip button:** Subtle underlined link, 0 points, still shows reveal.
- **Photo size:** `@1600.avif` — sufficient for the panel width.
- **Markers:** `anchor="center"` with CSS dot pins — no offset from click point.
- **Scoring curve:** Tight 250km decay rewards neighbourhood precision in dense photo areas.
- **Timer auto-confirm:** If the player placed a guess, respect the effort — auto-confirm rather than auto-skip.
- **"Play again" vs "Change settings":** Two distinct actions in the summary. "Play again" keeps flow fast (no lobby friction). "Change settings" gives control when wanted.

## Out of scope (future)

- Multiplayer / leaderboard (needs a server)
- Hard mode photo cropping
- Streak mode (consecutive close guesses)
- "Daily challenge" with a fixed daily seed
- Region deduplication (spread pool across distinct geocode clusters)
- Album filter in lobby (use URL param `filter` for power users)
