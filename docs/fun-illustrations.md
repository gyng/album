# Fun illustrations

Replacement set generated on 13 October 2026 using the built-in imagegen tool,
with `transparent_background: true`, one generation per asset. The old set has
been replaced at the existing URLs. Encoded with Sharp to 960×640 AVIF, quality
85, effort 6; alpha retained. Higher quality preserves fine cross-hatching.

The shared SVG in `GameIllustration` inverts RGB while preserving alpha, then uses luminance
as a mask for theme-coloured ink. This knocks out the pale paper within the
engraved objects too. Transparent RGB may contain arbitrary background colours;
those must never become visible. No opaque background or colour variant is
added by the renderer. All artwork is decorative; game names and descriptions
remain the accessible link content.

## Shared generation prompt (verbatim)

> Use case: illustration-story. Asset type: a decorative game-card illustration for a photo archive website. A nineteenth-century hand-drawn copperplate / wood engraving, like antique natural-history plates and the meticulous animal engravings associated with classic technical-book covers. Fine black ink contour lines, dense delicate cross-hatching and stippling, skilled but visibly handmade, no cartoon outlines, no modern vector styling. Single centred vignette in a landscape 3:2 canvas, entire subject in frame with generous transparent margins. Pure black ink marks on a genuinely transparent background, including all spaces between hatch marks and all uninked interior areas. NO white paint or paper rectangle, no coloured fills, no gradients, no lettering, no border, no text, no watermark. This artwork will be recoloured by the app using its alpha channel; delicate ink detail must remain clear at card scale.

Each request appends `Subject: ` followed by its subject below.

## Guess Where — `public/fun/guess-where.avif`

> An antique brass pocket compass resting upon a partly unfolded street map, with a small magnifying glass and a photographic print of a narrow old street. The compass is the dominant recognisable subject. Map and photograph scenes are drawn entirely as engraving lines; their blank paper areas are transparent.

## Photo Relay — `public/fun/photo-relay.avif`

> Five small photographic prints arranged in a gentle winding chain, joined by a single looping thread. Each print contains a different engraved scene progressing from doorway, stone arch, arched bridge, rolling hill to mountain. All five prints clearly separate and readable; the thread suggests an unfolding visual connection. No hands.

## Blind Frame — `public/fun/blind-frame.avif`

> An open artist's sketchbook, an old wooden pencil laid diagonally beside it, and a small photographic print tucked partly behind the page. The sketchbook carries an unfinished ink drawing of an old street, the hidden print a more finished view of the same scene. White areas of the pages are transparent, not opaque.

## Photo Oracle — `public/fun/photo-oracle.avif`

> An antique crystal ball on an ornate but restrained three-footed carved stand, accompanied by three small photographic prints. Within the ball a tiny engraved architectural street scene is visible, curved glass represented only by fine contour and hatch lines, not opaque white or grey fill. Enigmatic and scholarly, like an antique illustrated encyclopaedia plate.


## Connect the Shots — `public/fun/connect-the-shots.avif`

Full standalone prompt:

> Use case: illustration-story. Asset type: decorative photo-game illustration. A nineteenth-century hand-drawn copperplate / wood engraving, like antique natural-history plates and classic technical-book cover engravings. Fine black ink contour lines, delicate cross-hatching and stippling, visibly handmade, no cartoon or modern vector style. Single centred vignette, landscape 3:2, generous transparent margins. Subject: sixteen small photographic prints on a table, being sorted into four clear loose clusters of four; recognisable engraved subjects include trees, stone arches, birds and boats. A single antique magnifying glass rests alongside the arrangement. Show the pleasure of finding relationships between pictures. Pure black ink, genuine transparent background, including empty space between groups. No opaque paper backdrop, no gradients, no colour, no lettering, no text, no watermark. This art will become a luminance mask and be recoloured by the application's theme.
