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

The seven game illustrations are antique-style hand engravings with transparent
outer backgrounds, generated using the built-in imagegen tool. Final 960×640
AVIFs preserve alpha in `src/public/fun/`. The shared `GameIllustration` component renders their inverted
luminance through an SVG mask, removing pale paper interiors as well as the
outer background, then supplies the theme’s accent-colour ink. There is no
fixed cream card illustration or theme-specific bitmap variant.

The full generation prompts and asset mapping are recorded in
[fun-illustrations.md](fun-illustrations.md).

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


## Expanded play — 13 October 2026

All five starts reuse the themed engraving from the Fun! cards. The Guess
Where lobby retains regular navigation geometry; starting play switches to the
compact viewport shell, with the same short nav translation used between map
and regular pages. Reduced-motion preferences disable it.

Blind Frame shows the shared drawing pad inline on desktop (721px and wider)
as soon as a round starts; smaller screens retain the modal. The pad offers
bounded twenty-step stroke/clear history, undo/redo with scoped keyboard
shortcuts, a separate eraser, brush previews and a larger desktop canvas.
Inline drafts are saved after each stroke and history change. Submission still
rejects blank/erased canvases before inference. The first stroke warms only the
vision tower through `warmup-image`; encoding joins the cached runtime and
errors remain recoverable through the normal submit/retry flow. The reveal
also shows up to four nearest photographs to the hidden target in SigLIP 1
space, excluding the target itself.

Photo Oracle keeps its remembered-photo mode and adds discovery: answer
preferences about visible subjects, then keep a suggested photograph or ask
for another match. Discovery considers the full captioned archive without
receiving a secret target. Back restores an answer or rejected match; replay
retains the mode, while Change mode returns to the illustrated lobby.

Photo Relay supports native drag/drop into its slots and between placed frames.
Move-earlier, move-later and remove buttons provide equivalent keyboard and
touch controls. Reveals show the cosine similarity (×100) of each neighbouring
pair, distinct from the overall relative route score.

Connect the Shots offers 4×4, 5×5 and 6×6 boards with matching group sizes.
Broad subjects use caption topics; Specific subjects use finer indexed tags,
excluding generic scene/place labels. Each frame matches exactly one selected
subject, and competing same-sized partitions are rejected, including those that would
emerge after removing solved groups. Selection has an
accent outline and a tick badge without dimming the photograph. One-away hints
can be switched off. Four different mistakes reveal the groups; repeated wrong
submissions are not charged again. Solved groups remain visible, and phone
screens also show larger previews of the selected photographs.

A seeded audit of 30 rounds over 1,514 real archive photographs built every round,
used 23 different subjects and found no overlap among the four chosen caption
predicates. This is a metadata consistency check; captions can still overlook
subjects visible in a photograph. Component tests cover correct groups, near
misses, repeated mistakes, exhaustion and complete reveals.


Final validation: 3,031 Jest tests passed; the full Chromium suite passed 109
checks (three intentional skips), followed by nine fresh game/navigation checks
on the final build in both Chromium and iPad-style WebKit. Real-archive browser
reviews completed all four connections at 390px and 1440px and returned an
Oracle discovery after eight preference questions. The five engravings were
checked in light, darkroom, terminal and watercolour themes.

A native browser-worker run (no inference mock) loaded the vision model after
the first stroke, received the warm-up acknowledgement before Reveal, then
encoded and scored the submitted mountain sketch. Its unrelated autumn-tree
target scored 17/100; the reveal also displayed four target neighbours. The
warm-up took about 5.5 seconds in that run; this is an observation, not a
network-independent latency guarantee. The nav regression records real native
animations in both map-to-page directions and checks reduced-motion behaviour
when Guess Where changes its shell.


## Double Take and Cross Exposure

Double Take flashes two decoded photographs in sequence, then asks Same place
or Different places. Nearby pairs are within 75 metres on different camera-local
days; distant pairs are at least 5 km apart. Invalid coordinates, ambiguous
separations, same-day nearby bursts and near-duplicate vectors are excluded.
Half the rounds draw the strongest lookalikes in each answer class; the rest
match resemblance across classes. This mixes deceptive distant pairs with
convincing return visits without making every strong resemblance a distant
answer. A 20-game audit raised average similarity from about 0.79 to 0.90 in
both classes. Eight rounds use distinct
photographs, with fewer rounds when the archive supports fewer balanced pairs.
Correctness earns 100 points; a streak adds up to 100. Replay removes the bonus.
Default flashes last one second, shortening by 100 ms per streak step to a
650 ms minimum. A longer-look option gives each photograph three seconds. Hidden tabs interrupt
the sequence; both frames must be watched again. Image load/decode failures and
15-second stalls offer retry. Reveals show full photographs, dates, locations
and actual separation; GPS proximity labels an area, not proof of a building.

Cross Exposure dynamically creates 3×3, 4×4 or 5×5 crossing grids from captions and
subject tags. Distinct row/column predicates must have usable intersections;
augmenting-path matching proves a complete arrangement with unique photographs.
Equivalent clue families and duplicate board signatures are excluded. The tray
contains exactly the solution photographs, shuffled; any alternative arrangement
that satisfies both predicates for every square is accepted.
Players choose Visible clues or Hidden connections. Starting photographs can be None, Minimal (one per row/column), or Guided (two
per row/column). Hidden connections defaults to Minimal; Visible clues defaults
to None. Clear keeps any starting photographs; swaps and removal apply only to
movable shots. Check
marks which photographs fit both clues. On phones and tablets the whole board fits without horizontal scrolling.
Compact row numbers and column letters reference a full clue key beneath the
grid; selecting a photograph also shows a larger preview. Give up reveals one valid arrangement.

Oracle now uses indexed subject tags as well as broad caption topics, without an
eight-question cap. Discovery narrows candidates directly by preferences until
one remains or no unasked question distinguishes the remaining photographs.
Ties are explained and can be browsed; Back restores the preceding candidates.
Remembered-photo mode retains probabilistic answers because captions can omit
visible objects. Relay explains the overall ordering percentile separately from
link resemblance, supplies caption-based common subjects, and identifies the
largest jump. Blind Frame labels the original target, player drawing and the
model's nearest drawing match explicitly; target neighbours form a separate
section. Pending warm-up and comparison use the shared LoadingIndicator.

Validation: all board sizes and subject modes generate against the real archive;
20 generated crossing grids were valid (10 per size). Native browser reviews
cover desktop and phone layouts, both crossing modes, complete Double Take
sessions, replay/interruption, and Oracle singleton/tied results.

Game entry shows its illustration immediately, with loading feedback delayed
180 ms so already-available photographs do not cause a loading-message flash.
Real waits retain progress and immediate errors retain retry.

Unrevealed hidden grids accept valid row/column permutations and swapped axes,
since their clue order cannot be known from an empty start. Revealed labels
follow the player’s valid arrangement. Visible or revealed clues retain their
positional meaning; an incomplete hidden board does not report arbitrary
position-specific errors.
