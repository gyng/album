import React from "react";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import type { PhotoStats } from "../../util/computeStats";
import { StatBar } from "../StatBar";
import { Caption, Heading, PillButton, SegmentedToggle, Thumb, pillStyles } from "../ui";
import { buildColourYearStacks } from "../../util/colourYearStacks";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreColourSection.module.css";
import { usePhotoRowCapacity } from "./usePhotoRowCapacity";
import { ExploreStatGroup } from "./ExplorePrimitives";
import {
  buildColorSearchHref,
  COLOR_FAMILY_ORDER,
  COLOR_SWATCHES,
  formatCoverage,
} from "./exploreViewModel";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "colorFamilyHeading",
    "colorFamilyMeta",
    "colorFamilyRow",
    "colorFamilyRows",
    "colorFamilyStat",
    "colorFamilyThumbLink",
    "colorFamilyThumbs",
    "colorSwatch",
    "colorTimeBar",
    "colorTimeDetail",
    "colorTimeLegend",
    "colorTimeLegendItem",
    "colorTimeMeta",
    "colorTimeRow",
    "colorTimeSegment",
    "colorTimeSeries",
    "colorTimeSummary",
    "colorTimeTooltip",
    "colorTimeTooltipBody",
    "colorTimeTooltipImage",
    "colorTimeTooltipSwatch",
    "colorTimeTooltipText",
    "colorTimeYear",
    "colourStackBar",
    "colourStackSegment",
    "colourStackLabel",
    "colourFamilyPanel",
    "colourFullRowPanel",
    "colourPanel",
    "colourSectionGrid",
  ],
  ["colourPanel"],
);

export const ExploreColourSection = ({ stats }: { stats: PhotoStats }) => {
  // Which colour-over-time segment is pointed at, if any. Only that one's photo
  // is fetched; see the tooltip below for why.
  const [activePreview, setActivePreview] = React.useState<string | null>(null);
  // Every photograph as its own sliver, or every year as one stacked bar. The
  // first is the archive as it happened; the second is the only one that
  // answers whether a year was greener than the one before.
  const [colourView, setColourView] = React.useState<"photos" | "families">("photos");
  const [colourBasis, setColourBasis] = React.useState<"dominant" | "accents">("accents");
  const ribbons = React.useMemo(
    () =>
      stats.colorYearRibbons.map((year) => ({
        ...year,
        slices: year.slices.map((slice) =>
          colourBasis === "accents" && slice.accent ? { ...slice, ...slice.accent } : slice,
        ),
      })),
    [stats.colorYearRibbons, colourBasis],
  );
  const colourFamilies = [...stats.colorFamilyExamples].sort((left, right) => {
    const leftIndex = COLOR_FAMILY_ORDER.findIndex((label) => label === left.label);
    const rightIndex = COLOR_FAMILY_ORDER.findIndex((label) => label === right.label);
    return (
      (leftIndex < 0 ? COLOR_FAMILY_ORDER.length : leftIndex) -
        (rightIndex < 0 ? COLOR_FAMILY_ORDER.length : rightIndex) ||
      left.label.localeCompare(right.label)
    );
  });
  const colourStacks = React.useMemo(
    () => buildColourYearStacks(ribbons, COLOR_FAMILY_ORDER),
    [ribbons],
  );
  // The busiest year sets the full width, so a bar's length says how much was
  // shot and its divisions say what colour it was. Stretched to full width,
  // every year looked equally busy and 2011's twelve photographs read like
  // 2025's three hundred.
  const busiestYear = Math.max(...colourStacks.map((year) => year.total), 1);
  const maxColorCount = Math.max(...stats.colorStats.map((item) => item.count), 1);
  const leadingColourFamily = stats.colorStats.reduce(
    (best, family) => (family.count > (best?.count ?? 0) ? family : best),
    stats.colorStats[0],
  );
  const accentStats = stats.accentColorStats?.filter((bucket) => bucket.count > 0) ?? [];
  const maxAccentCount = Math.max(...accentStats.map((bucket) => bucket.count), 1);
  const deferredSummary = [
    formatCoverage(stats.colorCoverage),
    leadingColourFamily
      ? `Dominant colour families are led by ${leadingColourFamily.label.toLowerCase()} across ${leadingColourFamily.count.toLocaleString("en")} photos.`
      : "No dominant colour families are available yet.",
    stats.colorYearRibbons.length > 0
      ? `Colour over time covers ${stats.colorYearRibbons.length.toLocaleString("en")} years.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ExploreStatGroup id="colour" title="Colour" deferredSummary={deferredSummary}>
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <div className={styles.colourSectionGrid}>
          <section className={styles.colourPanel}>
            <div className={styles.sectionHeader}>
              <Heading level={2} as="h3">
                Dominant colour families
              </Heading>
              {formatCoverage(stats.colorCoverage) ? (
                <Caption as="span">{formatCoverage(stats.colorCoverage)}</Caption>
              ) : null}
            </div>
            <div className={styles.bars}>
              {stats.colorStats.map((bucket) => (
                <StatBar
                  key={bucket.label}
                  label={bucket.label}
                  count={bucket.count}
                  maxCount={maxColorCount}
                  {...(COLOR_SWATCHES[bucket.label]
                    ? { barColor: COLOR_SWATCHES[bucket.label] }
                    : {})}
                  actionHref={buildColorSearchHref(bucket.label)}
                  actionLabel={`Find photos with similar ${bucket.label.toLowerCase()} tones`}
                  labelPrefix={
                    <span
                      data-colour-swatch
                      className={styles.colorSwatch}
                      style={{
                        backgroundColor:
                          COLOR_SWATCHES[bucket.label] ?? "var(--c-bg-contrast-light)",
                      }}
                      aria-hidden="true"
                    />
                  }
                />
              ))}
            </div>
          </section>

          {accentStats.length > 0 ? (
            <section className={styles.colourPanel}>
              <div className={styles.sectionHeader}>
                <Heading level={2} as="h3">
                  Accent colours
                </Heading>
                <Caption as="span">First non-neutral colour in each palette</Caption>
              </div>
              <div className={styles.bars}>
                {accentStats.map((bucket) => (
                  <StatBar
                    key={bucket.label}
                    label={bucket.label}
                    count={bucket.count}
                    maxCount={maxAccentCount}
                    {...(COLOR_SWATCHES[bucket.label]
                      ? { barColor: COLOR_SWATCHES[bucket.label] }
                      : {})}
                    actionHref={buildColorSearchHref(bucket.label)}
                    actionLabel={`Find photos with similar ${bucket.label.toLowerCase()} tones`}
                    labelPrefix={
                      <span
                        data-colour-swatch
                        className={styles.colorSwatch}
                        style={{
                          backgroundColor:
                            COLOR_SWATCHES[bucket.label] ?? "var(--c-bg-contrast-light)",
                        }}
                        aria-hidden="true"
                      />
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}

          {stats.colorFamilyExamples.length > 0 ? (
            <section className={`${styles.colourPanel} ${styles.colourFamilyPanel}`}>
              <div className={styles.sectionHeader}>
                <Heading level={2} as="h3">
                  Representative colour looks
                </Heading>
              </div>
              <div className={styles.colorFamilyRows}>
                {colourFamilies.map((family) => {
                  const familyHref = buildColorSearchHref(family.label);
                  return (
                    <div key={family.label} className={styles.colorFamilyRow}>
                      <div className={styles.colorFamilyMeta}>
                        <div className={styles.colorFamilyHeading}>
                          <span
                            data-colour-swatch
                            className={styles.colorSwatch}
                            style={{
                              backgroundColor:
                                COLOR_SWATCHES[family.label] ?? "var(--c-bg-contrast-light)",
                            }}
                            aria-hidden="true"
                          />
                          <span>{family.label}</span>
                        </div>
                        <div className={styles.colorFamilyStat}>
                          {family.sharePercent}% of colour-tagged photos
                        </div>
                        {familyHref ? (
                          <Link
                            href={familyHref}
                            className={`${pillStyles.base} ${pillStyles.ghost} ${pillStyles.compact}`}
                          >
                            <span>Search</span>
                            <span aria-hidden="true">↗</span>
                          </Link>
                        ) : null}
                      </div>
                      <ColourFamilyPhotos family={family} />
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {stats.colorYearRibbons.length > 0 ? (
            <section className={`${styles.colourPanel} ${styles.colourFullRowPanel}`}>
              <div className={styles.sectionHeader}>
                <Heading level={2} as="h3">
                  Colour over time
                </Heading>
                <SegmentedToggle
                  size="compact"
                  ariaLabel="How to show colour over time"
                  value={colourView}
                  onChange={setColourView}
                  options={[
                    { value: "photos", label: "Every photo" },
                    { value: "families", label: "By family" },
                  ]}
                />
              </div>
              <div className={localStyles.colourTimeControls}>
                <SegmentedToggle
                  size="compact"
                  ariaLabel="Palette colour to show"
                  value={colourBasis}
                  onChange={setColourBasis}
                  options={[
                    { value: "accents", label: "Accents" },
                    { value: "dominant", label: "Dominant" },
                  ]}
                />
                <Caption as="span">
                  Accents use the first non-neutral palette colour. Neutral-only photos stay
                  neutral.
                </Caption>
              </div>
              <div className={styles.colorTimeLegend}>
                {COLOR_FAMILY_ORDER.map((label) => (
                  <div key={`legend-${label}`} className={styles.colorTimeLegendItem}>
                    <span
                      data-colour-swatch
                      className={styles.colorSwatch}
                      style={{
                        backgroundColor: COLOR_SWATCHES[label],
                      }}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              {colourView === "families" ? (
                <div className={styles.colorTimeSeries}>
                  {colourStacks.map((year) => (
                    <div key={year.label} className={styles.colorTimeRow}>
                      <div className={styles.colorTimeMeta}>
                        <span className={styles.colorTimeYear}>{year.label}</span>
                        <span className={styles.colorTimeDetail}>
                          {year.total.toLocaleString("en")}
                        </span>
                      </div>
                      <div
                        className={styles.colourStackBar}
                        style={{ inlineSize: `${(year.total / busiestYear) * 100}%` }}
                      >
                        {year.families.map((family) => (
                          <Link
                            key={`${year.label}-${family.family}`}
                            href={buildColorSearchHref(family.family, year.label) ?? "/search"}
                            className={styles.colourStackSegment}
                            title={`${family.family} in ${year.label}: ${family.count.toLocaleString("en")} ${
                              family.count === 1 ? "photo" : "photos"
                            }, ${Math.round(family.share)}%`}
                            style={{
                              inlineSize: `${family.share}%`,
                              backgroundColor:
                                COLOR_SWATCHES[family.family] ?? "var(--c-bg-contrast-light)",
                            }}
                          >
                            {/* Named inside the bar where the share is wide
                                enough to read it; the rest keep their tooltip. */}
                            <span className={styles.colourStackLabel}>
                              {Math.round(family.share)}%
                            </span>
                          </Link>
                        ))}
                      </div>
                      <YearColourSummary
                        year={ribbons.find((ribbon) => ribbon.label === year.label)!}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.colorTimeSeries}>
                  {ribbons.map((year) => (
                    <div key={year.label} className={styles.colorTimeRow}>
                      <div className={styles.colorTimeMeta}>
                        <span className={styles.colorTimeYear}>{year.label}</span>
                        <span className={styles.colorTimeDetail}>
                          {year.total.toLocaleString("en")}
                        </span>
                      </div>
                      <div className={styles.colorTimeBar}>
                        {year.slices.map((slice, index) => {
                          const sliceKey = `${colourBasis}-${year.label}-${slice.family}-${index}`;
                          const share = year.total > 0 ? (slice.count / year.total) * 100 : 0;
                          const segmentPosition = slice.position * 100;
                          return (
                            <Link
                              key={sliceKey}
                              href={buildColorSearchHref(slice.family, year.label) ?? "/search"}
                              className={styles.colorTimeSegment}
                              title={`${slice.family} around ${year.label}: ${slice.count} photos (${Math.round(share)}%)`}
                              style={{
                                // One photograph is one sliver, the same width in
                                // every year. Sized as a share of the year, the
                                // eight frames of 2010 each came out an eighth of
                                // the bar wide — a row of blocks that read as a
                                // busy year rather than an empty one.
                                left: `min(${segmentPosition}%, calc(100% - var(--size-3)))`,
                                inlineSize: `var(--size-3)`,
                                backgroundColor: slice.rgb,
                              }}
                              onMouseEnter={() => setActivePreview(sliceKey)}
                              onFocus={() => setActivePreview(sliceKey)}
                            >
                              <span className={styles.colorTimeTooltip} aria-hidden="true">
                                {/* The tooltip is hover-revealed, but `loading="lazy"`
                                  only defers until near the viewport — and the
                                  container occupies layout, so scrolling the page
                                  fetched all ~900 previews: 81MB of the page's
                                  86.9MB of images, none of it visible. The colour
                                  the photo resolves to stands in until then, which
                                  also keeps the tooltip from resizing on reveal. */}
                                {activePreview === sliceKey ? (
                                  <img
                                    src={slice.thumbSrc}
                                    alt={slice.photoLabel}
                                    loading="lazy"
                                    className={styles.colorTimeTooltipImage}
                                    style={{ backgroundColor: slice.rgb }}
                                  />
                                ) : (
                                  <span
                                    className={styles.colorTimeTooltipImage}
                                    style={{ backgroundColor: slice.rgb }}
                                  />
                                )}
                                <span className={styles.colorTimeTooltipBody}>
                                  <span
                                    data-colour-swatch
                                    className={styles.colorTimeTooltipSwatch}
                                    style={{ backgroundColor: slice.rgb }}
                                  />
                                  <span className={styles.colorTimeTooltipText}>
                                    <span>{slice.family}</span>
                                    <span>{slice.dateLabel}</span>
                                  </span>
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                      <YearColourSummary year={year} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </ExploreStatGroup>
  );
};

const ColourFamilyPhotos = ({ family }: { family: PhotoStats["colorFamilyExamples"][number] }) => {
  const { ref, capacity } = usePhotoRowCapacity(96, 6);
  const [rows, setRows] = React.useState(1);
  const visible = rows * capacity;
  return (
    <div className={localStyles.familyPhotos}>
      <div ref={ref} className={localStyles.colorFamilyThumbs}>
        {family.photos.slice(0, visible).map((photo) => (
          <Link
            key={`${photo.href}-${photo.src}`}
            href={photo.href}
            className={localStyles.colorFamilyThumbLink}
          >
            <Thumb
              src={photo.src}
              alt={photo.label}
              loading="lazy"
              {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
            />
          </Link>
        ))}
      </div>
      <div className={localStyles.familyMore}>
        {family.photos.length > visible ? (
          <PillButton
            size="compact"
            aria-label={`More photos with ${family.label.toLowerCase()} tones`}
            onClick={() => setRows((count) => count + 1)}
          >
            More
          </PillButton>
        ) : null}
      </div>
    </div>
  );
};

const YearColourSummary = ({ year }: { year: PhotoStats["colorYearRibbons"][number] }) => (
  <div className={styles.colorTimeSummary}>
    {year.dominantFamily ? (
      <span className={localStyles.yearAccent} title="Dominant colour">
        <span
          data-colour-swatch
          className={styles.colorSwatch}
          style={{
            backgroundColor: COLOR_SWATCHES[year.dominantFamily] ?? "var(--c-bg-contrast-light)",
          }}
          aria-hidden="true"
        />
        <span>{year.dominantFamily}</span>
      </span>
    ) : (
      <span>—</span>
    )}
    {year.accentFamily ? (
      <span
        className={localStyles.yearAccent}
        title={`${year.accentCount ?? 0} photos with ${year.accentFamily.toLowerCase()} accents in ${year.label}`}
      >
        <span
          data-colour-swatch
          className={styles.colorSwatch}
          style={{ backgroundColor: COLOR_SWATCHES[year.accentFamily] }}
          aria-hidden="true"
        />
        <span>{year.accentFamily} accents</span>
      </span>
    ) : null}
  </div>
);
