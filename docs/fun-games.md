# Fun

`/fun` is the illustrated entry to Guess Where, Photo Relay, Blind Frame and
Photo Oracle. The global navigation selects Fun for every game; its subnav
selects the current game. `/guess` redirects permanently to `/fun/guess`,
preserving existing challenge query strings. New share links use the new route.

## Game rules and data

Photo Relay uses one image embedding space, preferring SigLIP 2 and falling back
to SigLIP 1 for older archives. It chooses two endpoints and five distinct
photographs near interpolated positions between their normalised vectors.
It prefers distinct frames over nearly identical copies when alternatives
exist and chooses from a compatible vector dimension group. The player orders
the five photographs, can undo the final choice, and explicitly finishes the
relay. Active-route previews do not link away from the game.
Keyboard selections move focus to the next available photograph, then Finish;
undo restores focus to the returned photograph. Pointer selections keep the
reader's current position.
All 120 possible orders are evaluated by the sum of adjacent cosine similarities;
the suggested route is the best.
The visual-flow score is the player's percentile among all 120 orders of this
same tray (0–100). Ties share a midpoint rank; an entirely tied tray is unscored. Give up reveals the complete suggested chain. Undo and replay
do not require new network requests. This measures embedding similarity rather
than editorial quality.

Blind Frame chooses a photograph with an existing AI caption and a SigLIP 1
embedding, then hides its image until the submitted sketch is compared. It
reuses the search drawing pad and browser image encoder. SigLIP 2 vectors must
never be substituted: the browser encoder produces SigLIP 1 vectors. The reveal
shows the sketch, hidden target, and closest archive photograph. The score
scales the target's similarity above the archive median against the closest
match. Rank is shown separately: a large archive must not turn a weak match
into a high score just because many photographs rank below it. It is not the
raw cosine expressed as a percentage. Ties share a rank. If the median is tied
with the best match, the remaining similarity range supplies the baseline; if
all matches tie, no score is awarded. Model loading
reports progress; a failed encode retains the submitted blob for retry.
Closing the drawing pad preserves a PNG draft that is restored when reopened.
Blank canvases are rejected before inference. Give up reveals the target and
invalidates a pending match so its late completion cannot replace the reveal.
The same scene can be retried with the previous sketch, or replayed with a new
description. Figure captions label the three comparisons for screen readers.

Photo Oracle offers up to twelve captioned/tagged photographs to remember,
chosen with distinct visual-question signatures so the available questions can
distinguish them. A collection with fewer than two distinguishable photographs
gets an explanatory empty state rather than a random guessing round.
The secret selection is held only for remembering and revealing, never passed
to the question/ranking functions. Visual questions are selected for the most
balanced split of current candidate weights. Answers multiply the likelihoods
rather than deleting disagreeing candidates, because captions can omit objects.
Incidental venue names and lighting do not imply indoors/night; explicit
negations in captions override positive tags for the same subject. The vocabulary
covers plurals, architectural details and visible colours as well as broad subjects.
Not sure leaves weights unchanged and skips the question. Back restores the
previous question or rejected guess, including its candidate weights. The oracle guesses
after eight questions, at 85% relative confidence, or when no unused question
can divide the candidates. A rejected guess is removed and play continues.

Game data comes through `fetchPhotoGameArchive`, using the existing core and
split embeddings databases. Video scenes/clips are excluded. There is no new
runtime API, index migration or live caption generation. Games run in neutral
screens/components; Next routes remain thin adapters.

## Refinement validation — 12 October 2026

A fixed-seed audit used 1,514 indexed, non-video archive photographs. Before
refinement, 72 of 100 sampled Oracle cohorts contained photographs with identical
answers to every available question. After selecting distinguishable cohorts,
none of 100 did. Twenty sampled relays had no pair above 0.98 cosine similarity;
the duplicate-frame fallback is also exercised with a synthetic duplicate set.

Browser checks use real canvas pixels for blank rejection, PNG draft restoration
and brush input. Vision inference is mocked at the worker-message boundary for
deterministic tests; these prove the submit/retry/reveal flow rather than model
quality. The normal core/embedding fixtures remain unchanged: games use isolated
extended copies. Existing search drawing behaviour and Guess Where remain in the
regression suite.

A real browser-model run matched a mountain sketch to a mountain photograph,
but its unrelated bonsai target initially earned 89/100 under percentile
scoring. That prompted the similarity-based calibration above. A regression
case with a weak second-ranked match and 1,000 worse photographs now stays
below 50 points while the closest match earns 100.
Replaying the real model's vector against the same archive gives the unrelated
bonsai target 42 instead of 89, and a daffodil-portrait target 26 instead of 78.

## Illustrations

Generated with the built-in image generation tool through the imagegen skill.
Final project assets are 960×640 AVIFs in `src/public/fun/`, encoded at quality
65 from the generated PNGs. The full composition is preserved. Their cream
paper remains consistent across site themes; surrounding UI follows site tokens.

Shared prompt for the first three assets:

> Use case: illustration-story. Asset type: hand-drawn editorial illustration
> for a personal photographic archive's Fun page. A small coherent
> ink-and-coloured-pencil drawing, imperfect lively strokes, restrained darkroom
> red accents, warm cream paper background, charcoal contours, generous empty
> margins, no text, letters, logos or watermarks. Landscape composition
> approximately 3:2, one clear central vignette, readable at card size,
> sophisticated playful sketchbook style rather than corporate clip art.

| Asset | Subject appended to the shared prompt |
| --- | --- |
| `guess-where.avif` | A little photographic print of a street corner resting on an unfolded map, with a hand-drawn red map pin and a small magnifying glass; the map lines echo the street in the print. |
| `photo-relay.avif` | Five small photographic prints connected by a wandering red pencil line: a doorway changes into an arch, an arch into a curved bridge, a bridge into a hillside. Show the idea of a visual journey between two pictures; handmade paper prints and sketchy recognisable scenes. |
| `blind-frame.avif` | An open sketchbook with a partly drawn street scene, pencil and red crayon beside it; a little photographic print peeks from behind the sketchbook, suggesting a hidden original photograph. A small curling speech bubble contains only a few abstract scribble lines, no letters. |

Photo Oracle prompt:

> Use case: illustration-story. Asset type: hand-drawn editorial illustration
> for a personal photographic archive's Fun page, matching a set of small ink-and-coloured-pencil drawings. A photo oracle: a sketchy crystal ball on a simple
> stand with a tiny photographic street scene visible inside, three small
> photographic prints scattered around it, a few playful question-mark-like
> curved strokes without letters. Imperfect lively charcoal ink strokes,
> restrained darkroom red coloured-pencil accents, warm cream paper background,
> generous empty margins, sophisticated playful sketchbook style rather than
> corporate clip art. Landscape composition approximately 3:2, one clear central
> vignette readable at card size. No words, letters, logos or watermarks.


## Game feel and scoring — 13 October 2026

Relay links now fill five persistent frame slots, so the evolving route stays
visible from the first move. Filled choices retain their selected state; progress
pips track the route and Oracle questions. Result panels and score bars reveal
with short animations; reduced-motion preferences disable these transitions.
Scores remain immediately readable and do not animate screen-reader text.

A seeded real-archive sample of 20 random relay orders averaged 29.35 under the
old similarity-range formula and 37.55 under percentile scoring. The exact
120-order regression verifies a 50-point mean across every possible order,
with 0 and 100 at the extremes. This removes puzzle-dependent compression;
a small random sample is not expected to land exactly on 50. Drawing regression
coverage now also rejects the misleading 100 points previously awarded to a
flat set of equally unrelated matches, while preserving tied best matches when
other photographs provide a meaningful comparison. Oracle reports questions
rather than inventing an accuracy score from approximate caption matching.
