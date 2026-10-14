# Gallery design system

The gallery adapts Radix Themes' spacing, typography and restrained component
styling to its own CSS Modules and theme registry. The implementation is owned
here: no Radix theme provider or component package is required. Accessible
native controls and the existing platform boundary remain the default. New
complex interactions can adopt an accessible primitive behind the existing UI
API when there is a concrete need, not a second component/theme runtime.

References: [Radix spacing](https://www.radix-ui.com/themes/docs/theme/spacing),
[typography](https://www.radix-ui.com/themes/docs/theme/typography), and
[styling guidance](https://www.radix-ui.com/themes/docs/overview/styling).
These are design references; the CSS is authored for this gallery.

## Foundations

`src/styles/globals.css` owns tokens. `/design` is the working catalogue.

- Spacing: `--space-1` through `--space-9` are 4, 8, 12, 16, 24, 32, 40, 48
  and 64px. Use 8px within control groups, 16px within panels, 24px between
  related sections and 48px between larger sections.
- **New rules use `--space-*`.** `--m-*` is the legacy scale and still the most
  common token, but do not add to it: `test/spacingTokens.test.ts` is a ratchet
  that fails when its use grows. Migrate a rule when you are already editing it,
  and lower the baseline with it. Do not remap `--m-*` or numeric `--size-*`
  globally — chart sizes and image layout depend on them.
- `--size-*` names fixed geometry (borders, icon boxes, thumbnail and layout
  widths); prefer it to a raw pixel value. Lines use `--line-hairline` (1px) and
  `--line-strong` (2px).
- Page gutters: `--page-gutter` is 40px on desktop and 24px at 720px and below.
  Honour safe-area insets on full-screen surfaces.
- Type: body 18px (`--fs-m`) with 1.5 line height; labels 14px/20px (`--fs-sm`,
  `--lh-label`); metadata 12px/16px (`--fs-s`, `--lh-caption`); chart
  annotations 10px (`--fs-xs`), dense annotations 9px (`--fs-2xs`). Inputs on
  touch devices use `--fs-touch`. Headings use a 1.25 line height and slight
  negative tracking. Named themes retain their authored display fonts. Shared
  heading size defaults have low specificity, so album display titles and other
  authored heading sizes win regardless of CSS chunk order.
- Surfaces: page uses `--c-bg`, panels `--c-surface`, hover `--c-surface-hover`.
  Borders use `--c-border`; stronger hover borders use `--c-border-hover`.
  These derive from each theme's own background and text colours.
- Selection: `--c-selected` and `--c-selected-border` describe a soft accent
  surface. Focus uses the existing accent ring; focus and selection are distinct.
  Every selected state also carries its ARIA state (`aria-pressed`,
  `aria-checked`, `aria-selected` or `aria-current`): forced colours repaint the
  accent surface as Canvas, and `globals.css` keys the system `SelectedItem`
  colours on those attributes instead.
- Radius: controls 8px, panels 12px, sheets 16px and image previews 4px
  (`--radius-control`, `-panel`, `-sheet`, `-preview`). Photograph overlays,
  badges and progress tracks may be pills (`--radius-pill`).
- Stacking uses the `--z-*` scale (`--z-raised` through `--z-details`), never a
  raw number.
- Keep photographs dominant. Use the accent for actions, selection and data;
  ordinary controls use neutral surfaces. Avoid decorative glow on page controls.

## Components

Shared primitives live in `src/components/ui/` and are exported from its barrel.

- `Button` / `ButtonLink` — actions. Primary fill is for the main action; quiet
  actions use minimal chrome; `active` marks a selected option and must be paired
  with `aria-pressed`.
- `Pill` / `PillButton` — legacy rounded action links and buttons, sharing
  `Button`'s control shape. Search tags remain chips and photograph overlay
  controls remain pills.
- `Input` / `Select` / `SegmentedToggle` — form controls on the shared geometry.
- `Card`, `Heading` / `Caption`, `Thumb` — surfaces, hierarchy and thumbnails.
- `OverlayButton` — dark glass for controls over photographs.
- `Icon` — the shared SVG set. Icons inherit `currentColor` and occupy a fixed
  em-sized box. Hide decorative icons from assistive technology and name
  icon-only controls by their action.
- `KeyHint` — a keyboard shortcut badge inside an action button.
- `LoadingIndicator` — model warm-up and pending work; its spinner stops under
  reduced motion.
- `ChartTooltip` / `TooltipSurface` — hover tooltips for charts and the
  accent-tinted surface for popover help.
- `StatBar` (in `components/`) — labelled count rows with a 44px minimum height
  and an 8px gap between repeated rows. Wrapping labels can increase height; do
  not clip labels to preserve a fixed row.

`components/ui/Control.module.css` supplies shared form/action geometry through
CSS Modules composition. `Button`, `Pill`, `Input` and `Select` inherit it.
`SegmentedToggle` uses the same tokens for its grouped structure. The shared
`compact` and `icon` classes also cover screen-owned controls, including filter
chips, map actions, recovery actions and drawing tools. Shared foundations use
`:where()` to keep specificity low: a component variant or touch rule must win
regardless of CSS chunk/import order. Compose only within a single local class
selector, never a grouped selector.

- Standard controls have a 44px minimum height and 12px horizontal padding.
- Compact controls use 32px, with 12px labels and 16px line height. Coarse-pointer
  devices increase compact controls to 44px. Inputs and selects use at least
  16px text on touch devices to avoid Safari's focus zoom.
- Input defaults use low-specificity selectors so shared controls and adorned
  fields retain their padding. Search clear buttons keep a 44px target at the
  trailing edge; text and activity indicators reserve separate space beside it.
- Navigation and theme/map pickers use standard density even when a picker has
  a compact visual variant. Icons have explicit boxes and do not set row height.
- Selected navigation, facets and segmented controls share the soft accent
  treatment, and keep it on hover. Disabled controls reduce opacity and retain
  their labels.
- Cards and filter controls use shared surface/border/radius tokens. Actions keep
  their natural width inside cards; full-width fields are reserved for forms.
- Split nav buttons use the same surface, text colour and radius as ordinary
  controls.

## Layout and hierarchy

Headings establish sections; captions carry information the heading cannot.
Metadata stays secondary but legible. Data lists use tabular numbers. Dense
controls wrap or scroll within their own region, never widen the page. Photo
and map canvases keep their geometry; the design system styles their surrounding
controls, panels and captions. Screen-owned layout remains in screen CSS
Modules. Do not replace photo presentation, map data layers or slideshow state
machines to achieve a visual change.

## Shared patterns

### Navigation

- Reveal the active navigation item without animation on mount, then recheck
  after theme fonts settle; opening a game or moving focus must not leave it
  clipped. Scrolling game subnavs also keep their active link visible.
- Position changes use independent measured 180ms translations for the link
  list, trailing controls and appearance controls, including the map-to-page
  switch and Guess Where's move into its viewport layout. Initial loads stay
  still and reduced motion skips the translation. Right controls anchor to their
  right edge, so a wider appearance group does not move the theme selector.
  Sticky nav regions use viewport coordinates in these animations; ordinary
  desktop nav uses document coordinates.
- **Album navigation** scrolls normally on desktop, without a divider. At 720px
  and below it stays mounted in a sticky slot, and only its surface translates,
  so hiding it never changes the photographs' document positions. Beyond the nav
  height, 24px of sustained downward travel hides it; 32px upward brings it
  back. Direction reversals restart the threshold. Focus keeps it visible, photo
  anchors clear its measured height, and reduced motion removes the slide. The
  album's main content has its own stacking context so its photos and open
  details stay beneath the mobile nav. The initial page-load event and
  height-only viewport changes (mobile address bars) preserve scroll intent; a
  browser-history restoration or a width change resets it to visible.

### Sticky docks

- Use a sticky board when photographs outside it need to be compared or placed.
  Docks activate only when the visual viewport has at least 144px remaining
  below them, including safe-area clearance, and return to normal flow on
  completion.
- Active docks use the sticky z-index, safe-area clearance and an opaque theme
  background. Keep the grid, primary contextual action and compact
  selected-photo preview together. Long lists scroll below the dock, and result
  views return to normal flow.
- A dock reports its measured sticky height to nearby controls, which use it for
  scroll-focus clearance. It resets to zero when the dock releases or the
  viewport is too short.

### Overlays

Photograph and kiosk overlays use fixed dark glass, on-dark text/borders and
pill-shaped media controls. Their geometry still follows the shared touch target
and spacing rules. A light site theme must not turn overlay labels dark. Gear
photograph actions use the same glass. Floating overlays retain their deliberate
stacking rules.

### Drawing

Drawing uses white paper because the submitted raster is filled white; sketch
canvases stay white in every theme. Colour swatches remain round, 44px and never
shrink; tools wrap when space runs out. Toolbars use the shared SVG icons and
native hover tooltips with stable accessible names; brush-size buttons show
stroke-width dots. Fine pointers use 32px tool controls and coarse pointers keep
44px targets. Selected tools combine an accent border with `aria-pressed`,
separate from the keyboard focus ring. Desktop drawing rounds expose the shared
pad immediately; the same controls provide undo/redo and an eraser in inline and
modal layouts. Drawing dialogs preserve their draft on close and use short
action labels that fit a phone's control row.

### Workspaces, drag and keyboard

Game workspaces pair the task and a bounded scrolling photo tray on desktop,
then use ordinary vertical flow and height-aware docks on small screens. Drag
sources and eligible, hovered and fixed destinations have distinct visual
states; tap and keyboard alternatives remain first-class. Keyboard shortcuts are
shown as `KeyHint` badges inside action buttons; badges inherit button contrast
and hide on narrow phones. Shortcuts never intercept text entry or native
activation. Progress, errors and reveals receive focus so keyboard users can
continue from the current state.

### Loading and motion

Lobbies keep their real setup mounted during loading, with disabled controls and
a reserved feedback row; top-aligned artwork stays fixed as data arrives. Use
`LoadingIndicator` for model warm-up and pending image comparisons. A model warms
on first use (the first stroke, a submitted query), never merely because a page
loaded. Timer urgency, score reveals, map-pin feedback, short verdicts and
shuffles may animate and respect reduced motion; ordinary buttons use shared
hover/selection states without shimmer or perpetual glow.

## Deliberate variants

Consistency follows the role of the surface, rather than making every element
look like a form control.

- Maps, contact sheets, photo frames and visualisation canvases keep their own
  geometry and data colours. Panel framing uses the shared border/radius tokens.
  A route drawing's square frame, heatmap cells and focal dots are data marks.
- Compact badges, attribution, keyboard hints and chart annotations are read-only
  metadata, not 44px controls. A photograph/grid pagination tile can match the
  image tile it sits among. Continuation placeholders may use a dashed border.
- Hover-revealed remove buttons on thumbnails (the similar-search trail) are
  small with a fine pointer; coarse pointers always get 44px.
- Photo-choice buttons have a visible border and never depend on hover alone.
  Selected photographic tiles keep full image opacity and combine an accent
  outline with a tick badge.
- Mobile game grids use 8px page gutters, 4px photo gaps and 1px tile padding at
  720px and below, giving the space to the photographs rather than nested card
  padding, while preserving 44px targets and safe-area clearance.

## Screen notes

### Albums and photo details

- Photo-detail panels have a 30rem readable width, clamped to the viewport
  gutters. Metadata uses a fixed two-column table so deferred maps and
  similarity content cannot change its layout after opening.
- The sticky info trigger keeps its 44px footprint when opened; its panel floats
  below it and scrolls internally. Only the photo with open details releases
  off-screen paint containment, keeping the panel usable past the photo's edge.
- Tags and colour swatches link to the corresponding search. Weather shows the
  condition and temperature; secondary readings, provenance and attribution live
  in the left-aligned “Estimate details” disclosure.
- Shutter speeds use ordinary reciprocal fractions, with three-significant-figure
  decimals for non-unit fractions.
- Album year ranges follow the displayed photo order (newest-first albums show
  latest–earliest), and year captions append photo counts. Home previews carry
  totals before their covers are pruned.

### Explore

- Explore opens with section navigation. Archive totals belong in Fun stats as a
  plain definition list with horizontal separators. Section labels describe the
  photographs without addressing the visitor as their photographer.
- Weather buckets may include up to four linked examples, spread across the
  matching set; sparse thumbnail rows keep the size of full rows.
- Colour history defaults to the first non-neutral palette colour, with a
  Dominant view for comparison; neutral-only photos keep their neutral tone.
  Year summaries pair the dominant family with the leading accent, and both
  views use the same photos and counts. Representative colour rows reserve a
  compact control footer even when there are no more photos.
- The cloud's atlas thumbnails and full-resolution focus images use the same
  centred square crop, so the subject stays in place as the sharper image
  arrives. Dots remain until their thumbnail is ready. Layout and data:
  [Explore cloud](explore-cloud.md).

### Search

The desktop category rail scrolls within its bounded panel. Compact filter
sheets wrap the categories and scroll the values. Long labels must not widen the
page.

### Fun!

Fun! groups the archive games behind one global navigation entry and a game
subnav: three columns on desktop, two on medium screens, one on phones. Rules
and illustration prompts: [Fun games](fun-games.md).

- Cards use transparent hand-drawn animal cartoons tinted with the theme's
  accent (on cards and illustrated starts), a heading, one short description
  and an explicit Play action. Jokes read at card scale without a caption;
  expressive silhouettes and restrained hatching keep the set coherent.
  Illustrations share the text inset. Lobbies reuse the card illustration.
- Results show their scoring basis beside the score. Allow a final review before
  scoring a photo sequence. Comparison images use semantic figure captions.
- Guess Where keeps its full-height photo/map layout and narrow canvas gutters;
  its lobby keeps the regular gutter and width until play starts, aligns options
  in one column (labels above controls on narrow screens) and starts both
  actions on one baseline. Pair galleries open with up to three complete rows
  and reveal another per press; captions must not widen their pairs.
- Image grids fit phones and tablets with a narrow coordinate column, compact
  headers and a full clue key below the board; Cross Exposure uses 2px table
  spacing. Selected photographs get a larger preview. Full-frame flash stages
  contain their images without cropping.
- Connections pins its compact action bar rather than its grid; Relay pins a
  miniature chain reference above the tray; Sight Lines keeps its word bank and
  board together; Photo Hangman's filter and subject bank use the dock-height
  contract. Oracle, Blind Frame and Double Take stay in normal flow.
- Player copy uses short active sentences and consistent action names, with
  light humour where it adds character. Oracle's answer history uses compact
  rows and explicit answer badges beneath the question.

### Themes and identity

Darkroom's safelight accent is `#ed3535`; default Dark uses `#ff5959` for
readable accent text on charcoal. Both avoid an orange tint. Browser and install
icons share a six-blade aperture mark: the favicon is a small SVG and install
PNGs are generated from the canonical `public/pwa-icon.svg`.

## Screen coverage

| Screen or state | Shared rules and deliberate treatment |
| --- | --- |
| Albums and individual albums | Standard navigation; photograph geometry; readable metadata panels |
| Explore overview and sections | Shared cards, compact controls, bar rows and chart framing |
| Timeline and trips | Shared navigation, filters and day actions; data rails remain specialised |
| Search, image queries and active filters | Compact chips, selected states, bounded rails and consistent clear/retry actions |
| Filter sheet and drawing dialog | Sheet/panel radii; reachable actions; full touch targets and wrapping tools |
| Map search, menus and time range | Standard search frame; compact Fit/Tour actions; shared panel borders |
| Fun! lobbies, rounds and results | Shared actions and surfaces; full-height gameplay and semantic game feedback |
| Slideshow, remix and media controls | Shared geometry on fixed dark glass; photo presentation remains specialised |
| Slideshow shell and diagnostics | Compact kiosk overlay versus readable document cards, rows and actions |
| Design catalogue | Live standard/compact/filter states, status rows and the real drawing dialog |
| Missing page, render error and update banner | Readable status copy, shared recovery actions and visible focus |

The missing-page document is a renderer adapter because Next's build-only App
Router otherwise replaces the gallery's generated 404. It installs the shared
pre-paint theme bootstrap and reuses the portable recovery screen.

## Maintaining the system

Use semantic tokens and shared components before adding screen-specific rules.
Add new components and states to `/design`, including long labels, selected,
disabled and compact examples. Check Light, Darkroom and an expressive named
theme, plus 390px touch and desktop layouts. Preserve native keyboard operation,
visible focus, reduced motion and forced colours — a new selected state needs
its ARIA attribute, not only a class. Run the relevant tests and full lint
before committing; publish only when requested.

This file states rules, not history: record what changed and how it was
validated in the commit.
