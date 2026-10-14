import { Icon } from "../../components/ui/Icon";
import { useState } from "react";
import { SearchDrawPad } from "../../components/search/SearchDrawPad";
import { SearchFilterPill } from "../../components/search/SearchFilterPill";
import { WeatherIcon } from "../../components/WeatherIcon";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import {
  Card,
  Button,
  ButtonLink,
  ChartTooltip,
  Footer,
  Heading,
  Caption,
  Input,
  KeyHint,
  LoadingIndicator,
  OverlayButton,
  OverlayButtonLink,
  Pill,
  PillButton,
  pillStyles,
  SegmentedToggle,
  Select,
  Thumb,
  TooltipSurface,
} from "../../components/ui";
import { StatBar } from "../../components/StatBar";
import commonStyles from "../../styles/common.module.css";
import styles from "./DesignScreen.module.css";

const spacingTokens = [4, 8, 12, 16, 24, 32, 40, 48, 64].map((value, index) => ({
  name: `--space-${index + 1}`,
  value,
}));

const fontTokens = [
  { name: "--fs-2xs", value: "9px", sample: "Micro — dense chart annotations" },
  { name: "--fs-xs", value: "10px", sample: "Extra small — chart labels, badges" },
  { name: "--fs-s", value: "12px", sample: "Small — captions, metadata" },
  { name: "--fs-sm", value: "14px", sample: "Small-medium — body text, controls" },
  { name: "--fs-m", value: "18px", sample: "Medium — base font size" },
  { name: "--fs-l", value: "24px", sample: "Large — section headings" },
  { name: "--fs-xl", value: "64px", sample: "Extra large" },
];

const colourTokens = [
  { name: "--c-bg", label: "Background" },
  { name: "--c-surface", label: "Panel / control" },
  { name: "--c-surface-hover", label: "Hover" },
  { name: "--c-border", label: "Border" },
  { name: "--c-selected", label: "Selected surface" },
  { name: "--c-selected-border", label: "Selected border" },
  { name: "--c-font", label: "Text" },
  { name: "--c-bg-contrast-light", label: "Contrast light" },
  { name: "--c-bg-contrast-dark", label: "Contrast dark" },
  { name: "--c-accent", label: "Accent" },
  { name: "--c-overlay", label: "Overlay" },
  { name: "--c-overlay-dark", label: "Overlay dark" },
  { name: "--c-border-on-dark", label: "Border on dark" },
  { name: "--c-bg-edit", label: "Editing surface" },
  { name: "--c-success", label: "Success" },
  { name: "--c-warning", label: "Warning" },
  { name: "--c-danger", label: "Danger" },
  { name: "--c-today", label: "Today" },
];

const motionTokens = [
  { name: "--t-fast", label: "Fast interaction" },
  { name: "--t-base", label: "Standard transition" },
  { name: "--t-slow", label: "Deliberate reveal" },
  { name: "--t-theme", label: "Theme cross-fade" },
  { name: "--ease-out", label: "Natural deceleration" },
  { name: "--ease-spring", label: "Expressive entrance" },
];

const sections = [
  "icons",
  "controls",
  "surfaces",
  "filters",
  "drawing",
  "spacing",
  "typography",
  "colours",
  "motion",
  "headings",
  "card",
  "thumb",
  "inputs",
  "pill",
  "overlay-button",
  "chart-tooltip",
  "status",
  "buttons",
  "stack",
] as const;

const Code = ({ children }: { children: string }) => (
  <code className={styles.codeHint}>{children}</code>
);

const DesignPage = () => {
  const [toggleValue, setToggleValue] = useState("a");
  const [overlayToggleValue, setOverlayToggleValue] = useState("a");
  const [inputValue, setInputValue] = useState("");
  const [filterSelected, setFilterSelected] = useState(true);
  const [drawingOpen, setDrawingOpen] = useState(false);

  return (
    <div className={styles.page}>
      <Seo title="Design" pathname="/design" noindex />
      <main id="main-content" className={styles.main}>
        <GlobalNav hasPadding={false} />
        {/* Header */}
        <header className={styles.section}>
          <div>
            <Heading level={1} as="h1">
              Design
            </Heading>
            <p className={styles.intro}>
              Adapted Radix foundations, photographic themes and shared components. Import from{" "}
              <code className={styles.codeHint}>components/ui</code>.
            </p>
          </div>
          <nav className={styles.jumpNav} aria-label="Jump to section">
            {sections.map((id) => (
              <a key={id} href={`#${id}`} className={`${pillStyles.base} ${pillStyles.surface}`}>
                {id.replace(/-/g, " ")}
              </a>
            ))}
          </nav>
        </header>

        <section id="controls" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Control geometry</Heading>
            <Caption>Standard 44px; compact 32px, increasing to 44px on touch devices.</Caption>
          </div>
          <div className={styles.controlDemo} data-control-density="standard">
            <Button>Browse photos</Button>
            <Button variant="primary">Explore</Button>
            <Button disabled>Unavailable</Button>
            <Select aria-label="Standard density camera" defaultValue="all">
              <option value="all">All cameras</option>
            </Select>
            <Input
              className={styles.controlDemoInput}
              aria-label="Standard density search"
              placeholder="Search photographs"
            />
            <SegmentedToggle
              ariaLabel="Standard density view"
              value={toggleValue}
              onChange={setToggleValue}
              options={[
                { value: "a", label: "Photos" },
                { value: "b", label: "Details" },
              ]}
            />
          </div>
          <div className={styles.controlDemo} data-control-density="compact">
            <PillButton size="compact">More</PillButton>
            <PillButton size="compact" variant="ghost">
              Mostly clear
            </PillButton>
            <PillButton size="compact" disabled>
              Unavailable
            </PillButton>
            <Select variant="compact" aria-label="Compact density camera" defaultValue="all">
              <option value="all">All cameras</option>
            </Select>
            <SegmentedToggle
              size="compact"
              ariaLabel="Compact density view"
              value={toggleValue}
              onChange={setToggleValue}
              options={[
                { value: "a", label: "Photos" },
                { value: "b", label: "Details" },
              ]}
            />
          </div>
        </section>

        <section id="surfaces" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Surfaces and hierarchy</Heading>
          </div>
          <div className={styles.surfaceGrid}>
            <Card>
              <Heading level={2}>Photo details</Heading>
              <Caption>12px metadata stays secondary to the photograph.</Caption>
              <span>50mm · f/1.4 · ISO 200</span>
            </Card>
            <Card className={styles.selectedSurface}>
              <Heading level={2}>Selected</Heading>
              <Caption>Soft accent surface; focus has its own ring.</Caption>
              <PillButton size="compact">View photographs</PillButton>
            </Card>
          </div>
        </section>

        <section id="icons" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Icons</Heading>
          </div>
          <div className={styles.controlDemo}>
            {(
              [
                "search",
                "dice",
                "image",
                "shuffle",
                "clock",
                "compass",
                "sunrise",
                "repeat",
                "expand",
                "sparkles",
                "pin",
                "paperclip",
                "camera",
                "pencil",
                "settings",
                "close",
                "flame",
              ] as const
            ).map((kind) => (
              <span key={kind}>
                <Icon kind={kind} /> {kind}
              </span>
            ))}
          </div>
        </section>

        <section id="filters" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Filter states</Heading>
            <Caption>
              Selected surfaces stay distinct from keyboard focus and disabled controls.
            </Caption>
          </div>
          <div className={styles.controlDemo}>
            <SearchFilterPill
              label="Mostly clear"
              labelPrefix={<WeatherIcon kind="mostly-clear" />}
              count={204}
              isActive={filterSelected}
              onClick={() => setFilterSelected((selected) => !selected)}
            />
            <SearchFilterPill
              label="30°C and above"
              count={150}
              onClick={() => setFilterSelected(false)}
            />
            <SearchFilterPill label="Unavailable range" count={0} disabled onClick={() => {}} />
          </div>
        </section>

        <section id="drawing" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Drawing tools</Heading>
            <Caption>The submitted drawing uses white paper in every theme.</Caption>
          </div>
          <Button onClick={() => setDrawingOpen(true)}>Preview drawing tools</Button>
          {drawingOpen ? (
            <SearchDrawPad
              onCancel={() => setDrawingOpen(false)}
              onSubmit={() => setDrawingOpen(false)}
            />
          ) : null}
        </section>

        {/* Tokens: Spacing */}
        <section id="spacing" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Spacing</Heading>
            <Caption>Adapted Radix scale: 4, 8, 12, 16, 24, 32, 40, 48 and 64px.</Caption>
          </div>
          <div className={styles.spacingScale}>
            {spacingTokens.map((t) => (
              <div key={t.name} className={styles.spacingSwatch}>
                <div
                  className={styles.spacingBox}
                  style={{ inlineSize: t.value, blockSize: t.value }}
                />
                <span className={styles.spacingLabel}>{t.value}</span>
                <span className={styles.spacingLabel}>{t.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Tokens: Typography */}
        <section id="typography" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Typography</Heading>
            <Caption>Labels 14px/20px, metadata 12px/16px, body 18px with 1.5 line height.</Caption>
          </div>
          <div className={styles.fontScale}>
            {fontTokens.map((t) => (
              <div key={t.name} className={styles.fontSample}>
                <span className={styles.fontLabel}>
                  {t.name} ({t.value})
                </span>
                <span style={{ fontSize: `var(${t.name})` }}>{t.sample}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="motion" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Motion</Heading>
            <Caption>
              Shared durations and easing curves. Reduced-motion preferences are handled globally.
            </Caption>
          </div>
          <div className={styles.motionGrid}>
            {motionTokens.map((token) => (
              <div key={token.name} className={styles.motionToken}>
                <span className={styles.motionDot} />
                <span>{token.label}</span>
                <code className={styles.colourLabel}>{token.name}</code>
              </div>
            ))}
          </div>
        </section>

        {/* Tokens: Colours */}
        <section id="colours" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Colours</Heading>
            <Caption>
              Adaptive palette using light-dark() and color-mix(). Pick any theme in the nav bar to
              preview its colour, scenery, and typography together.
            </Caption>
          </div>
          <div className={styles.colourGrid}>
            {colourTokens.map((t) => (
              <div key={t.name} className={styles.colourSwatch}>
                <div className={styles.colourBoxBacking}>
                  <div className={styles.colourBox} style={{ backgroundColor: `var(${t.name})` }} />
                </div>
                <span className={styles.colourLabel}>{t.label}</span>
                <span className={styles.colourLabel}>{t.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Headings */}
        <section id="headings" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Headings</Heading>
            <Caption>
              Three visual levels. The <code>as</code> prop overrides the HTML element
              independently.
            </Caption>
          </div>
          <div className={styles.subsection}>
            <Heading level={1}>Level 1 — Section heading (24px)</Heading>
            <Heading level={2}>Level 2 — Subsection heading (18px)</Heading>
            <Heading level={3}>Level 3 — Minor heading (14px)</Heading>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Caption</span>
            <Caption>Muted secondary text for metadata and labels.</Caption>
          </div>
          <Code>{"<Heading level={2}>Title</Heading>"}</Code>
          <Code>{"<Caption>Secondary text</Caption>"}</Code>
        </section>

        {/* Card */}
        <section id="card" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Card</Heading>
            <Caption>
              Bordered surface container. Adapts to light and dark themes via color-mix.
            </Caption>
          </div>
          <div className={styles.cardGrid}>
            <Card>
              <Caption as="div">Label</Caption>
              <div className={styles.cardMetric}>128</div>
              <Caption as="div">Description text goes here</Caption>
            </Card>
            <Card as="article">
              <Caption as="div">Another card</Caption>
              <div className={styles.cardMetric}>42%</div>
              <Caption as="div">Some detail about this metric</Caption>
            </Card>
            <Card>
              <Caption as="div">Third example</Caption>
              <div className={styles.cardMetric}>7 days</div>
            </Card>
          </div>
          <Code>{'<Card as="article">content</Card>'}</Code>
        </section>

        {/* Thumb */}
        <section id="thumb" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Thumb</Heading>
            <Caption>
              Image thumbnail with sharp corners. Default (150px) and small (112px) variants.
            </Caption>
          </div>
          <div className={`${styles.row} ${styles.rowStart}`}>
            <div className={styles.subsection}>
              <span className={styles.subsectionLabel}>Default (150px)</span>
              <Thumb
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23666'/%3E%3C/svg%3E"
                alt="Placeholder"
              />
            </div>
            <div className={styles.subsection}>
              <span className={styles.subsectionLabel}>Small (112px)</span>
              <Thumb
                size="small"
                src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='112' height='112'%3E%3Crect width='112' height='112' fill='%23666'/%3E%3C/svg%3E"
                alt="Placeholder"
              />
            </div>
          </div>
          <Code>{'<Thumb size="small" src="..." alt="..." />'}</Code>
        </section>

        {/* Inputs & Controls */}
        <section id="inputs" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Inputs &amp; Controls</Heading>
            <Caption>
              Form elements with consistent border, radius, and focus ring treatment.
            </Caption>
          </div>
          <div className={styles.inputGrid}>
            <div className={styles.inputField}>
              <span className={styles.subsectionLabel}>Input</span>
              <Input
                placeholder="Search photos..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
            <div className={styles.inputField}>
              <span className={styles.subsectionLabel}>Input (disabled)</span>
              <Input placeholder="Disabled" disabled />
            </div>
            <div className={styles.inputField}>
              <span className={styles.subsectionLabel}>Select (default)</span>
              <Select defaultValue="keyword">
                <option value="keyword">Keyword</option>
                <option value="semantic">Semantic</option>
                <option value="hybrid">Hybrid</option>
              </Select>
            </div>
            <div className={styles.inputField}>
              <span className={styles.subsectionLabel}>Select (compact)</span>
              <Select variant="compact" defaultValue="all">
                <option value="all">All cameras</option>
                <option value="fuji">Fujifilm</option>
                <option value="sony">Sony</option>
              </Select>
            </div>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Segmented toggle</span>
            <div className={styles.row}>
              <SegmentedToggle
                options={[
                  { value: "a", label: "Most similar" },
                  { value: "b", label: "Least similar" },
                ]}
                value={toggleValue}
                onChange={setToggleValue}
                ariaLabel="Sort order"
              />
            </div>
          </div>
          <Code>{'<Input placeholder="..." />'}</Code>
          <Code>{'<Select variant="compact">...</Select>'}</Code>
          <Code>
            {'<SegmentedToggle options={[...]} value={v} onChange={set} ariaLabel="..." />'}
          </Code>
        </section>

        {/* Pill */}
        <section id="pill" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Pill</Heading>
            <Caption>
              Rounded link/button for navigation and actions. Surface (filled) and ghost
              (transparent) variants.
            </Caption>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Surface (default)</span>
            <div className={styles.row}>
              <Pill href="#">Overview</Pill>
              <Pill href="#">Colour</Pill>
              <Pill href="#">Gear</Pill>
              <PillButton>Load more</PillButton>
            </div>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Ghost</span>
            <div className={styles.row}>
              <Pill href="#" variant="ghost">
                Open in Search ↗
              </Pill>
              <PillButton variant="ghost">Reset</PillButton>
            </div>
          </div>
          <Code>{'<Pill href="#" variant="ghost">Link</Pill>'}</Code>
          <Code>{"<PillButton>Action</PillButton>"}</Code>
          <Code>{"For <Link>: className={`${pillStyles.base} ${pillStyles.surface}`}"}</Code>
        </section>

        {/* Overlay Button */}
        <section id="overlay-button" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Overlay Button</Heading>
            <Caption>
              Dark glass button for actions on thumbnails and media. Default and small (icon-only)
              sizes.
            </Caption>
          </div>
          <div className={styles.darkPreview}>
            <OverlayButton>
              <Icon kind="search" /> Similar
            </OverlayButton>
            <OverlayButtonLink href="#">↗ Open</OverlayButtonLink>
            <OverlayButton size="small" aria-label="Close">
              <span aria-hidden="true">×</span>
            </OverlayButton>
            {/* The segmented toggle's overlay variant belongs in this row
                rather than beside the page controls: over a photograph it is
                one of these, and it is here so the two can be compared. */}
            <SegmentedToggle
              variant="overlay"
              options={[
                { value: "a", label: "3D" },
                { value: "b", label: "Sheet" },
              ]}
              value={overlayToggleValue}
              onChange={setOverlayToggleValue}
              ariaLabel="Arrangement"
            />
          </div>
          <Code>{'<OverlayButton size="small">×</OverlayButton>'}</Code>
          <Code>{'<SegmentedToggle variant="overlay" options={[...]} />'}</Code>
        </section>

        {/* Chart Tooltip */}
        <section id="chart-tooltip" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Chart Tooltip</Heading>
            <Caption>
              Accent-tinted tooltip shown on hover over chart bars/cells. Visible here for
              reference.
            </Caption>
          </div>
          <div className={styles.tooltipDemo}>
            <div className={styles.tooltipBar} style={{ blockSize: 40 }}>
              <ChartTooltip>Jan · 42</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ blockSize: 65 }}>
              <ChartTooltip>Feb · 87</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ blockSize: 30 }}>
              <ChartTooltip>Mar · 24</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ blockSize: 55 }}>
              <ChartTooltip>Apr · 61</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ blockSize: 75 }}>
              <ChartTooltip>May · 103</ChartTooltip>
            </div>
          </div>
          <Code>{"<ChartTooltip>Label · 42</ChartTooltip>"}</Code>
        </section>

        <section id="status" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Status and data rows</Heading>
            <Caption>
              LoadingIndicator for model warm-up and pending work; the spinner stops under reduced
              motion.
            </Caption>
          </div>
          <div className={styles.row}>
            <LoadingIndicator label="Loading photographs…" />
            <TooltipSurface>Keyword, semantic or both</TooltipSurface>
          </div>
          <div className={styles.statBarDemo}>
            <StatBar label="Fujifilm X-T5" count={642} maxCount={642} reserveAction />
            <StatBar
              label="A camera name long enough to wrap onto a second line on a phone"
              count={118}
              maxCount={642}
              actionHref="/search?q=camera"
              actionLabel="Search this camera"
            />
          </div>
          <Code>{'<LoadingIndicator label="Loading…" /> · <StatBar label count maxCount />'}</Code>
        </section>

        {/* Buttons */}
        <section id="buttons" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Buttons</Heading>
            <Caption>
              Canonical actions with consistent sizing, focus treatment, and safe button types.
            </Caption>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Variants</span>
            <div className={styles.row}>
              <Button>Button</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="primary">Primary</Button>
              <Button variant="quiet">Quiet</Button>
              <ButtonLink href="/design">Link button</ButtonLink>
              <Button size="icon" aria-label="Close">
                ×
              </Button>
            </div>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Large with key hint</span>
            <div className={styles.row}>
              <Button variant="accent" size="large">
                Play <KeyHint>Enter</KeyHint>
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Split button</span>
            <div className={styles.row}>
              <div className={commonStyles.splitButton}>
                <span className={commonStyles.splitButtonMain}>Primary</span>
                <button
                  type="button"
                  className={commonStyles.splitButtonSub}
                  aria-label="More options"
                >
                  <span aria-hidden="true">▾</span>
                </button>
              </div>
            </div>
          </div>
          <Code>{'<Button variant="primary" size="large">Action</Button>'}</Code>
        </section>

        {/* Stack utilities */}
        <section id="stack" className={styles.section}>
          <div className={styles.sectionHeader}>
            <Heading level={1}>Stack</Heading>
            <Caption>
              Utility classes for vertical rhythm. grid + gap at each spacing level.
            </Caption>
          </div>
          <div className={`${styles.row} ${styles.rowStart}`}>
            {(
              [
                ["stack", "8px"],
                ["stackL", "20px"],
                ["stackXl", "40px"],
                ["stackPage", "64px"],
              ] as const
            ).map(([cls, gap]) => (
              <div key={cls} className={styles.subsection}>
                <span className={styles.subsectionLabel}>
                  .{cls} ({gap})
                </span>
                <div className={commonStyles[cls]}>
                  <div className={styles.stackDemoBar} />
                  <div className={styles.stackDemoBar} />
                  <div className={styles.stackDemoBar} />
                </div>
              </div>
            ))}
          </div>
          <Code>{"className={commonStyles.stack}"}</Code>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default DesignPage;
