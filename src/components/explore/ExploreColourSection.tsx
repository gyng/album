import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import type { PhotoStats } from "../../util/computeStats";
import { StatBar } from "../StatBar";
import { Caption, Heading, Thumb, pillStyles } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreColourSection.module.css";
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
    "colourFamilyPanel",
    "colourFullRowPanel",
    "colourPanel",
    "colourSectionGrid",
  ],
  ["colourPanel"],
);

export const ExploreColourSection = ({
  stats,
  deferContent = false,
}: {
  stats: PhotoStats;
  deferContent?: boolean;
}) => {
  const maxColorCount = Math.max(...stats.colorStats.map((item) => item.count), 1);
  const leadingColourFamily = stats.colorStats[0];
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
    <ExploreStatGroup
      id="colour"
      title="Colour"
      deferContent={deferContent}
      deferredSummary={deferredSummary}
    >
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <div className={styles.colourSectionGrid}>
          <section className={styles.colourPanel}>
            <div className={styles.sectionHeader}>
              <Heading level={2} as="h2">
                Dominant colour families
              </Heading>
              <Caption as="span">{formatCoverage(stats.colorCoverage)}</Caption>
            </div>
            <div className={styles.bars}>
              {stats.colorStats.map((bucket) => (
                <StatBar
                  key={bucket.label}
                  label={bucket.label}
                  count={bucket.count}
                  maxCount={maxColorCount}
                  barColor={COLOR_SWATCHES[bucket.label] ?? undefined}
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

          {stats.colorFamilyExamples.length > 0 ? (
            <section className={`${styles.colourPanel} ${styles.colourFamilyPanel}`}>
              <div className={styles.sectionHeader}>
                <Heading level={2} as="h2">
                  Representative colour looks
                </Heading>
              </div>
              <div className={styles.colorFamilyRows}>
                {stats.colorFamilyExamples.map((family) => {
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
                            className={`${pillStyles.base} ${pillStyles.ghost}`}
                          >
                            <span>Search</span>
                            <span aria-hidden="true">↗</span>
                          </Link>
                        ) : null}
                      </div>
                      <div className={styles.colorFamilyThumbs}>
                        {family.photos.slice(0, 6).map((photo) => (
                          <Link
                            key={`${family.label}-${photo.href}-${photo.src}`}
                            href={photo.href}
                            className={styles.colorFamilyThumbLink}
                          >
                            <Thumb src={photo.src} alt={photo.label} size="small" loading="lazy" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {stats.colorYearRibbons.length > 0 ? (
            <section className={`${styles.colourPanel} ${styles.colourFullRowPanel}`}>
              <div className={styles.sectionHeader}>
                <Heading level={2} as="h2">
                  Colour over time
                </Heading>
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
              <div className={styles.colorTimeSeries}>
                {stats.colorYearRibbons.map((year) => (
                  <div key={year.label} className={styles.colorTimeRow}>
                    <div className={styles.colorTimeMeta}>
                      <span className={styles.colorTimeYear}>{year.label}</span>
                      <span className={styles.colorTimeDetail}>
                        {year.total.toLocaleString("en")}
                      </span>
                    </div>
                    <div className={styles.colorTimeBar}>
                      {year.slices.map((slice, index) => {
                        const share = year.total > 0 ? (slice.count / year.total) * 100 : 0;
                        const segmentWidth = 100 / Math.max(year.total, 1);
                        const segmentPosition = slice.position * 100;
                        return (
                          <Link
                            key={`${year.label}-${slice.family}-${index}`}
                            href={buildColorSearchHref(slice.family, year.label) ?? "/search"}
                            className={styles.colorTimeSegment}
                            title={`${slice.family} around ${year.label}: ${slice.count} photos (${Math.round(share)}%)`}
                            style={{
                              left: `min(${segmentPosition}%, calc(100% - max(var(--size-3), ${segmentWidth}%)))`,
                              inlineSize: `max(var(--size-3), ${segmentWidth}%)`,
                              backgroundColor: slice.rgb,
                            }}
                          >
                            <span className={styles.colorTimeTooltip} aria-hidden="true">
                              <img
                                src={slice.thumbSrc}
                                alt={slice.photoLabel}
                                loading="lazy"
                                className={styles.colorTimeTooltipImage}
                              />
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
                    <div className={styles.colorTimeSummary}>
                      {year.dominantFamily ? (
                        <>
                          <span
                            data-colour-swatch
                            className={styles.colorSwatch}
                            style={{
                              backgroundColor:
                                COLOR_SWATCHES[year.dominantFamily] ?? "var(--c-bg-contrast-light)",
                            }}
                            aria-hidden="true"
                          />
                          <span>{year.dominantFamily}</span>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </ExploreStatGroup>
  );
};
