import React from "react";
import type { GearFrame, GearProfile, GearStats } from "../../util/computeGearStats";
import { FOCAL_BAND_LABELS, pairingLabel } from "../../util/computeGearStats";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { buildSearchFacetHref, buildSearchHref } from "../../util/searchFacets";
import { Caption, PillButton, SegmentedToggle } from "../ui";
import {
  formatCount,
  GearLegend,
  GearLensChart,
  GearProfileCard,
  GearRibbon,
  GearSectionHeader,
  GearStackedBar,
  gearStyles as styles,
  GearYearRow,
} from "./ExploreGearParts";

/**
 * A colour per piece of kit, spread evenly around the wheel.
 *
 * Fixed lightness and chroma rather than theme tokens: these are a categorical
 * key that has to stay distinguishable from its neighbours in every palette,
 * and there is no token set with eight distinct hues in it.
 */
const kitColour = (index: number, total: number): string =>
  `oklch(72% 0.13 ${Math.round((index * 360) / Math.max(total, 1) + 25) % 360})`;

/**
 * A lens's colour, from the same wheel as the bodies but darker and offset.
 *
 * A pairing's mark is the body over the lens, so the two halves have to be
 * told apart at two pixels wide: a different tone does that where a different
 * hue alone would not.
 */
const lensColour = (index: number, total: number): string =>
  `oklch(52% 0.14 ${Math.round((index * 360) / Math.max(total, 1) + 205) % 360})`;

/**
 * What a series is painted with: one colour for a body, and the body over its
 * lens for a pairing — split across the middle, so a mark says which body and
 * which lens at once.
 */
const splitPaint = (body: string, lens: string): string =>
  `linear-gradient(to bottom, ${body} 0 50%, ${lens} 50% 100%)`;

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

const OTHER_KIT = "Other";

type Grouping = "bodies" | "pairings" | "lenses";

/** What a frame's kit is called, under whichever grouping is showing. */
const kitOf = (frame: GearFrame, grouping: Grouping): string => {
  if (grouping === "bodies") return frame.camera;
  if (grouping === "lenses") return frame.lens ?? OTHER_KIT;
  return pairingLabel(frame.camera, frame.lens);
};

/**
 * The search that finds a kit's photographs.
 *
 * A pairing is two facets, not one: its own label is a sentence this site does
 * not index, and searching the camera facet for a lens name — which is what a
 * single-facet link had to do — finds nothing at all.
 */
const kitSearchHref = (profile: GearProfile): string =>
  buildSearchHref({
    facets: [
      ...(profile.camera ? [{ facetId: "camera", value: profile.camera }] : []),
      ...(profile.lens ? [{ facetId: "lens", value: profile.lens }] : []),
    ],
  });

/**
 * Cards to open with, and to add on each press.
 *
 * Eight, because seven bodies clear the threshold and a reader looking for one
 * of their cameras should not have to guess that it is behind a button. The
 * pairings, at a dozen, still get one.
 */
const INITIAL_KIT_CARDS = 8;
const LOAD_MORE_KIT_CARDS = 8;

/**
 * What the camera and lens counts cannot say.
 *
 * The counts are an inventory. These are the questions a reader actually has
 * about someone else's gear: what each piece of kit is typically set to and
 * what it looks like, when each was the one being carried, what focal lengths
 * the years were shot at, and where along its range a zoom gets used.
 *
 * All of it answers to one grouping — a body, or a body with a lens on it —
 * because "which of my two lenses was that year" is the same question as "which
 * of my two bodies", asked one level down.
 */
export const ExploreGearSection = ({
  gear,
  frames,
}: {
  gear: GearStats;
  frames: VisualSamenessStats["cameraFrames"];
}) => {
  // A body, or a body with the lens that was on it. The cards, the legend and
  // the timeline all follow this: a pairing is a thing a reader changed
  // between, and the body alone cannot show which.
  const [grouping, setGrouping] = React.useState<Grouping>("bodies");
  // Every frame where it fell in its year, or each year as one bar of shares.
  // The archive as it happened opens first, the way the colour ribbon does.
  const [yearView, setYearView] = React.useState<"frames" | "stacked">("frames");
  const [focalView, setFocalView] = React.useState<"frames" | "bands">("frames");
  // Which sliver is pointed at, in either ribbon. Only that one's photograph is
  // fetched; see the tooltip in GearRibbon for why.
  const [preview, setPreview] = React.useState<string | null>(null);
  const [visibleCards, setVisibleCards] = React.useState(INITIAL_KIT_CARDS);
  // A legend entry pressed keeps its own series and takes the rest away. Held
  // per chart: the two are keyed by different things, and a band is not a kit.
  const [onlyKit, setOnlyKit] = React.useState<string | null>(null);
  const [onlyBand, setOnlyBand] = React.useState<string | null>(null);

  const profiles =
    grouping === "bodies" ? gear.bodies : grouping === "lenses" ? gear.lenses : gear.pairings;
  const photos = new Map(frames.map((frame) => [frame.label, frame.photo]));
  // A body keeps one colour across both groupings, so switching to pairings
  // reads as the same cameras splitting rather than as a new set of them.
  const bodyOrder = gear.bodies.map((profile) => profile.camera);
  const lensOrder = [
    ...new Set(
      [...gear.lenses, ...gear.pairings].flatMap((profile) => (profile.lens ? [profile.lens] : [])),
    ),
  ];
  const paintOf = (camera: string | null, lens: string | null): string => {
    const body =
      camera === null ? null : kitColour(Math.max(bodyOrder.indexOf(camera), 0), bodyOrder.length);
    const glass =
      lens === null
        ? null
        : lensColour(Math.max(lensOrder.indexOf(lens), 0), Math.max(lensOrder.length, 1));

    if (body && glass) return splitPaint(body, glass);
    return body ?? glass ?? "var(--c-bg-contrast-light)";
  };
  const colours = new Map(
    profiles.map((profile) => [profile.label, paintOf(profile.camera, profile.lens)]),
  );
  const bandColours = new Map(
    FOCAL_BAND_LABELS.map((band, index) => [band, bandColour(index, FOCAL_BAND_LABELS.length)]),
  );
  // The same split, one chart down: the band a frame was shot at over the body
  // that shot it. The bands are a ramp and the bodies are a wheel, so the two
  // halves never read as one colour.
  const focalPaint = (band: string | null, camera: string): string | undefined => {
    const above = band ? bandColours.get(band) : undefined;
    if (!above) return undefined;

    const below = kitColour(Math.max(bodyOrder.indexOf(camera), 0), bodyOrder.length);
    return splitPaint(above, below);
  };
  // Whatever falls outside the cards is one series rather than a dozen: a key
  // cannot hold eleven pairings, and the tail is a frame or two each.
  const named = new Set(profiles.map((profile) => profile.label));
  const kitLabel = (frame: GearFrame): string => {
    const kit = kitOf(frame, grouping);
    return named.has(kit) ? kit : OTHER_KIT;
  };
  const kitColours = new Map([...colours, [OTHER_KIT, "var(--c-bg-contrast-light)"]]);
  // Counted here rather than at build time: the same frames answer both
  // groupings, and shipping a second stacked series for a toggle the reader may
  // never touch is a payload for nothing.
  const kitYears = React.useMemo(() => {
    // The names are read from the profiles here rather than closed over from
    // the render: a fresh Set every render is a dependency that always changed.
    const names = new Set(profiles.map((profile) => profile.label));
    const years = new Map<string, Map<string, number>>();
    for (const frame of gear.frames) {
      const counts = years.get(frame.year) ?? new Map<string, number>();
      const kit = kitOf(frame, grouping);
      const key = names.has(kit) ? kit : OTHER_KIT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      years.set(frame.year, counts);
    }
    return years;
  }, [gear.frames, grouping, profiles]);
  const framesByYear = React.useMemo(() => {
    const grouped = new Map<string, GearFrame[]>();
    for (const frame of gear.frames) {
      grouped.set(frame.year, [...(grouped.get(frame.year) ?? []), frame]);
    }
    return grouped;
  }, [gear.frames]);

  // Filtered to one series, a year is as long as that series' own frames — the
  // year's total would say the bar was about something it is no longer showing.
  const kitTotal = (year: { label: string; total: number }): number =>
    onlyKit === null ? year.total : (kitYears.get(year.label)?.get(onlyKit) ?? 0);
  const focalTotal = (year: { total: number; bands: Array<{ band: string; count: number }> }) =>
    onlyBand === null
      ? year.total
      : (year.bands.find((band) => band.band === onlyBand)?.count ?? 0);
  const busiestYear = Math.max(...gear.cameraYears.map(kitTotal), 1);
  const busiestFocalYear = Math.max(...gear.focalYears.map(focalTotal), 1);
  const legend = [...named, ...(profiles.length > 0 ? [OTHER_KIT] : [])].map((label) => ({
    label,
    colour: kitColours.get(label),
  }));

  if (gear.bodies.length === 0) {
    return null;
  }

  // Rendered in every section that reads it, rather than once at the top: the
  // charts are a screen apart, and a control that decides what both of them
  // count should not be something a reader has to scroll back for.
  const groupingToggle = (
    <SegmentedToggle
      ariaLabel="What to count as one piece of kit"
      value={grouping}
      onChange={(next) => {
        // Back to the first few: the groupings are different lengths, and an
        // expanded list of seven bodies has nothing to say about how much of a
        // dozen pairings a reader wanted to see.
        setGrouping(next);
        setVisibleCards(INITIAL_KIT_CARDS);
        // A kit named under one grouping need not exist under the next, and a
        // filter for something that is not there shows an empty chart.
        setOnlyKit(null);
      }}
      options={[
        { value: "bodies" as const, label: "Bodies" },
        { value: "pairings" as const, label: "With lenses" },
        { value: "lenses" as const, label: "Lenses" },
      ]}
    />
  );

  return (
    <>
      <section className={`${styles.section} ${styles.sectionWide}`}>
        {/* The title says what the section is about, not what the toggle is
            currently set to: renaming it on a press moves everything under it
            by however much longer the new word is. */}
        <GearSectionHeader title="Bodies and lenses">
          {groupingToggle}
          <Caption as="span">The middle of what each was set to, and its own average frame</Caption>
        </GearSectionHeader>
        <div className={styles.gearBodies}>
          {profiles.slice(0, visibleCards).map((profile) => (
            <GearProfileCard
              key={profile.label}
              profile={profile}
              colour={colours.get(profile.label)}
              photo={photos.get(profile.label)}
              href={kitSearchHref(profile)}
              withLens={grouping === "bodies"}
              withCamera={grouping === "lenses"}
            />
          ))}
        </div>
        {profiles.length > visibleCards ? (
          <PillButton
            className={styles.loadMoreButton}
            onClick={() => {
              setVisibleCards((count) => Math.min(count + LOAD_MORE_KIT_CARDS, profiles.length));
            }}
          >
            <span>Load more kit</span>
          </PillButton>
        ) : null}
      </section>

      {gear.cameraYears.length > 1 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <GearSectionHeader title="Gear over time">
            {groupingToggle}
            <SegmentedToggle
              ariaLabel="How to show gear over time"
              value={yearView}
              onChange={setYearView}
              options={[
                { value: "frames" as const, label: "Every photo" },
                { value: "stacked" as const, label: "Stacked" },
              ]}
            />
          </GearSectionHeader>
          <GearLegend items={legend} selected={onlyKit} onSelect={setOnlyKit} />
          <div className={styles.gearYears}>
            {gear.cameraYears.map((year) => (
              <GearYearRow key={year.label} label={year.label} total={kitTotal(year)}>
                {yearView === "stacked" ? (
                  <GearStackedBar
                    width={(kitTotal(year) / busiestYear) * 100}
                    segments={legend.flatMap((series) => {
                      if (onlyKit !== null && series.label !== onlyKit) return [];
                      const count = kitYears.get(year.label)?.get(series.label) ?? 0;
                      if (count === 0) return [];
                      const share =
                        onlyKit === null ? (count / Math.max(year.total, 1)) * 100 : 100;

                      return [
                        {
                          label: series.label,
                          share,
                          colour: series.colour,
                          title: `${series.label} in ${year.label}: ${formatCount(count)}, ${Math.round(share)}%`,
                        },
                      ];
                    })}
                  />
                ) : (
                  <GearRibbon
                    chart="gear"
                    frames={(framesByYear.get(year.label) ?? []).filter(
                      (frame) => onlyKit === null || kitLabel(frame) === onlyKit,
                    )}
                    colourOf={(frame) => kitColours.get(kitLabel(frame))}
                    captionOf={kitLabel}
                    active={preview}
                    onActive={setPreview}
                  />
                )}
              </GearYearRow>
            ))}
          </div>
        </section>
      ) : null}

      {gear.focalYears.length > 1 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <GearSectionHeader title="Focal length over time">
            <SegmentedToggle
              ariaLabel="How to show focal length over time"
              value={focalView}
              onChange={setFocalView}
              options={[
                { value: "frames" as const, label: "Every photo" },
                { value: "bands" as const, label: "By band" },
              ]}
            />
          </GearSectionHeader>
          {/* As recorded, never converted: barely half these frames carry a
              35mm equivalent, and the ones that do not are a whole body's
              worth — converting what can be converted would quietly delete the
              years that body owned. */}
          <Caption as="span">
            As recorded, not 35mm-equivalent · {Math.round(gear.focalCoverage * 100)}% of frames ·
            every photo carries its band above the body that took it
          </Caption>
          <GearLegend
            items={FOCAL_BAND_LABELS.map((band) => ({
              label: band,
              colour: bandColours.get(band),
            }))}
            selected={onlyBand}
            onSelect={setOnlyBand}
          />
          <div className={styles.gearYears}>
            {gear.focalYears.map((year) => (
              <GearYearRow key={year.label} label={year.label} total={focalTotal(year)}>
                {focalView === "bands" ? (
                  <GearStackedBar
                    width={(focalTotal(year) / busiestFocalYear) * 100}
                    segments={year.bands
                      .filter((band) => onlyBand === null || band.band === onlyBand)
                      .map((band) => ({
                        label: band.band,
                        share: onlyBand === null ? band.share : 100,
                        // Stacked, a segment is many frames from many bodies, so
                        // it stays the band's own colour; only a single frame can
                        // honestly name the body under it.
                        colour: bandColours.get(band.band),
                        title: `${band.band} in ${year.label}: ${formatCount(band.count)}, ${Math.round(band.share)}%`,
                      }))}
                  />
                ) : (
                  <GearRibbon
                    chart="focal"
                    frames={(framesByYear.get(year.label) ?? []).filter(
                      (frame) =>
                        frame.band !== null && (onlyBand === null || frame.band === onlyBand),
                    )}
                    colourOf={(frame) => focalPaint(frame.band, frame.camera)}
                    captionOf={(frame) => `${frame.band ?? ""} · ${frame.camera}`}
                    active={preview}
                    onActive={setPreview}
                  />
                )}
              </GearYearRow>
            ))}
          </div>
        </section>
      ) : null}

      {gear.lensFocalRanges.length > 0 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <GearSectionHeader title="Where a zoom is used">
            <Caption as="span">
              Frames across each lens's own range, then year by year — wide to long
            </Caption>
          </GearSectionHeader>
          <div className={styles.gearLenses}>
            {gear.lensFocalRanges.map((lens) => (
              <GearLensChart
                key={lens.lens}
                lens={lens}
                href={buildSearchFacetHref({ facetId: "lens", value: lens.lens }) ?? "/search"}
                bandColour={bandColour}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
};
