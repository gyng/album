# Fun improvements queue

## Queued — semantic games (14 October 2026)

Both run the in-browser SigLIP v1 text encoder (q4, 154,693,262 bytes) against
the stored v1 image vectors, so they share one download. Warn in the lobby
before loading it, as search does, and warm it only on first use. Each starts
with a placeholder illustration until new artwork can be generated.

- **Warmer.** Semantle for one hidden photograph: the player types words, the
  text encoder scores each against the photograph's vector, and the answer is
  freezing → hot. Each guess sharpens a blurred version of the photograph; the
  reveal shows the closest words and the index caption. Needs calibration so
  "hot" means the same across photographs (rank the guess against the
  archive's other photos, not a raw cosine). Daily-capable.
- **Caption It.** The player writes a caption for a photograph; the encoder
  scores how well it fits, compared with the index's own caption and with the
  archive (does it pick this photograph out of the rest?). Shareable result.
  Guard against keyword stuffing — rank against other photographs rather than
  rewarding raw similarity.

## Queued — Wander, on Explore (14 October 2026)

Not a Fun game: a section of `/explore`, beside the cloud it walks through.
No goal, score, daily or stats — the player stands inside one photograph and
drifts to the next.

- **Exits.** Each photograph offers a handful of ways out, each a
  neighbour in the full 768 dimensions. The explore payload already carries
  three nearest neighbours per point; widen that at build time rather than
  loading the embeddings database. Label exits by what changes (a tag the
  neighbour has and this one lacks, or a palette shift: darker, warmer, more
  colourful), never by place or date.
- **Trail.** Keep the path walked as a strip of thumbnails; Back retraces it.
  Highlight the current photograph and its trail in the cloud above, so
  walking and the projection explain each other.
- **Entry.** Start from a random photograph, a cloud click, or a photo page's
  "Wander from here"; put the current photograph in the URL so a walk can be
  shared from where it stands.
- **Optional quest.** "Find a photograph with both a cat and a staircase",
  drawn from tag pairs that co-occur somewhere in the archive. Light
  direction, not a score.
- No text model: everything comes from the build-time payload, so it costs
  nothing beyond what Explore already downloads.

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
