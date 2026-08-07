import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import type { GearFrame, GearProfile, LensFocalRange } from "../../util/computeGearStats";
import { Caption, Heading, Thumb } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreGearSection.module.css";

/**
 * The gear section's parts, kept apart from the section that arranges them.
 *
 * Two timelines, a wall of cards and a lens chart shared one file and most of
 * their markup: a year's row, its label and its bar were written out once per
 * chart and had already drifted apart by a bar height. What is presentational
 * lives here and takes what it draws as props; what decides — the grouping, the
 * view, what is being pointed at — stays in the section.
 */

export const gearStyles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  [
    "gearBodies",
    "gearBodyCard",
    "gearBodyFrame",
    "gearBodyHeader",
    "gearBodyName",
    "gearBodyLens",
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

const styles = gearStyles;

/**
 * A share, as small as it may be without becoming nothing.
 *
 * Six photographs of fifteen hundred round to zero, and "6 photos · 0%" says
 * the count is a lie. Below half a per cent it is named as under one.
 */
export const formatShare = (share: number): string =>
  share > 0 && share < 0.5 ? "<1%" : `${Math.round(share)}%`;

export const formatCount = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "photo" : "photos"}`;

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

const formatFocalLength = (focal: GearProfile["focalLength"]): string | null =>
  focal === null ? null : `${focal.mm}mm${focal.equivalent ? "" : " actual"}`;

/** What a kit was typically set to, leaving out whatever it never recorded. */
const traitsOf = (
  profile: GearProfile,
  { withLens, withCamera }: { withLens: boolean; withCamera: boolean },
): Array<{ label: string; value: string }> => {
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
            value: `${hourLabel(profile.busiestHours.from)}–${hourLabel((profile.busiestHours.to + 1) % 24)}`,
          },
        ]),
    // Whichever half the title does not already name: a body says what was on
    // it, a lens says what it was on, and a pairing names both and says
    // neither.
    ...(profile.topLens === null || !withLens
      ? []
      : [{ label: "Usually on", value: `${profile.topLens.label} · ${profile.topLens.share}%` }]),
    ...(profile.topCamera === null || !withCamera
      ? []
      : [
          {
            label: "Usually on",
            value: `${profile.topCamera.label} · ${profile.topCamera.share}%`,
          },
        ]),
    ...(profile.topPlace === null
      ? []
      : [{ label: "Usually in", value: `${profile.topPlace.label} · ${profile.topPlace.share}%` }]),
  ];
};

/**
 * `colour` is a background rather than a colour throughout these parts: a kit
 * with a lens on it is painted as the body over the lens, and that is a
 * gradient, not a colour.
 */
export const GearLegend = ({
  items,
}: {
  items: Array<{ label: string; colour: string | undefined }>;
}) => (
  <div className={styles.gearLegend}>
    {items.map((item) => (
      <div key={item.label} className={styles.gearLegendItem}>
        <span
          aria-hidden="true"
          className={styles.gearLegendSwatch}
          style={{ background: item.colour }}
        />
        <span>{item.label}</span>
      </div>
    ))}
  </div>
);

export const GearProfileCard = ({
  profile,
  colour,
  photo,
  href,
  withLens,
  withCamera,
}: {
  profile: GearProfile;
  colour: string | undefined;
  photo: { src: string; href: string; label: string; swatch?: string } | undefined;
  href: string;
  withLens: boolean;
  withCamera: boolean;
}) => (
  <div className={styles.gearBodyCard}>
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
      <span aria-hidden="true" className={styles.gearBodyMark} style={{ background: colour }} />
      {/* The body and the lens on their own lines: as one string they wrap
          mid-name, and "FUJIFILM X-T5 · XF16-" is not a name anybody reads. */}
      <Link href={href} className={styles.gearBodyName}>
        {profile.camera ? <span>{profile.camera}</span> : null}
        {profile.lens ? (
          <span className={profile.camera ? styles.gearBodyLens : undefined}>{profile.lens}</span>
        ) : null}
      </Link>
    </div>
    <Caption as="span" className={styles.gearBodyCount}>
      {formatCount(profile.count)} · {formatShare(profile.share)}
      {profile.years
        ? ` · ${profile.years[0]}${profile.years[1] === profile.years[0] ? "" : `–${profile.years[1]}`}`
        : ""}
    </Caption>
    <dl className={styles.gearBodyTraits}>
      {traitsOf(profile, { withLens, withCamera }).map((trait) => (
        <div key={trait.label} className={styles.gearBodyTrait}>
          <dt className={styles.gearBodyTraitLabel}>{trait.label}</dt>
          <dd className={styles.gearBodyTraitValue}>{trait.value}</dd>
        </div>
      ))}
    </dl>
  </div>
);

/** A year's label and count beside whatever is drawn for it. */
export const GearYearRow = ({
  label,
  total,
  children,
}: {
  label: string;
  total: number;
  children: React.ReactNode;
}) => (
  <div className={styles.gearYearRow}>
    <div className={styles.gearYearMeta}>
      <span className={styles.gearYearLabel}>{label}</span>
      <span className={styles.gearYearDetail}>{total.toLocaleString("en")}</span>
    </div>
    {children}
  </div>
);

/**
 * A year as one bar, divided by whatever is being counted.
 *
 * As long as the year was busy, not stretched to the full width: side by side
 * with the others, a year of twelve photographs would otherwise read like a
 * year of three hundred.
 */
export const GearStackedBar = ({
  width,
  segments,
}: {
  width: number;
  segments: Array<{ label: string; share: number; colour: string | undefined; title: string }>;
}) => (
  <div className={styles.gearYearBar} style={{ inlineSize: `${width}%` }}>
    {segments.map((segment) => (
      <span
        key={segment.label}
        className={styles.gearYearSegment}
        title={segment.title}
        style={{ inlineSize: `${segment.share}%`, background: segment.colour }}
      >
        <span className={styles.gearYearSegmentLabel}>{Math.round(segment.share)}%</span>
      </span>
    ))}
  </div>
);

/**
 * Every frame of one year, where it fell in it.
 *
 * Full width whatever the year held, unlike the stacked bar: this answers *when*
 * inside the year, so January has to be January in every row. The tooltip is
 * built only for the sliver being pointed at — a photograph in every one of
 * fifteen hundred would fetch the whole archive on scroll.
 */
export const GearRibbon = ({
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
            background: colourOf(frame),
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
 * One lens: where along its range it is used, and how that moved year by year.
 *
 * The bars carry a height measured against the tallest of them, so the axis has
 * to name both ends of the range and what that tallest bin holds.
 */
export const GearLensChart = ({
  lens,
  href,
  bandColour,
}: {
  lens: LensFocalRange;
  href: string;
  bandColour: (index: number, total: number) => string;
}) => {
  const busiest = Math.max(...lens.buckets.map((bucket) => bucket.share), 1);

  return (
    <div className={styles.gearLensRow}>
      <div className={styles.gearLensHeader}>
        <Link href={href} className={styles.gearLensName}>
          {lens.lens}
        </Link>
        <Caption as="span" className={styles.gearLensRange}>
          {lens.shortest}–{lens.longest}mm · {formatCount(lens.count)}
        </Caption>
      </div>
      <div className={styles.gearLensBars}>
        {lens.buckets.map((bucket) => (
          <div
            key={bucket.from}
            className={styles.gearLensBar}
            title={`${bucket.from}–${bucket.to}mm: ${formatCount(bucket.count)}, ${Math.round(bucket.share)}%`}
          >
            <span
              className={styles.gearLensBarFill}
              style={{ blockSize: `${(bucket.share / busiest) * 100}%` }}
            />
          </div>
        ))}
      </div>
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
                      background: bandColour(index, year.bands.length),
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
};

/** A section heading with its controls, as every part of this group wears it. */
export const GearSectionHeader = ({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) => (
  <div className={styles.sectionHeader}>
    <Heading level={2} as="h2">
      {title}
    </Heading>
    {children}
  </div>
);
