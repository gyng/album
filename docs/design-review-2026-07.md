# Design / UI / UX / IA review — July 2026

Reviewed against a production build (`next start`) on desktop (1440×900) and mobile
(390×844) viewports, across the System/Light/Dark/Paper/Ink/Slate themes. Pages:
home, album, search, explore, map, timeline, slideshow, guess, design.

Severity: **M** medium · **L** low · **I** informational. No high-severity findings —
nothing is broken; these are polish and structure items.

> **Status (16 Jul):** all findings fixed except #8 (tag facet cloud, deferred by
> choice). #4 (dice) and the score badge in #7 already had `title`/`aria-label`
> coverage the review missed; album display titles (#3) are already supported
> via the manifest title block, so slug titles are a content decision.

## Information architecture

1. **[M] Test fixture albums ship to the public album index.** `test-simple`,
   `manifest`, and `test-manifest-v2` render at the bottom of the home page.
   `listAlbumDirectories` (`src/services/album.ts:24`) includes every directory
   and the fixtures are committed, so any build made from a full working copy
   (including prebuilt deploys) lists them. Suggest excluding `albums/test-*`
   from `getAlbums` unless an E2E/CI env flag is set.

2. **[M] Global and album-scoped actions share one undifferentiated nav row.**
   On album pages the nav grows to ten pills (Albums … Guess Where, then Album
   map / Album timeline / Album slideshow) plus the theme picker, all styled
   identically. Scope is invisible, and on mobile it becomes a long scroller
   where the contextual items are off-screen. Consider a divider or ghost
   variant for context actions, or moving them into the album header.

3. **[L] Album titles are directory slugs.** "2511japan", "sg-parks", "mavica"
   read as codes; the v2 manifest could carry display titles. Also the meta
   line is inconsistent — "composites" shows no date range while siblings do.

4. **[L] The dice half of the Slideshow split button is undiscoverable.**
   Icon-only, no visible label; its function (random photo) is only learnable
   by clicking. The same dice on the timeline's "Random" works because it is
   labelled.

## UX

5. **[M] Photo-details disclosure (album pages).** The ⓘ `<summary>` sits in
   the far page margin, visually detached from its photo (desktop), with a
   small hit target and an accessible name of just "ⓘ". Mobile placement (top
   right of each photo) is better. Suggest: `aria-label="Photo details"`, a
   larger padded target, and anchoring it to the photo frame on desktop. The
   opened panel is good; only the "Google Maps" link runs flush against the
   panel edge.

6. **[L] Emoji-only accessible names.** Slideshow has a "🕰️" button whose
   accessible name is the emoji itself (announced as "mantelpiece clock").
   Worth a sweep for icon-only controls without `aria-label` (the theme picker
   and ⓘ aside, most controls are labelled well).

7. **[L] Search result tiles: unexplained score badge.** Tiles show a bare
   number (e.g. "16") with no unit or tooltip; captions like "kansai, 10y" are
   terse. A `title`/tooltip ("similarity 16%", "10 years ago") would help.

8. **[L] Tag facet cloud is overwhelming.** Flat count-sorted cloud spanning
   dozens of rows inside its own scroll strip (double scrollbar with the page).
   The italic count floats between tag names, weakening tag↔count pairing.
   Consider chip+badge rendering and a top-N with "show all".

9. **[L] Scrollbar treatment is inconsistent across horizontal scrollers.**
   The nav uses edge fades (good); the explore jump-nav and timeline year
   grids show chunky default scrollbars, most visible on mobile. Unify with
   thin/overlay scrollbars plus fades, without removing scrollability.

## UI / visual

10. **[M] Slideshow toolbar has three different "active" treatments.** Dashed
    outline (active playback mode), dark fill (pressed/disabled look-alike),
    italic + pressed (Remix), and the accent focus ring. Unify the state
    language: one visual for "current mode", one for pressed toggles, one for
    disabled.

11. **[L] Guess "Play" is the primary CTA but visually only accent-outlined.**
    A filled accent variant would make the hierarchy against "Daily challenge"
    unambiguous. (What Daily challenge is — fixed daily seed — is also not
    explained anywhere on the lobby.)

12. **[L] Map "Play map tour · 24 photos" is stranded bottom-left** at small
    size next to the legend; easy to miss for the flagship storytelling
    feature. Consider grouping it with the journeys/date controls top-right.

## Strengths (keep)

- **Design system coherence**: tokens + pills/cards/selects hold together on
  every page, and `/design` documents it. The five-theme system (with swatch
  previews) re-skins everything cleanly, including charts and the progress bar.
- **Search** composability (text + colour + facets + image/sketch) with deep
  links into album anchors and the similar-photo trail is excellent.
- **Timeline** is distinctive: colour-tinted calendar heatmap, connector line
  into the day panel, memories strip, per-day mini-map.
- **Map**: recency-coloured pins with a legend, journeys overlay, photo count
  in the search box.
- **Slideshow**: deep feature set with clear group labels (Playback / Display /
  View / Timing / Context); chrome auto-hide correctly wakes on keyboard focus.
- **A11y bones**: skip link, `aria-current`, visible focus ring, reduced-motion
  /-transparency, `prefers-contrast`, and forced-colors handling are all in
  place.

## Environment note (found during review)

A stale `.next` from an e2e build made before the `NEXT_DIST_DIR=.next-e2e`
split had the fixture DB URL baked in, so local prod builds silently served the
empty `e2e-search.sqlite` (search showed fixture tags/no results). A clean
rebuild fixed it and the dist-dir split prevents recurrence; worth remembering
if local search ever looks empty again.
