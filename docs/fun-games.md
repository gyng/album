# Fun

`/fun` is the illustrated entry to Guess Where, Photo Relay, Blind Frame and
Photo Oracle. The global navigation selects Fun for every game; its subnav
selects the current game. `/guess` redirects permanently to `/fun/guess`,
preserving existing challenge query strings. New share links use the new route.

## Game rules and data

Photo Relay uses one image embedding space, preferring SigLIP 2 and falling back
to SigLIP 1 for older archives. It chooses two endpoints and five distinct
photographs near interpolated positions between their normalised vectors.
The player orders the five photographs. All 120 possible orders are evaluated
by the sum of adjacent cosine similarities; the suggested route is the best.
The visual-flow score scales the player's sum between the worst and best orders
of this same tray. Give up reveals the complete suggested chain. Undo and replay
do not require new network requests. This measures embedding similarity rather
than editorial quality.

Blind Frame chooses a photograph with an existing AI caption and a SigLIP 1
embedding, then hides its image until the submitted sketch is compared. It
reuses the search drawing pad and browser image encoder. SigLIP 2 vectors must
never be substituted: the browser encoder produces SigLIP 1 vectors. The reveal
shows the sketch, hidden target, and closest archive photograph. The score
reflects the target's percentile rank among compatible archive vectors; it is
not the raw cosine expressed as a percentage. Ties share a rank. Model loading
reports progress; a failed encode retains the submitted blob for retry.

Photo Oracle offers up to twelve captioned/tagged photographs to remember.
The secret selection is held only for remembering and revealing, never passed
to the question/ranking functions. Visual questions are selected for the most
balanced split of current candidate weights. Answers multiply the likelihoods
rather than deleting disagreeing candidates, because captions can omit objects.
Not sure leaves weights unchanged and skips the question. The oracle guesses
after eight questions, at 85% relative confidence, or when no unused question
can divide the candidates. A rejected guess is removed and play continues.

Game data comes through `fetchPhotoGameArchive`, using the existing core and
split embeddings databases. Video scenes/clips are excluded. There is no new
runtime API, index migration or live caption generation. Games run in neutral
screens/components; Next routes remain thin adapters.

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
