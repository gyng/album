# Trips as a first-class thing

## Context

This archive is trip-shaped. 1,488 photos, but only **294 shooting days** across fifteen
years, and they clump: a handful of long journeys plus a scatter of single-day outings. The
explore page is nevertheless built as aggregates over a continuous stream — hour of day, day
of week, month. On data like this, "Day of week" and "Month" largely report *when the owner
takes holidays*, not how they shoot.

The ask is to make trips first-class: an album that is a journey should read as one, and trips
should be *detected* rather than hand-authored.

## Verified during planning

Measured against the live index, not assumed. Two of these changed the design.

- **A trip detector already works.** Clustering shooting days on "gap ≤ 3 days **and** the
  country has not changed" yields **94 clusters: 36 multi-day trips and 58 single-day
  outings**. The multi-day ones are recognisable journeys — 167 photos over 14 days in Japan
  (Nov 2016), 109 over 11 days (Nov–Dec 2025), 93 over 15 days (May 2015).
- **Country has to be part of the rule.** On dates alone, a stray `snapshots` frame taken at
  home can bridge two separate journeys. Adding country costs nothing — `geo_country` is
  populated for 1,472 of 1,474 dated photos.
- **19 of 26 albums are already exactly one trip.** For those, album *is* the trip and the
  album page can simply render as one.
- **The other 7 split into two kinds**, and conflating them would be the main way to get this
  wrong:
  - *collections* — `snapshots` (56 clusters over 3,570 days), `sg-parks` (14), `mavica` (5).
    These are themes or cameras, not journeys, and must not be forced into a trip shape.
  - *place albums* — `hokkaido` (3 clusters over 825 days), `taiwan` (2 over 953). One place,
    several visits. These want a "visits" view, not a single trip view.
- **Trips can cross albums, and it is meaningful when they do.** Only 12 of 294 days are
  shared by two albums, but `hyouka` + `kansai` on 2016-11-15/16 are one journey split into a
  thematic and a geographic album, and `2502japan` + `mavica` is one journey shot on two
  cameras. Detection therefore runs over *all* photos, not per album.
- **`buildMapRoute` in `components/mapRoute.ts` is reusable** — it already turns
  `MapWorldEntry[]` into ordered route points and GeoJSON, with simplification.
- **`splitRouteByDay` does not exist.** Both `AGENTS.md` and `.claude/rules/map.md` claim
  `mapRoute.ts` owns it. It does not, and nothing references it. That line is stale and should
  be corrected or the helper written; a trip view is the natural place to want it.
- **Per-photo timezones landed recently** (16 zones, 100% of dated photos), so a trip can show
  correct local time for each day without inventing anything.

## The model

A **trip** is a maximal run of shooting days where consecutive days are ≤ 3 apart and the
country does not change. A run spanning ≥ 2 days is a *trip*; a single day is an *outing*.

Trips are **derived, never authored**. Nothing is written into `album.json` to begin with —
the archive already contains the answer, and an authored field would immediately drift from
the photos. An override can be added later if a specific trip needs pinning.

Albums stay the unit of publication. Trips are a *view* computed over them, and detection
tells the three album kinds apart rather than assuming one:

| kind | count | album page becomes |
| --- | --- | --- |
| trip album | 19 | the trip view — days, route, places, span |
| place album | 2 | a list of visits, each a trip view |
| collection | 5 | unchanged |

## Decided: a trip is any cluster, local included

Considered gating trips on "away from home" — Singapore is 275 photos of ordinary life, and a
home country in `site.config.json` would have separated them. Rejected: it adds a config key
and a concept ("home") to serve a distinction the reader can already see from the place label,
and a local afternoon out is a real outing worth surfacing. The multi-day/single-day split
already does the useful sorting, and it needs no configuration.

The consequence to design around is that the list mixes "14 days in Japan" with "an afternoon
in a Singapore park". Ordering by span and photo count, and labelling outings as such, keeps
that readable without inventing a home.

## Albums carry most of this already

Worth stating plainly, because it bounds the work: 19 of 26 albums are exactly one trip, so
for the large majority "make trips first-class" means *rendering the album that already
exists* as a journey. Detection earns its keep on the remaining 7 — telling a collection from
a place album from a trip — and on the cross-album cases. It is a classifier and a view, not a
new content model, and no album has to be reorganised for it.

## Architecture

- `src/util/computeTrips.ts` — pure and framework-neutral, so it stays in the portable graph
  and is unit-testable without Node or React. Input: photos with wall-clock date, coordinates,
  geocode and album. Output: `Trip[]` with span, day breakdown, places, photo count and
  representative frames. Day boundaries come from `exifDayKey` — camera-local wall clock,
  never UTC, or a 23:00 photo lands on the wrong day of the trip.
- `PhotoStats` gains `trips`, computed in `computePhotoStats` alongside the existing stats, so
  explore gets them with no new plumbing.
- The trip view reuses `buildMapRoute` for the route and the existing day-grid pattern for
  each day's photos. If `splitRouteByDay` is wanted, write it in `mapRoute.ts` where the docs
  already say it lives.

## Implementation

**Stage 1 — detection, surfaced cheaply.** `computeTrips.ts` plus tests, wired into
`PhotoStats`, rendered on explore as a "Trips" panel: span, place, photo count, a few frames.
Ships alone and is immediately useful; validates the rule against the real archive before
anything is restructured.

**Stage 2 — the trip view component.** Day-by-day sections with the route map above them.
Framework-neutral, in `components/`, driven by a `Trip`.

**Stage 3 — album pages adopt it.** A single-trip album renders the trip view; a place album
renders its visits; a collection album is untouched. This is where the classification earns
its keep.

**Stage 4 — `/trips`.** A route listing every detected journey, newest first, plus feeds and
sitemap entries the way the other generated routes work.

**Stage 5 — optional overrides.** Only if the derived answer turns out wrong somewhere: an
`album.json` key to pin or split a trip.

## Risks

- **Forcing collections into a trip shape** is the main failure mode. `snapshots` is 56
  clusters over ten years; rendering it as a journey would be nonsense. Classification must
  gate the view, and Stage 1 exists partly to prove the classifier before Stage 3 uses it.
- **Local clusters crowding the list.** Deliberately included, so the list is 94 entries of
  which 58 are single days. Ordering and an explicit "outing" label carry that weight; if they
  do not, the fallback is collapsing outings behind a count rather than reintroducing a
  configured home.
- **Two domestic journeys three days apart merge.** Correct often enough (one continuous
  trip), wrong occasionally. A distance test could refine it later; coordinates are populated
  for 1,472 photos.
- **14 undated photos** cannot be placed in any trip and must be excluded, not defaulted.
- **Payload.** A trips panel is small; a `/trips` page with thumbnails needs the same care the
  colour ribbon needed — a full grid of every trip's frames is how pages get heavy.

## Verification

- Unit tests for `computeTrips` covering the gap rule, the country break, single-day outings,
  undated photos, and the `hyouka`/`kansai` cross-album case.
- Assert against the real archive at least once: 36 multi-day trips and 58 outings under the
  current rule, so a change to the rule is visible rather than silent.
- `npx jest`, `npm run lint`, and a production build per stage; browser checks at 390px and
  1280px, since the recent explore work found three layout defects that only appeared there.
