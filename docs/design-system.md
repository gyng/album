# Gallery design system

The gallery adapts Radix Themes' spacing, typography and restrained component
styling to its own CSS Modules and theme registry. The implementation is owned
here: no Radix theme provider or component package is required. Accessible
native controls and the existing platform boundary remain the default.

References: [Radix spacing](https://www.radix-ui.com/themes/docs/theme/spacing),
[typography](https://www.radix-ui.com/themes/docs/theme/typography), and
[styling guidance](https://www.radix-ui.com/themes/docs/overview/styling).
These are design references; the CSS is authored for this gallery.

## Foundations

`src/styles/globals.css` owns tokens. `/design` is the working catalogue.

- Spacing: `--space-1` through `--space-9` are 4, 8, 12, 16, 24, 32, 40, 48
  and 64px. Use 8px within control groups, 16px within panels, 24px between
  related sections and 48px between larger sections.
- Page gutters: `--page-gutter` is 40px on desktop and 24px at 720px and below.
  Honour safe-area insets on full-screen surfaces.
- Legacy `--m-*` and numeric `--size-*` tokens remain for existing geometry.
  Do not remap them globally: chart sizes and image layout depend on them.
- Type: body 18px with 1.5 line height; labels 14px/20px; metadata 12px/16px;
  chart annotations 10px. Headings use a 1.25 line height and slight negative
  tracking. Named themes retain their authored display fonts.
- Surfaces: page uses `--c-bg`, panels `--c-surface`, hover `--c-surface-hover`.
  Borders use `--c-border`; stronger hover borders use `--c-border-hover`.
  These derive from each theme's own background and text colours.
- Selection: `--c-selected` and `--c-selected-border` describe a soft accent
  surface. Focus uses the existing accent ring; focus and selection are distinct.
- Radius: controls 8px, panels 12px, sheets 16px and image previews 4px.
  Photograph overlays and badges may be pills.
- Keep photographs dominant. Use the accent for actions, selection and data;
  ordinary controls use neutral surfaces. Avoid decorative glow on page controls.

## Components

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
- Navigation and theme/map pickers use standard density even when a picker has
  a compact visual variant. Icons have explicit boxes and do not set row height.
- `Button` is an action. Primary fill is for the main action; quiet actions use
  minimal chrome. Legacy `Pill` action links/buttons use the same rounded control
  shape. Search tags remain chips, and photograph overlay controls remain pills.
- Selected navigation, facets and segmented controls share the soft accent
  treatment. Disabled controls reduce opacity and retain their labels.
- Cards and filter controls use shared surface/border/radius tokens.
  Photo-detail panels have a 30rem readable width, clamped to the viewport
  gutters. Floating overlays retain their deliberate glass and stacking rules.
- Actions keep their natural width inside cards; full-width fields are reserved
  for forms. Selected controls retain their accent surface on hover.
- `StatBar` has a 44px minimum row height; repeated rows have an 8px gap.
  Wrapping labels can increase height. Do not clip labels to preserve a fixed row.

## Layout and hierarchy

Headings establish sections; captions carry information the heading cannot.
Metadata stays secondary but legible. Data lists use tabular numbers. Dense
controls wrap or scroll within their own region, never widen the page. Photo
and map canvases keep their geometry; the design system styles their surrounding
controls, panels and captions.

The shared components cover gallery navigation, albums, Explore, search, maps,
timeline/trips and slideshow controls. Screen-owned layout remains in screen
CSS Modules. Do not replace photo presentation, map data layers or slideshow
state machines to achieve a visual change.

## Deliberate variants

Consistency follows the role of the surface, rather than making every element
look like a form control.

- Photograph and kiosk overlays use fixed dark glass, on-dark text/borders and
  pill-shaped media controls. Their geometry still follows the shared touch
  target and spacing rules. A light site theme must not turn overlay labels dark.
- Drawing uses white paper because the submitted raster is filled white. Colour
  swatches remain round, 44px and never shrink; tools wrap when space runs out.
  Brush selection uses an accent border, separate from the keyboard focus ring.
- Maps, contact sheets, photo frames and visualisation canvases keep their own
  geometry and data colours. Panel framing uses the shared border/radius tokens.
  A route drawing's square frame, heatmap cells and focal dots are data marks.
- Compact badges, attribution, keyboard hints and chart annotations are read-only
  metadata, not 44px controls. A photograph/grid pagination tile can match the
  image tile it sits among. Continuation placeholders may use a dashed border.
- Weather buckets may include up to four linked archive examples, spread across
  the matching set. Keep sparse thumbnail rows at the same size as full rows.
  Photo metadata uses a fixed two-column table so deferred maps and similarity
  content cannot change its horizontal layout after opening.
- Guess Where keeps its full-height photo/map layout and narrow canvas gutters.
  Lobby/results use readable document widths. Timer urgency, score reveals and
  map-pin feedback may animate; ordinary game buttons use shared hover/selection
  states without decorative shimmer or perpetual readiness glow.
- The Guess Where lobby aligns its option controls in one column and starts
  both actions on the same baseline. Narrow screens stack each option label
  above its control. Pair galleries open with up to three complete rows and
  reveal another row per press; captions must not widen their photograph pairs.
- UI icons use the shared `Icon` SVG set, inherit `currentColor`, and occupy a
  fixed em-sized box. Keep decorative icons hidden from assistive technology
  and name icon-only controls by their action. `/design` shows the full set.
- Photo detail tags and colour swatches link to the corresponding search.
  Secondary weather readings live under “Estimate details”; conditions and
  temperature stay visible. Use ordinary reciprocal shutter fractions, with
  three-significant-figure decimals for non-unit fractions. Album year captions
  append photo counts; home previews carry totals before their covers are pruned.
- The desktop search category rail scrolls within its bounded panel. Compact
  filter sheets wrap the categories and scroll the values. Long labels must not
  widen the page. Selection stays recognisable on hover.

## Screen coverage

| Screen or state | Shared rules and deliberate treatment |
| --- | --- |
| Albums and individual albums | Standard navigation; photograph geometry; readable metadata panels |
| Explore overview and sections | Shared cards, compact controls, bar rows and chart framing |
| Timeline and trips | Shared navigation, filters and day actions; data rails remain specialised |
| Search, image queries and active filters | Compact chips, selected states, bounded rails and consistent clear/retry actions |
| Filter sheet and drawing dialog | Sheet/panel radii; reachable actions; full touch targets and wrapping tools |
| Map search, menus and time range | Standard search frame; compact Fit/Tour actions; shared panel borders |
| Guess lobby, round and results | Shared actions and surfaces; full-height gameplay and semantic game feedback |
| Slideshow, remix and media controls | Shared geometry on fixed dark glass; photo presentation remains specialised |
| Slideshow shell and diagnostics | Compact kiosk overlay versus readable document cards, rows and actions |
| Design catalogue | Live standard/compact/filter states and the real drawing dialog |
| Missing page, render error and update banner | Readable status copy, shared recovery actions and visible focus |
| Legacy timeline/trips routes | Redirect to the corresponding Explore screen |

## Maintaining the system

Use semantic tokens and shared components before adding screen-specific rules.
Add new component states to `/design`, including long labels, selected, disabled
and compact examples. Check Light, Darkroom and an expressive named theme, plus
390px touch and desktop layouts. Preserve native keyboard operation, visible
focus, reduced motion and forced colours. Run the relevant tests and full lint
before committing; publish only when requested.

## Adoption review — 12 October 2026

The initial refinement applies these foundations to shared controls, navigation,
cards, Explore, search facets, map menus, photo details, timeline/trips and
slideshow controls. `/design` includes standard/compact controls, long labels,
disabled states, selected surfaces and the new token scale.

Validation: all 2,976 Jest tests and the full lint/type/format gates pass.
Chromium coverage checks control alignment in Light, Darkroom and Slate,
coarse-pointer density, readable photo-detail widths, and the existing search,
Explore, timeline, slideshow and smoke journeys. The full archive was reviewed
at 1440px and 390px across the gallery, album, Explore, search, map, timeline,
trips and catalogue; no horizontal overflow was found. WebKit with iPad touch
emulation also keeps standard and compact controls aligned at 44px.

This is an adaptation of the design foundations, rather than installation of a
second component/theme runtime. New complex interactions can adopt an accessible
primitive behind the existing UI API when there is a concrete need.

## Site-wide refinement review

The follow-up passes cover the remaining screen-owned controls, game lobby and
results, map framing, diagnostics, recovery screens and drawing tools. The
catalogue now includes live filter states and the real drawing dialog. Shared
control defaults use low specificity so compact sizes and touch input fonts
remain stable when production CSS chunks arrive in a different order.

Phone drawing swatches retain their full 44px width and wrap; desktop search
categories scroll inside their panel. Selected filters preserve their emphasis
on hover. Gear photograph actions use the same dark glass as other media
overlays. Game actions use quiet shared states, while meaningful timer, score
and map feedback retain their own treatment.

The missing-page document uses a renderer adapter because Next's build-only
App Router otherwise replaces the gallery's generated 404. The adapter installs
the shared pre-paint theme bootstrap and reuses the portable recovery screen;
it does not introduce a second screen implementation or a runtime data API.
The [Next global missing-page convention](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
is isolated to that adapter; the browser head port waits until mount so its
metadata updates agree with the server markup during hydration.

The full archive was reviewed at 1440px in Light and 390px in Darkroom across
albums, Explore, timeline, trips, search, map, Guess Where, diagnostics, the
catalogue and recovery page. No document overflow was found. WebKit iPad
emulation also checks the catalogue, game, diagnostics and drawing dialog.

Validation: 2,976 Jest tests and all lint/type/format gates pass. The production
Chromium suite passes its 100 existing checks; after the final recovery adapter
correction, all 26 catalogue, hydration and route smoke checks pass, including
the new unknown-URL regression and HTTP 404 status. Three redundant Chromium
smoke cases remain intentionally skipped by the existing suite.
