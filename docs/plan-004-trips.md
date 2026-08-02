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

Albums stay the unit of publication. Trips are a *view* computed over them — see the toggle
decision below, which replaced an earlier plan to classify albums by kind.

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

19 of 26 albums are exactly one trip, so for the large majority "make trips first-class" means
*rendering the album that already exists* as a journey. No album has to be reorganised.

## Decided: a view toggle, not a classification

The album grid stays the default and gains a **Trips** toggle, rather than trips replacing the
layout for albums a classifier judges to be journeys. This removes the plan's single biggest
risk. There is no longer any need to decide what an album "is":

- `snapshots` — 56 clusters over ten years. Absurd as one journey; genuinely useful as a view
  that breaks a decade of snapshots into 56 outings.
- `hokkaido`, `taiwan` — show their 3 and 2 separate visits.
- the other 19 — show the single journey.

`SegmentedToggle` already exists in `components/ui`, explore already switches views this way
(Map / Sankey / Bars), and `useUrlSearchParams` makes `?view=trips` linkable.

## What a trip shows

Settled against the real November 2016 journey (14 days, 167 photographs, 979 km). Everything
here comes from data already indexed — no new pipeline, no new model.

**Summary.** Span, photo count, distance, the albums it draws from, and three panels:

- *What you photographed here that you rarely do* — tag frequency against the archive baseline.
  Must filter to `source='classifier'`; including geocode tags just reports that a Japan trip
  is in Japan at 8.5×. Real output: autumn 5.8×, moss 6.3×, shinto_shrine 6.1×.
- *Places* — 17 of 21 were first visits, with the list.
- *What you carried* — bodies and lenses by share. Not one answer even with one camera: this
  trip is 153 X100T against 14 phone frames, which is a different kind of moment.

**Route map** with one photograph per day, numbered along the line. Note this is *not* what
`MapWorld` does: it gates thumbnails on zoom, and a trip opens fitted to its whole extent, so
inheriting that behaviour would show dots. One-per-day is a deliberate choice for a journey.

**Per day**: place sequence, first visits, later returns ("came back: Kyoto in 2022"), photo
count, time span, ground covered, an hours-of-the-day sparkline, and a bar of the day's average
colour. Between days, on the rail, how far the day's centre of gravity moved overnight where it
exceeds 20 km.

The two distances answer different questions and both are needed: day 6 *moved* 203 km
overnight but covered 6.5 km once there; day 4 stayed put and covered 171 km wandering.

Every statistic is stated against the archive's own baseline — "8.5 photos a day against your
usual 3" is a fact; "8.5 photos a day" is a number.

## Architecture

- `src/util/computeTrips.ts` — pure and framework-neutral, so it stays in the portable graph and
  is unit-testable without Node or React. It takes a minimal photo shape, which is what lets one
  implementation serve both consumers.
- **Explore** calls it at build time over every album and ships trip *summaries* — a few
  thumbnails each, not every frame.
- **Album pages** call the same function in the browser over the photos the page already has, so
  the Trips view costs no extra payload at all.
- Day boundaries come from `exifDayKey` — camera-local wall clock, never UTC, or a 23:00 frame
  lands on the wrong day of the trip.

## Implementation

**Stage 1 — detection and the explore panel.** `computeTrips.ts` plus tests, wired into
`PhotoStats`, rendered on explore as a Trips section with a "Load more trips" control matching
the five that already exist there. Ships alone.

**Stage 2 — the album Trips view.** The `SegmentedToggle`, `?view=trips`, and the day-by-day
rendering, grouped client-side from the album's own photos.

**Stage 3 — enrichment.** The panels, colour bars, sparklines and distances above.

**Stage 4 — `/trips`.** A route across all albums, which is also what reunites the 12 journeys
split across two albums (`hyouka` + `kansai` is one fortnight).

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
