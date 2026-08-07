import React from "react";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import type { CameraProfile, GearFrame, GearStats } from "../../util/computeGearStats";
import { FOCAL_BAND_LABELS } from "../../util/computeGearStats";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { buildSearchFacetHref } from "../../util/searchFacets";
import { Caption, Heading, SegmentedToggle, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreGearSection.module.css";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "gearBodies",
    "gearBodyCard",
    "gearBodyFrame",
    "gearBodyHeader",
    "gearBodyName",
    "gearBodyMark",
    "gearBodyCount",
    "gearBodyTraits",
    "gearBodyTrait",
    "gearBodyTraitLabel",
    "gearBodyTraitValue",
    "gearLegend",
    "gearLegendItem",
    "gearLegendSwatch",
    "gearYearRow",
    "gearYearMeta",
    "gearYearLabel",
    "gearYearDetail",
    "gearYearBar",
    "gearYearSegment",
    "gearYearSegmentLabel",
    "gearYears",
    "gearLensRow",
    "gearLensHeader",
    "gearLensName",
    "gearLensRange",
    "gearLensBars",
    "gearLensBar",
    "gearLensBarFill",
    "gearLensAxis",
    "gearLensPeak",
    "gearLensYears",
    "gearLensYearRow",
    "gearLensYearLabel",
    "gearLensYearBar",
    "gearLensYearBand",
    "gearYearRibbon",
    "gearYearSliver",
    "gearTooltip",
    "gearTooltipImage",
    "gearTooltipText",
    "gearLenses",
  ],
  ["gearBodyCard", "gearYearSegment"],
);

/**
 * A colour per body, spread evenly around the wheel.
 *
 * Fixed lightness and chroma rather than theme tokens: these are a categorical
 * key that has to stay distinguishable from its neighbours in every palette,
 * and there is no token set with eight distinct hues in it.
 */
const cameraColour = (index: number, total: number): string =>
  `oklch(72% 0.13 ${Math.round((index * 360) / Math.max(total, 1) + 25) % 360})`;

/**
 * A band's colour, from wide to long.
 *
 * Ordered data, so the ramp is ordered too — and mixed from the accent every
 * other bar on this page is drawn in, rather than a hue of its own, so a band
 * follows the palette like the rest of the chrome. Wide is the muted end and
 * long is full accent; that direction is the legend, which is why there is not
 * one.
 *
 * Mixed towards a mid tone rather than towards transparency: two per cent of a
 * ribbon's width is a two-pixel sliver, and a difference in alpha over a track
 * that is itself translucent is not a difference anyone can see at that size.
 */
const bandColour = (index: number, total: number): string =>
  `color-mix(in oklch, var(--c-accent) ${Math.round(15 + (index * 85) / Math.max(total - 1, 1))}%, var(--c-bg-contrast-light))`;

/** How many body-and-lens pairings get a colour of their own before "Other". */
const MAX_COMBOS = 8;
const OTHER_SERIES = "Other";

/** What a frame is counted as, under whichever grouping is showing. */
const seriesOf = (frame: GearFrame, grouping: "bodies" | "combos"): string =>
  grouping === "bodies" || !frame.lens ? frame.camera : `${frame.camera} · ${frame.lens}`;

/**
 * A share, as small as it may be without becoming nothing.
 *
 * Six photographs of fifteen hundred round to zero, and "6 photos · 0%" says
 * the count is a lie. Below half a per cent it is named as under one.
 */
const formatShare = (share: number): string =>
  share > 0 && share < 0.5 ? "<1%" : `${Math.round(share)}%`;

const HOUR_LABEL = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const formatFocalLength = (focal: CameraProfile["focalLength"]): string | null =>
  focal === null ? null : `${focal.mm}mm${focal.equivalent ? "" : " actual"}`;

const traitsOf = (profile: CameraProfile): Array<{ label: string; value: string }> => {
  const focal = formatFocalLength(profile.focalLength);

  return [
    ...(focal ? [{ label: "Focal length", value: focal }] : []),
    ...(profile.aperture === null ? [] : [{ label: "Aperture", value: `f/${profile.aperture}` }]),
    ...(profile.iso === null ? [] : [{ label: "ISO", value: String(profile.iso) }]),
    ...(profile.busiestHours === null
      ? []
      : [
          {
            label: "Out at",
            value: `${HOUR_LABEL(profile.busiestHours.from)}–${HOUR_LABEL((profile.busiestHours.to + 1) % 24)}`,
          },
        ]),
    ...(profile.topLens === null
      ? []
      : [{ label: "Usually on", value: `${profile.topLens.label} · ${profile.topLens.share}%` }]),
    ...(profile.topPlace === null
      ? []
      : [{ label: "Usually in", value: `${profile.topPlace.label} · ${profile.topPlace.share}%` }]),
  ];
};

/**
 * Every frame of one year, where it fell in it.
 *
 * Full width whatever the year held, unlike the stacked view beside it: this
 * answers *when* inside the year, so January has to be January in every row.
 * The tooltip is built only for the sliver being pointed at — a photograph in
 * every one of fifteen hundred would fetch the whole archive on scroll.
 */
const GearRibbon = ({
  chart,
  frames,
  colourOf,
  captionOf,
  active,
  onActive,
}: {
  /** Which ribbon this is, so the two on the page cannot share a hovered key. */
  chart: string;
  frames: GearFrame[];
  colourOf: (frame: GearFrame) => string | undefined;
  captionOf: (frame: GearFrame) => string;
  active: string | null;
  onActive: (key: string | null) => void;
}) => (
  <div className={styles.gearYearRibbon}>
    {frames.map((frame, index) => {
      const key = `${chart}-${frame.year}-${index}`;

      return (
        <Link
          key={key}
          href={frame.href}
          className={styles.gearYearSliver}
          aria-label={`${captionOf(frame)}, ${frame.dateLabel} ${frame.year}`}
          style={{
            insetInlineStart: `min(${frame.position * 100}%, calc(100% - var(--size-2)))`,
            backgroundColor: colourOf(frame),
          }}
          onMouseEnter={() => onActive(key)}
          onFocus={() => onActive(key)}
          onMouseLeave={() => onActive(null)}
          onBlur={() => onActive(null)}
        >
          {active === key ? (
            <span className={styles.gearTooltip} aria-hidden="true">
              <img
                src={frame.src}
                alt={frame.label}
                loading="lazy"
                className={styles.gearTooltipImage}
              />
              <span className={styles.gearTooltipText}>
                <span>{captionOf(frame)}</span>
                <span>
                  {frame.dateLabel} {frame.year}
                </span>
              </span>
            </span>
          ) : null}
        </Link>
      );
    })}
  </div>
);

/**
 * What the camera and lens counts cannot say.
 *
 * The counts are an inventory. These are the three questions a reader actually
 * has about someone else's gear: when each body was the one being carried, what
 * it is typically set to and what it looks like, and where along its range a
 * zoom gets used.
 */
export const ExploreGearSection = ({
  gear,
  frames,
}: {
  gear: GearStats;
  frames: VisualSamenessStats["cameraFrames"];
}) => {
  // Every frame where it fell in its year, or each year as one bar of shares.
  // The archive as it happened opens first, the way the colour ribbon does;
  // the stacked view is the one to switch to for "was this year mostly one
  // camera", which is the narrower question.
  const [yearView, setYearView] = React.useState<"frames" | "bodies">("frames");
  const [focalView, setFocalView] = React.useState<"frames" | "bands">("frames");
  // Which sliver is pointed at, in either ribbon. Only that one's photograph is
  // fetched; see the tooltip in GearRibbon for why.
  const [preview, setPreview] = React.useState<string | null>(null);
  // The timeline and the cards key off the same order, so a body is the same
  // colour in both and the legend serves them together.
  const colours = new Map(
    gear.cameraProfiles.map((profile, index) => [
      profile.camera,
      cameraColour(index, gear.cameraProfiles.length),
    ]),
  );
  const framesByCamera = new Map(frames.map((frame) => [frame.camera, frame.photo]));
  const framesByYear = React.useMemo(() => {
    const grouped = new Map<string, GearFrame[]>();
    for (const frame of gear.frames) {
      grouped.set(frame.year, [...(grouped.get(frame.year) ?? []), frame]);
    }
    return grouped;
  }, [gear.frames]);
  const bandColours = new Map(
    FOCAL_BAND_LABELS.map((band, index) => [band, bandColour(index, FOCAL_BAND_LABELS.length)]),
  );
  // A body is one series; a body and the lens on it are another. The pairings
  // are what a reader with two lenses actually changed between, and the bodies
  // alone cannot show that — but there are more of them than a key can hold, so
  // the busiest keep their own colour and the tail becomes one.
  const [grouping, setGrouping] = React.useState<"bodies" | "combos">("bodies");
  const series = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const frame of gear.frames) {
      const key = seriesOf(frame, grouping);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const ordered = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label]) => label);
    const named = ordered.slice(0, MAX_COMBOS);

    return {
      labels: named.length < ordered.length ? [...named, OTHER_SERIES] : named,
      named: new Set(named),
    };
  }, [gear.frames, grouping]);
  const labelOf = (frame: GearFrame): string => {
    const key = seriesOf(frame, grouping);
    return series.named.has(key) ? key : OTHER_SERIES;
  };
  // A body keeps the colour its card has; a pairing, which no card shows, takes
  // one from the same wheel.
  const seriesColours = new Map(
    series.labels.map((label, index) => [
      label,
      label === OTHER_SERIES
        ? "var(--c-bg-contrast-light)"
        : (colours.get(label) ?? cameraColour(index, series.labels.length)),
    ]),
  );
  // Counted here rather than at build time: the same frames answer both
  // groupings, and shipping a second stacked series for a toggle the reader may
  // never touch is a payload for nothing.
  const seriesYears = React.useMemo(() => {
    const years = new Map<string, Map<string, number>>();
    for (const frame of gear.frames) {
      const counts = years.get(frame.year) ?? new Map<string, number>();
      const key = series.named.has(seriesOf(frame, grouping))
        ? seriesOf(frame, grouping)
        : OTHER_SERIES;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      years.set(frame.year, counts);
    }
    return years;
  }, [gear.frames, grouping, series.named]);
  const busiestYear = Math.max(...gear.cameraYears.map((year) => year.total), 1);
  const busiestFocalYear = Math.max(...gear.focalYears.map((year) => year.total), 1);

  if (gear.cameraProfiles.length === 0) {
    return null;
  }

  return (
    <>
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <div className={styles.sectionHeader}>
          <Heading level={2} as="h2">
            Bodies
          </Heading>
          <Caption as="span">The middle of what each was set to, and its own average frame</Caption>
        </div>
        <div className={styles.gearBodies}>
          {gear.cameraProfiles.map((profile) => {
            const photo = framesByCamera.get(profile.camera);

            return (
              <div key={profile.camera} className={styles.gearBodyCard}>
                {photo ? (
                  <Link href={photo.href} className={styles.gearBodyFrame}>
                    <Thumb
                      src={photo.src}
                      alt={photo.label}
                      loading="lazy"
                      {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
                    />
                  </Link>
                ) : null}
                <div className={styles.gearBodyHeader}>
                  <span
                    aria-hidden="true"
                    className={styles.gearBodyMark}
                    style={{ backgroundColor: colours.get(profile.camera) }}
                  />
                  <Link
                    href={
                      buildSearchFacetHref({ facetId: "camera", value: profile.camera }) ??
                      "/search"
                    }
                    className={styles.gearBodyName}
                  >
                    {profile.camera}
                  </Link>
                </div>
                <Caption as="span" className={styles.gearBodyCount}>
                  {profile.count.toLocaleString("en")} photos · {formatShare(profile.share)}
                  {profile.years
                    ? ` · ${profile.years[0]}${profile.years[1] === profile.years[0] ? "" : `–${profile.years[1]}`}`
                    : ""}
                </Caption>
                <dl className={styles.gearBodyTraits}>
                  {traitsOf(profile).map((trait) => (
                    <div key={trait.label} className={styles.gearBodyTrait}>
                      <dt className={styles.gearBodyTraitLabel}>{trait.label}</dt>
                      <dd className={styles.gearBodyTraitValue}>{trait.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      {gear.cameraYears.length > 1 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <div className={styles.sectionHeader}>
            <Heading level={2} as="h2">
              Gear over time
            </Heading>
            <SegmentedToggle
              ariaLabel="What to count over time"
              value={grouping}
              onChange={setGrouping}
              options={[
                { value: "bodies" as const, label: "Bodies" },
                { value: "combos" as const, label: "With lenses" },
              ]}
            />
            <SegmentedToggle
              ariaLabel="How to show gear over time"
              value={yearView}
              onChange={setYearView}
              options={[
                { value: "frames" as const, label: "Every photo" },
                { value: "bodies" as const, label: "Stacked" },
              ]}
            />
          </div>
          <div className={styles.gearLegend}>
            {series.labels.map((label) => (
              <div key={label} className={styles.gearLegendItem}>
                <span
                  aria-hidden="true"
                  className={styles.gearLegendSwatch}
                  style={{ backgroundColor: seriesColours.get(label) }}
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className={styles.gearYears}>
            {gear.cameraYears.map((year) => (
              <div key={year.label} className={styles.gearYearRow}>
                <div className={styles.gearYearMeta}>
                  <span className={styles.gearYearLabel}>{year.label}</span>
                  <span className={styles.gearYearDetail}>{year.total.toLocaleString("en")}</span>
                </div>
                {/* A year's bar is as long as the year was busy, and divided by
                    what shot it: stretched to full width, a year of twelve
                    photographs reads like a year of three hundred. */}
                {yearView === "bodies" ? (
                  <div
                    className={styles.gearYearBar}
                    style={{ inlineSize: `${(year.total / busiestYear) * 100}%` }}
                  >
                    {series.labels.map((label) => {
                      const count = seriesYears.get(year.label)?.get(label) ?? 0;
                      if (count === 0) return null;
                      const share = year.total > 0 ? (count / year.total) * 100 : 0;

                      return (
                        <span
                          key={label}
                          className={styles.gearYearSegment}
                          title={`${label} in ${year.label}: ${count.toLocaleString("en")} ${
                            count === 1 ? "photo" : "photos"
                          }, ${Math.round(share)}%`}
                          style={{
                            inlineSize: `${share}%`,
                            backgroundColor: seriesColours.get(label),
                          }}
                        >
                          <span className={styles.gearYearSegmentLabel}>{Math.round(share)}%</span>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <GearRibbon
                    chart="gear"
                    frames={framesByYear.get(year.label) ?? []}
                    colourOf={(frame) => seriesColours.get(labelOf(frame))}
                    captionOf={(frame) => labelOf(frame)}
                    active={preview}
                    onActive={setPreview}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {gear.focalYears.length > 1 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <div className={styles.sectionHeader}>
            <Heading level={2} as="h2">
              Focal length over time
            </Heading>
            <SegmentedToggle
              ariaLabel="How to show focal length over time"
              value={focalView}
              onChange={setFocalView}
              options={[
                { value: "frames" as const, label: "Every photo" },
                { value: "bands" as const, label: "By band" },
              ]}
            />
          </div>
          {/* As recorded, never converted: barely half these frames carry a
              35mm equivalent, and the ones that do not are a whole body's
              worth — converting what can be converted would quietly delete the
              years that body owned. */}
          <Caption as="span">
            As recorded, not 35mm-equivalent · {Math.round(gear.focalCoverage * 100)}% of frames
          </Caption>
          <div className={styles.gearLegend}>
            {FOCAL_BAND_LABELS.map((band) => (
              <div key={band} className={styles.gearLegendItem}>
                <span
                  aria-hidden="true"
                  className={styles.gearLegendSwatch}
                  style={{ backgroundColor: bandColours.get(band) }}
                />
                <span>{band}</span>
              </div>
            ))}
          </div>
          <div className={styles.gearYears}>
            {gear.focalYears.map((year) => (
              <div key={year.label} className={styles.gearYearRow}>
                <div className={styles.gearYearMeta}>
                  <span className={styles.gearYearLabel}>{year.label}</span>
                  <span className={styles.gearYearDetail}>{year.total.toLocaleString("en")}</span>
                </div>
                {focalView === "bands" ? (
                  <div
                    className={styles.gearYearBar}
                    style={{ inlineSize: `${(year.total / busiestFocalYear) * 100}%` }}
                  >
                    {year.bands.map((band) => (
                      <span
                        key={band.band}
                        className={styles.gearYearSegment}
                        title={`${band.band} in ${year.label}: ${band.count.toLocaleString("en")} ${
                          band.count === 1 ? "photo" : "photos"
                        }, ${Math.round(band.share)}%`}
                        style={{
                          inlineSize: `${band.share}%`,
                          backgroundColor: bandColours.get(band.band),
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <GearRibbon
                    chart="focal"
                    frames={(framesByYear.get(year.label) ?? []).filter(
                      (frame) => frame.band !== null,
                    )}
                    colourOf={(frame) => (frame.band ? bandColours.get(frame.band) : undefined)}
                    captionOf={(frame) => frame.band ?? ""}
                    active={preview}
                    onActive={setPreview}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {gear.lensFocalRanges.length > 0 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <div className={styles.sectionHeader}>
            <Heading level={2} as="h2">
              Where a zoom is used
            </Heading>
            <Caption as="span">
              Frames across each lens's own range, then year by year — wide to long
            </Caption>
          </div>
          <div className={styles.gearLenses}>
            {gear.lensFocalRanges.map((lens) => {
              const busiest = Math.max(...lens.buckets.map((bucket) => bucket.share), 1);

              return (
                <div key={lens.lens} className={styles.gearLensRow}>
                  <div className={styles.gearLensHeader}>
                    <Link
                      href={
                        buildSearchFacetHref({ facetId: "lens", value: lens.lens }) ?? "/search"
                      }
                      className={styles.gearLensName}
                    >
                      {lens.lens}
                    </Link>
                    <Caption as="span" className={styles.gearLensRange}>
                      {lens.shortest}–{lens.longest}mm · {lens.count.toLocaleString("en")} photos
                    </Caption>
                  </div>
                  <div className={styles.gearLensBars}>
                    {lens.buckets.map((bucket) => (
                      <div
                        key={bucket.from}
                        className={styles.gearLensBar}
                        title={`${bucket.from}–${bucket.to}mm: ${bucket.count.toLocaleString("en")} ${
                          bucket.count === 1 ? "photo" : "photos"
                        }, ${Math.round(bucket.share)}%`}
                      >
                        <span
                          className={styles.gearLensBarFill}
                          style={{ blockSize: `${(bucket.share / busiest) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* The bars are drawn against the tallest, so the axis has to
                      carry both ends of the range and what that height is. */}
                  <div className={styles.gearLensAxis}>
                    <span>{lens.shortest}mm</span>
                    <span className={styles.gearLensPeak}>
                      most at {lens.peak.from}–{lens.peak.to}mm · {Math.round(lens.peak.share)}%
                    </span>
                    <span>{lens.longest}mm</span>
                  </div>
                  {lens.years.length > 1 ? (
                    <div className={styles.gearLensYears}>
                      {lens.years.map((year) => (
                        <div key={year.label} className={styles.gearLensYearRow}>
                          <span className={styles.gearLensYearLabel}>{year.label}</span>
                          <div className={styles.gearLensYearBar}>
                            {year.bands.map((band, index) => (
                              <span
                                key={band.from}
                                className={styles.gearLensYearBand}
                                title={`${band.from}–${band.to}mm in ${year.label}: ${band.count.toLocaleString("en")} of ${year.total.toLocaleString("en")}`}
                                style={{
                                  inlineSize: `${band.share}%`,
                                  backgroundColor: bandColour(index, year.bands.length),
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
};
