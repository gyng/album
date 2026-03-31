import { useState } from "react";
import type { GetStaticProps, NextPage } from "next";
import { GlobalNav } from "../../components/GlobalNav";
import { Seo } from "../../components/Seo";
import {
  Card, ChartTooltip, Footer, Heading, Caption, Input,
  OverlayButton, OverlayButtonLink, Pill, PillButton,
  SegmentedToggle, Select, Thumb,
} from "../../components/ui";
import commonStyles from "../../styles/common.module.css";
import styles from "./design.module.css";

type PageProps = Record<string, never>;

const spacingTokens = [
  { name: "--m", value: 4 },
  { name: "--m-s", value: 8 },
  { name: "--m-m", value: 12 },
  { name: "--m-l", value: 20 },
  { name: "--m-xl", value: 40 },
  { name: "--m-2xl", value: 64 },
];

const fontTokens = [
  { name: "--fs-xs", value: "10px", sample: "Extra small — chart labels, badges" },
  { name: "--fs-s", value: "11px", sample: "Small — captions, metadata" },
  { name: "--fs-sm", value: "14px", sample: "Small-medium — body text, controls" },
  { name: "--fs-m", value: "18px", sample: "Medium — base font size" },
  { name: "--fs-l", value: "24px", sample: "Large — section headings" },
  { name: "--fs-xl", value: "64px", sample: "Extra large" },
];

const colourTokens = [
  { name: "--c-bg", label: "Background" },
  { name: "--c-font", label: "Text" },
  { name: "--c-bg-contrast-light", label: "Contrast light" },
  { name: "--c-bg-contrast-dark", label: "Contrast dark" },
  { name: "--c-accent", label: "Accent" },
  { name: "--c-overlay", label: "Overlay" },
  { name: "--c-overlay-dark", label: "Overlay dark" },
  { name: "--c-border-on-dark", label: "Border on dark" },
];

const DesignPage: NextPage<PageProps> = () => {
  const [toggleValue, setToggleValue] = useState("a");
  const [inputValue, setInputValue] = useState("");

  return (
    <div className={styles.page}>
      <Seo title="Design" pathname="/design" noindex />
      <GlobalNav />
      <main className={styles.main}>
        {/* Header */}
        <header className={styles.section}>
          <div>
            <h1 className={styles.sectionTitle}>Design</h1>
            <p className={styles.intro}>
              Shared components and design tokens used across this site.
              A living reference for iterating on the visual language.
            </p>
          </div>
        </header>

        {/* Tokens: Spacing */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Spacing</h2>
            <p className={styles.sectionDescription}>
              Six-step scale from 4px to 64px. Used for gaps, padding, and margins.
            </p>
          </div>
          <div className={styles.spacingScale}>
            {spacingTokens.map((t) => (
              <div key={t.name} className={styles.spacingSwatch}>
                <div
                  className={styles.spacingBox}
                  style={{ width: t.value, height: t.value }}
                />
                <span className={styles.spacingLabel}>{t.value}</span>
                <span className={styles.spacingLabel}>{t.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Tokens: Typography */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Typography</h2>
            <p className={styles.sectionDescription}>
              System font stack. Six sizes from 10px to 64px.
            </p>
          </div>
          <div className={styles.fontScale}>
            {fontTokens.map((t) => (
              <div key={t.name} className={styles.fontSample}>
                <span className={styles.fontLabel}>
                  {t.name} ({t.value})
                </span>
                <span style={{ fontSize: `var(${t.name})` }}>
                  {t.sample}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Tokens: Colours */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Colours</h2>
            <p className={styles.sectionDescription}>
              Adaptive palette using light-dark() and color-mix(). All colours shift with the theme.
            </p>
          </div>
          <div className={styles.colourGrid}>
            {colourTokens.map((t) => (
              <div key={t.name} className={styles.colourSwatch}>
                <div
                  className={styles.colourBox}
                  style={{ backgroundColor: `var(${t.name})` }}
                />
                <span className={styles.colourLabel}>{t.label}</span>
                <span className={styles.colourLabel}>{t.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Headings */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Headings</h2>
            <p className={styles.sectionDescription}>
              Three visual levels. Semantic element is independent of visual size.
            </p>
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
        </section>

        {/* Card */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Card</h2>
            <p className={styles.sectionDescription}>
              Bordered surface container. Adapts to light and dark themes via color-mix.
            </p>
          </div>
          <div className={styles.cardGrid}>
            <Card>
              <Caption as="div">Label</Caption>
              <div style={{ fontSize: "var(--fs-m)" }}>128</div>
              <Caption as="div">Description text goes here</Caption>
            </Card>
            <Card as="article">
              <Caption as="div">Another card</Caption>
              <div style={{ fontSize: "var(--fs-m)" }}>42%</div>
              <Caption as="div">Some detail about this metric</Caption>
            </Card>
            <Card>
              <Caption as="div">Third example</Caption>
              <div style={{ fontSize: "var(--fs-m)" }}>7 days</div>
            </Card>
          </div>
        </section>

        {/* Thumb */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Thumb</h2>
            <p className={styles.sectionDescription}>
              Image thumbnail with sharp corners. Default (150px) and small (112px) variants.
            </p>
          </div>
          <div className={styles.row}>
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
        </section>

        {/* Inputs & Controls */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Inputs &amp; Controls</h2>
            <p className={styles.sectionDescription}>
              Form elements with consistent border, radius, and focus ring treatment.
            </p>
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
              <span className={styles.subsectionLabel}>Select</span>
              <Select defaultValue="keyword">
                <option value="keyword">Keyword</option>
                <option value="semantic">Semantic</option>
                <option value="hybrid">Hybrid</option>
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
        </section>

        {/* Pill */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Pill</h2>
            <p className={styles.sectionDescription}>
              Rounded link/button for navigation and actions. Surface (filled) and ghost (transparent) variants.
            </p>
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
              <Pill href="#" variant="ghost">Open in Search ↗</Pill>
              <PillButton variant="ghost">Reset</PillButton>
            </div>
          </div>
        </section>

        {/* Overlay Button */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Overlay Button</h2>
            <p className={styles.sectionDescription}>
              Dark glass button for actions on thumbnails and media. Default and small (icon-only) sizes.
            </p>
          </div>
          <div className={styles.darkPreview}>
            <OverlayButton>🔍 Similar</OverlayButton>
            <OverlayButtonLink href="#">↗ Open</OverlayButtonLink>
            <OverlayButton size="small">×</OverlayButton>
          </div>
        </section>

        {/* Chart Tooltip */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Chart Tooltip</h2>
            <p className={styles.sectionDescription}>
              Accent-tinted tooltip shown on hover over chart bars/cells.
            </p>
          </div>
          <div className={styles.tooltipDemo}>
            <div className={styles.tooltipBar} style={{ height: 40 }}>
              <ChartTooltip>Jan · 42</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ height: 65 }}>
              <ChartTooltip>Feb · 87</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ height: 30 }}>
              <ChartTooltip>Mar · 24</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ height: 55 }}>
              <ChartTooltip>Apr · 61</ChartTooltip>
            </div>
            <div className={styles.tooltipBar} style={{ height: 75 }}>
              <ChartTooltip>May · 103</ChartTooltip>
            </div>
          </div>
        </section>

        {/* Buttons (existing common styles) */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Buttons</h2>
            <p className={styles.sectionDescription}>
              Existing shared button styles from common.module.css.
            </p>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Standard button</span>
            <div className={styles.row}>
              <button type="button" className={commonStyles.button}>
                Button
              </button>
              <a href="#" className={commonStyles.button}>
                Link button
              </a>
            </div>
          </div>
          <div className={styles.subsection}>
            <span className={styles.subsectionLabel}>Split button</span>
            <div className={styles.row}>
              <div className={commonStyles.splitButton}>
                <span className={commonStyles.splitButtonMain}>
                  Primary
                </span>
                <button type="button" className={commonStyles.splitButtonSub}>
                  ▾
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Stack utilities */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Stack</h2>
            <p className={styles.sectionDescription}>
              Utility classes for vertical rhythm. grid + gap at each spacing level.
            </p>
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
                  <div
                    style={{
                      height: 8,
                      background: "color-mix(in srgb, var(--c-accent) 24%, var(--c-bg))",
                      border: "1px solid color-mix(in srgb, var(--c-accent) 45%, transparent)",
                      borderRadius: 2,
                      width: 80,
                    }}
                  />
                  <div
                    style={{
                      height: 8,
                      background: "color-mix(in srgb, var(--c-accent) 24%, var(--c-bg))",
                      border: "1px solid color-mix(in srgb, var(--c-accent) 45%, transparent)",
                      borderRadius: 2,
                      width: 80,
                    }}
                  />
                  <div
                    style={{
                      height: 8,
                      background: "color-mix(in srgb, var(--c-accent) 24%, var(--c-bg))",
                      border: "1px solid color-mix(in srgb, var(--c-accent) 45%, transparent)",
                      borderRadius: 2,
                      width: 80,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export const getStaticProps: GetStaticProps<PageProps> = async () => ({
  props: {},
});

export default DesignPage;
