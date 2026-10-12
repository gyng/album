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
- Radius: controls 8px, panels 12px; photograph overlays and badges may be pills.
- Keep photographs dominant. Use the accent for actions, selection and data;
  ordinary controls use neutral surfaces. Avoid decorative glow on page controls.

## Components

`components/ui/Control.module.css` supplies shared form/action geometry through
CSS Modules composition. `Button`, `Pill`, `Input` and `Select` inherit it.
`SegmentedToggle` uses the same tokens for its grouped structure.

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
