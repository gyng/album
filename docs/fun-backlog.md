# Fun improvements queue

## Semantic games and Wander — 14 October 2026

- Warmer and Caption It: ranked against the archive with the in-browser text
  encoder, dailies, stats and placeholder art. Details in `docs/fun-games.md`.
- Wander: a section of `/explore` rather than a Fun game. Details in
  `docs/explore-cloud.md`.

## October refinement release

- Cross Exposure: 5×5 boards; None, Minimal and Guided starting photographs;
  full mobile/tablet grid without horizontal scrolling, compact clue headers,
  clue key and selected-photo preview. Hidden solutions accept valid reordered
  rows/columns or swapped axes.
- Double Take: one-second flashes down to 650 ms; stronger same-place and
  distant lookalikes mixed with similarity-matched rounds.
- Guess Where, Connect the Shots and Cross Exposure lead the cards and subnav;
  illustration insets align with card text.
- Navigation links and theme controls move independently; the slideshow split
  button uses the same surface and colours as other controls.
- Drawing tools use compact SVG icons, tooltips and visual brush-size controls.
- Game entry keeps its illustration stable and delays loading feedback to avoid
  transient loading-message flashes.

## Previously completed

Completed in the October 2026 Fun refinement pass.

## Connect the Shots

- Improved selected-photo contrast across themes. Selection should remain clear
  over both light and dark photographs, with a visible outline and a non-colour
  indicator.
- Added a board-size choice: 4×4, 5×5 and 6×6. Interpret these as four groups of
  four, five groups of five and six groups of six respectively. Keep 4×4 as the
  default. Adapt puzzle generation, near-match hints and layout to the chosen
  size; larger boards must still have clear, distinct connections.

## Game illustrations

- Tinted the illustrations with the active theme's accent colour on both Fun!
  cards and game start screens. Preserve the transparent background and fine
  pen-and-ink detail. All nine cards now use animal editorial cartoons; Sight
  Lines has bird portraits hanging along a giraffe's outstretched neck.

## Further refinements completed

- Broad/specific connection difficulty and optional one-away hints.
- Double Take: sequential photographic memory rounds with location reveals.
- Cross Exposure: generated crossing grids with visible or hidden connections.
- Adaptive Oracle questions, clearer Relay and Blind Frame results, and loading spinners.
- Three-column desktop Fun! cards.


## Further game refinements

- Mobile Cross Exposure: sticky grid with Hint and selected-photo thumbnail.
- Hints reveal one row/column clue at a time without leaking the other clues.
- Saved lobby choices for Cross Exposure, Connect the Shots, Double Take,
  Photo Oracle and Guess Where, with explicit challenge URLs taking precedence.
- Compact mobile photo grids, including Connect the Shots and Cross Exposure.
- Sight Lines: dynamically generated photo word searches, 5×5/6×6, drag or tap
  endpoints, keyboard play, hints, fair alternate solutions and linked reveals.
- Height-aware mobile docks: boards and targets for Sight Lines/Cross Exposure,
  compact controls for Connections, and a miniature chain reference for Relay.

## Photo Hangman refinements

- Photo Hangman: searchable subject tags, eight photographic clues (two at the start), six misses,
  truthful alternative answers, clue history, retry and linked results.
- Sight Lines touch refinement: finish taps on click so revealed photo links do
  not receive the same touch; cancel a drag released outside the board.

## Sight Lines selection refinement

- Concrete subjects, prominent caption mentions and varied outings for planted
  clues; overlapping topic pools are avoided.
- Mostly unrelated filler with a few single-topic distractors; candidate boards
  are ranked against topic flooding and accidental runs. Valid alternatives count.
- Shared subject matching with Photo Hangman. Ten sampled real-archive boards
  were valid with no extra runs; cached generation averaged 86ms (previously
  2,496ms), with a 118ms maximum on this machine.
