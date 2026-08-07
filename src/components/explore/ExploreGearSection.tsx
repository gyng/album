import React from "react";
import type { GearFrame, GearProfile, GearStats } from "../../util/computeGearStats";
import { FOCAL_BAND_LABELS, pairingLabel } from "../../util/computeGearStats";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { buildSearchFacetHref, buildSearchHref } from "../../util/searchFacets";
import { Caption, SegmentedToggle } from "../ui";
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

/** What a frame's kit is called, under whichever grouping is showing. */
const kitOf = (frame: GearFrame, grouping: "bodies" | "pairings"): string =>
  grouping === "bodies" ? frame.camera : pairingLabel(frame.camera, frame.lens);

/**
 * The search that finds a kit's photographs.
 *
 * A pairing is two facets, not one: its own label is a sentence this site does
 * not index, and searching the camera facet for a lens name — which is what a
 * single-facet link had to do — finds nothing at all.
 */
const kitSearchHref = (profile: GearProfile): string => {
  const [camera, lens] = profile.label.split(" · ");
  if (!camera) return "/search";

  return buildSearchHref({
    facets: [
      { facetId: "camera", value: camera },
      ...(lens ? [{ facetId: "lens", value: lens }] : []),
    ],
  });
};

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
  const [grouping, setGrouping] = React.useState<"bodies" | "pairings">("bodies");
  // Every frame where it fell in its year, or each year as one bar of shares.
  // The archive as it happened opens first, the way the colour ribbon does.
  const [yearView, setYearView] = React.useState<"frames" | "stacked">("frames");
  const [focalView, setFocalView] = React.useState<"frames" | "bands">("frames");
  // Which sliver is pointed at, in either ribbon. Only that one's photograph is
  // fetched; see the tooltip in GearRibbon for why.
  const [preview, setPreview] = React.useState<string | null>(null);

  const profiles = grouping === "bodies" ? gear.bodies : gear.pairings;
  const photos = new Map(frames.map((frame) => [frame.label, frame.photo]));
  const colours = new Map(
    profiles.map((profile, index) => [profile.label, kitColour(index, profiles.length)]),
  );
  const bandColours = new Map(
    FOCAL_BAND_LABELS.map((band, index) => [band, bandColour(index, FOCAL_BAND_LABELS.length)]),
  );
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

  const busiestYear = Math.max(...gear.cameraYears.map((year) => year.total), 1);
  const busiestFocalYear = Math.max(...gear.focalYears.map((year) => year.total), 1);
  const legend = [...named, ...(profiles.length > 0 ? [OTHER_KIT] : [])].map((label) => ({
    label,
    colour: kitColours.get(label),
  }));

  if (gear.bodies.length === 0) {
    return null;
  }

  return (
    <>
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <GearSectionHeader title={grouping === "bodies" ? "Bodies" : "Bodies and lenses"}>
          <SegmentedToggle
            ariaLabel="What to count as one piece of kit"
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "bodies" as const, label: "Bodies" },
              { value: "pairings" as const, label: "With lenses" },
            ]}
          />
          <Caption as="span">The middle of what each was set to, and its own average frame</Caption>
        </GearSectionHeader>
        <div className={styles.gearBodies}>
          {profiles.map((profile) => (
            <GearProfileCard
              key={profile.label}
              profile={profile}
              colour={colours.get(profile.label)}
              photo={photos.get(profile.label)}
              href={kitSearchHref(profile)}
              withLens={grouping === "bodies"}
            />
          ))}
        </div>
      </section>

      {gear.cameraYears.length > 1 ? (
        <section className={`${styles.section} ${styles.sectionWide}`}>
          <GearSectionHeader title="Gear over time">
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
          <GearLegend items={legend} />
          <div className={styles.gearYears}>
            {gear.cameraYears.map((year) => (
              <GearYearRow key={year.label} label={year.label} total={year.total}>
                {yearView === "stacked" ? (
                  <GearStackedBar
                    width={(year.total / busiestYear) * 100}
                    segments={legend.flatMap((series) => {
                      const count = kitYears.get(year.label)?.get(series.label) ?? 0;
                      if (count === 0) return [];
                      const share = year.total > 0 ? (count / year.total) * 100 : 0;

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
                    frames={framesByYear.get(year.label) ?? []}
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
            As recorded, not 35mm-equivalent · {Math.round(gear.focalCoverage * 100)}% of frames
          </Caption>
          <GearLegend
            items={FOCAL_BAND_LABELS.map((band) => ({
              label: band,
              colour: bandColours.get(band),
            }))}
          />
          <div className={styles.gearYears}>
            {gear.focalYears.map((year) => (
              <GearYearRow key={year.label} label={year.label} total={year.total}>
                {focalView === "bands" ? (
                  <GearStackedBar
                    width={(year.total / busiestFocalYear) * 100}
                    segments={year.bands.map((band) => ({
                      label: band.band,
                      share: band.share,
                      colour: bandColours.get(band.band),
                      title: `${band.band} in ${year.label}: ${formatCount(band.count)}, ${Math.round(band.share)}%`,
                    }))}
                  />
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
