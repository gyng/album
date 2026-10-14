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

The nine game illustrations are animal editorial cartoons with transparent
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

Game starts reuse the themed illustrations from the Fun! cards. The Guess
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
excluding generic scene/place labels. Singular and plural tags (rock/rocks) are
one subject when both occur, so two groups can never share an answer; Oracle
also drops tag questions that repeat a caption topic. Each frame matches exactly one selected
subject, and competing same-sized partitions are rejected, including those that would
emerge after removing solved groups. Selection has an
accent outline and a tick badge without dimming the photograph. One-away hints
can be switched off. Unlimited lives are the default; players can choose four, six or eight lives.
Only a limited-lives round ends on mistakes. Repeated wrong
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
Candidate pairs are compared once per collection, in short slices so Cancel
stays responsive, and reused by Play again.
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
Players choose Visible clues or Hidden connections. Starting photographs range from zero to four, with zero as the default.
Filled starting cells have lock badges and stay fixed; old saved prefill labels
migrate to numeric counts. Clear keeps any starting photographs; swaps and removal apply only to
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


## Sticky grid, progressive hints and saved choices

On phones and tablets, the active Cross Exposure grid sticks below the safe
area while the tray scrolls. Its compact controls include Hint and a thumbnail
of the selected photograph. Short landscape screens use 44px grid rows; tray
focus clearance follows the measured dock height. Finished boards return to
normal flow. Very short landscape viewports also use normal flow so the dock
cannot cover the entire photo tray.

Each Hint reveals exactly one previously hidden row or column clue and shows
how many remain. Headers, cell labels and the clue key reveal only those chosen
clues. A partial hint anchors its own line while unrevealed connections may
still be reordered; fully revealed and Visible clues retain positional checks.
New rounds reset hints.

Lobby settings use validated, versioned local storage. Cross Exposure saves
size, clue mode and starting photographs; Connections saves size, subject
detail and one-away hints; Double Take saves viewing time; Oracle saves its
mode; Guess Where saves region, timer and round count. Boards, scores, answers
and drawings remain per-round state. Storage reads happen after hydration and
cannot overwrite saved choices with first-render defaults. Invalid fields fall
back independently; unavailable storage does not prevent play.

Explicit Guess Where URL fields outrank saved preferences. Generated and copied
non-daily challenge links include all choices, including Everywhere and timer
Off, so a recipient's preferences cannot change the shared game. Daily stays
five untimed rounds and does not overwrite the player's saved choices. A shared
or daily seed deals only the first game: Play again deals fresh photographs
(after a daily, a random untimed practice game), since the answers are known.
URL fields never overwrite saved settings; only the player's own changes do.

## Sight Lines

A photograph word search at `/fun/sight-lines`. Named connections are
hidden as straight lines of three, four or five photographs, across, down or diagonally,
in either direction. Dynamically generated 5×5 through 10×10 boards use concrete subjects from captions and tags, with unique photographs
and four to eight guaranteed solutions, depending on size and available subjects.
Any other valid run of the chosen length also counts; overlapping connections are allowed.

Solutions require enough clear caption mentions of a concrete subject for the
chosen line length, rather than
broad scenery categories or tag-only matches. Caption prominence is a heuristic,
not object detection. Selection favours close-ups and earlier mentions, and
varies outings where location/date metadata permits. Highly overlapping topic
pools are separated. Fillers mix mostly unrelated photographs with a few
single-topic distractors. Up to sixteen candidate boards are scored for crowded
topics, multi-topic photographs and accidental solution lines; the best is used.
Truthful alternative lines still count, including weaker caption or tag matches.
Subject matching is shared with Photo Hangman, with results cached per board.

The numbered “Find these” word bank names all chosen subjects above the board.
Found subjects are crossed off; their numbers also mark the photographs and
linked result rows. Solid accent lines connect found runs. The current selection
and the unfound runs revealed by Give up use dashed lines.

Drag between endpoints, tap the two ends, or activate them with the keyboard.
Selected photographs have a larger preview. Hint marks the start of an unfound
line; Give up reveals every connection with links to its photographs. Completed
boards focus the result. Board size and line length are saved with the other game preferences.
The desktop board has a comfortable width; mobile uses the compact game-grid
spacing and retains 44px touch targets. Boards larger than 6×6 scroll horizontally
on small screens; touch uses tap-to-select endpoints while mouse dragging remains
available. Arrow keys move within the board; Home and End reach row edges.
The themed illustration is a deadpan giraffe with bird portraits pegged along
its outstretched neck and matching birds perched above them.

## Mobile context docks

Sight Lines keeps its word bank, feedback and active board together while the
selected-photo preview scrolls. Connections keeps selection count and its
Check, Deselect and Shuffle actions visible above the photo grid. Relay shows
a compact start-to-finish chain above the tray; Edit links returns focus to the
editable chain. Cross Exposure retains its grid and compact controls beside the
tray. Each dock needs at least 144px of usable space below it, after the bottom safe
area; oversized boards
and short viewports use normal flow. Results never retain sticky game controls.

Oracle's questions and answer controls, Blind Frame's drawing dialogue and
Double Take's sequential frame already contain their active tasks. They do not
add a sticky layer. Guess Where continues to use its viewport-filling map game.

## Photo Hangman

At `/fun/photo-hangman`, choose a concrete subject from a searchable tag bank.
Filtering does not make a guess. Two photographs start the round; each wrong
subject reveals another, with six misses ending the round. The answer's length
and descriptive captions stay hidden during play. Any bank subject matching all
eight photographs is accepted, including valid alternatives to the chosen noun.

The bank uses curated visual nouns supported by at least eight unique archive
photos. Caption and tag matches exclude simple negations and modifier traps
such as “train station” and “hot dog”. Caption prominence orders the clues from
less explicit mentions to clearer ones; this is a heuristic, not object detection.
New rounds avoid repeating the previous subject when another is available.

Players can revisit earlier clues. Subject buttons wait for photo decode;
failed images have a retry action. The clue panel uses the height-aware mobile
dock, with measured focus clearance for the tag bank and filter. Win, loss and
Give up reveal linked photos and focus the result. No text is submitted as an
answer and no word-length clue narrows the choices.

## Game interaction refinements

Cross Exposure and Photo Relay use a two-column desktop workspace with an
internally scrolling photo tray. On smaller screens their existing context docks
remain height-aware. Mouse drag sources are visibly dimmed, eligible destinations
are marked, and the currently hovered destination is highlighted. Fixed crossword
cells reject moves; outside drops, focus loss and cancellation clear drag state.
Tap/select and keyboard move/remove controls remain available without dragging.

Relay results describe every adjacent pair with measured resemblance and shared
indexed subjects, distinguish link resemblance from the overall rank among 120
orders, and identify the biggest jump. Subject clues explain metadata overlap,
not why the embedding produced a particular value.

Double Take answers reveal an immediate animated verdict with text and icons;
reduced-motion readers see the same verdict without movement. Connect the Shots
shuffle animates tiles to their new positions, with cancellation on a subsequent
shuffle and no animation under reduced motion. Oracle defaults to discovery;
an explicitly saved mode still wins.

Games show shortcuts as shared `KeyHint` badges inside their action buttons,
matching Guess Where. Badges hide on narrow phone layouts and are excluded from
button accessible names. Only the selected Oracle mode shows the start key.
Games expose phase-aware shortcuts:
N starts a new round where safe; G gives up, H hints and Escape clears selection
where supported. Oracle uses 1/2/3 for yes/no/unsure, B to undo; Double Take uses
1/2 for same/different place. Hangman uses / to focus its subject filter.
Guess Where uses Enter/Space to confirm and Enter/Space/→ for the next round,
through the same shortcut hook; arrows and Space on a focused map stay with the
map, and a focusable "Guess at map centre" action places a guess without a
pointer. Shortcuts
ignore typing, modifier combinations, held-key repeats and open modal dialogs;
native activation of focused buttons takes precedence over Enter/Space shortcuts.

## Player copy and stable lobbies

Game copy follows STE-inspired principles: short active sentences, one idea per
sentence, consistent names and concrete actions. Personality stays in small
phrases; scoring limits remain explicit in results. This is an adaptation for
play, not a claim of strict ASD-STE100 dictionary compliance. The reference is
[ASD-STE100](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).

The actual setup stays mounted while archive data loads. A disabled native
fieldset prevents early starts; shared shortcuts also wait for readiness. The
illustration is top-aligned and loading feedback has reserved space. Connection
hint labels keep the same width, and lives do not add a second setup description.

Oracle keeps the current question and its controls above a newest-first answer
trail. Clear answer badges distinguish Yes, No and Not sure. Back removes the
latest answer and restores its question; results retain the trail. Entry motion
is subtle and disabled for reduced-motion preferences. Keyboard hints remain
beside the active question controls.

## Hindsight

At `/fun/hindsight`, put four, five or six photographs (five by default) in
the order they were taken. Tap a photograph to place it in the next free slot,
drag it into place, or use the keyboard; placed photographs have move-earlier,
move-later and remove buttons. Keyboard placement moves focus to the next
photograph in the tray and then to Check order; moves keep focus on the moved
photograph, and undo or remove returns it to the tray photograph. The reveal
takes focus.

Order is the camera's wall clock (`exifWallClockTimestamp` over
`metadata.iso8601`), the same clock the reveal shows through
`formatExifWallClockDateTime`. No zone is applied. Photographs without a
parseable time are never dealt, and no two dealt photographs are within ten
minutes of each other, so ties and bursts cannot make an order ambiguous.

- **Across the years** deals from the whole archive, every pair at least 90 days
  apart. That is far wider than any difference between zones, so wall-clock order
  is also real order.
- **One trip** deals from one album (a photograph's directory), first to last
  within two weeks, each pair at least ten minutes apart. Within a trip that
  crosses zones the camera's clock is still the clock the reveal shows.

A hand dealt already in order is rotated before play. The score is the share of
all pairs the right way round (Kendall-tau style): n(n−1)/2 pairs, so one
photograph out of place costs only the pairs it breaks, where exact positions
would punish one early slip along the whole row. The reveal also counts
photographs in exactly the right place, shows each date with the gap from the
previous photograph, and links every photograph to its album. A perfect order
is a win; the best score is recorded.

The daily (`?daily`) is five photographs across the years, dealt from
`dailyPhotoOrder` with `dailyPuzzle("hindsight").random()`, so every device
with the same archive gets the same board on the same local day. It never reads
or saves the player's settings; Play again after a daily is a practice game
with the player's own settings. A finished daily is recorded once, with a
spoiler-free share text ("5 photographs · 80% in order"); replaying it the same
day is not recorded again. The lobby shows today's result and the personal record.

## Warmer and Caption It

Both compare the player's words with photographs through the search page's
SigLIP v1 text encoder (q4, 154,693,262 bytes), so they load v1 image vectors
like Blind Frame and never v2. Nothing downloads until the first guess or
caption; the lobby says so. `components/fun/useTextEncoder.ts` wraps the shared
worker and drops a result that a newer request or a new round replaced.

Scores are ranks, not similarities (`util/semanticGames.ts`): the target is
ranked among the whole archive by how well it fits the text. A raw cosine means
different things for different photographs — a busy street matches every word
a little — and a rank does not. A target in the top three counts as found,
because bursts of one scene tie for first.

- **Warmer.** A hidden photograph, blurred. Each guess is ranked, and the
  temperature is a share of the archive (burning under 1%, hot 5%, warm 15%,
  tepid 35%, cool 60%, else freezing), so it means the same in any collection.
  The best guess so far sets the blur. Repeated guesses are refused before
  encoding. Won when found; no best score.
- **Caption It.** A visible photograph and a caption of at most 120
  characters. Its fit is `rankDrawing`'s 0–100 score, and the archive's own
  caption is scored the same way as the bar to beat. Captions of one word, or
  that repeat a word three times, are refused before encoding — rank scoring
  already resists keyword stuffing, and this keeps the obvious attempt from
  costing a model download. Rewriting the same photograph is practice.

Both start with placeholder illustrations (see `docs/fun-illustrations.md`).

## Dailies, stats and next steps

Connect the Shots, Cross Exposure, Sight Lines, Photo Hangman, Hindsight,
Warmer, Caption It and Guess Where each offer one daily board, numbered from 14 October 2026 (#1) and
reached from the lobby or `?daily`. A daily follows the reader's local calendar
day and is dealt from the archive sorted by path with a seed of the game and
day (`util/gameDaily.ts`, `GameRecord.dailyPuzzle`/`dailyPhotoOrder`), so every
device with the same archive gets the same board; the archive itself arrives in
random order. Daily settings are fixed and never saved: Connect the Shots 4×4,
broad, hints, 4 lives; Cross Exposure 4×4, hidden, no starting photographs;
Sight Lines 6×6, 4 per line; Hangman its usual rules (never seeded by the
previous answer); Hindsight 5 photographs across the years; Warmer and
Caption It one photograph each; Guess Where five
untimed rounds with its existing `daily-YYYY-MM-DD` seed. A finished daily is
kept: the lobby shows its result and Share instead of offering it again, and a
replay counts as practice. Share text is spoiler-free — title, number and a
summary such as "4×4 · 1 mistake" — with a link back to the daily.

Every game records each finished game once, from the handler that ends it, in
`localStorage` (`fun-stats:<game>`, `util/gameStats.ts`): games played, wins,
a best score where one compares across games, and a streak of consecutive days
played. Best scores: Guess Where total points; Relay its visual-flow
percentile; Blind Frame its 0–100 resemblance; Double Take correct answers;
Hangman misses to spare; Hindsight the percentage of pairs in order; Caption
It its 0–100 fit. Connect the Shots, Cross Exposure, Sight Lines, Oracle and
Warmer record no best, since their
measures depend on board size or have no winner. The Fun hub marks games played
today. Links never write saved settings.

Results end with next steps: "Similar photographs" searches around the first
result photograph, and "Guess where these were taken" deals the located ones
(at least two, at most ten) to Guess Where through repeated `photos=` paths.
Every game loads coordinates for this; outside Guess Where, Double Take and
Hindsight, place and time stay out of the puzzles themselves — players cannot
reason about when or where an arbitrary photograph was taken. Sight Lines uses
coordinates only to avoid lines whose photographs share one outing.
