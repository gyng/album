import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import type { CameraProfile, GearStats } from "../../util/computeGearStats";
import type { VisualSamenessStats } from "../../util/computeEmbeddingStats";
import { buildSearchFacetHref } from "../../util/searchFacets";
import { Caption, Heading, Thumb } from "../ui";
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
  const framesByCamera = new Map(frames.map((frame) => [frame.camera, frame.photo]));
  // The timeline and the cards key off the same order, so a body is the same
  // colour in both and the legend serves them together.
  const colours = new Map(
    gear.cameraProfiles.map((profile, index) => [
      profile.camera,
      cameraColour(index, gear.cameraProfiles.length),
    ]),
  );
  const busiestYear = Math.max(...gear.cameraYears.map((year) => year.total), 1);

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
                  {profile.count.toLocaleString("en")} photos · {profile.share}%
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
              Bodies over time
            </Heading>
            <Caption as="span">Which camera was being carried, year by year</Caption>
          </div>
          <div className={styles.gearLegend}>
            {gear.cameraProfiles.map((profile) => (
              <div key={profile.camera} className={styles.gearLegendItem}>
                <span
                  aria-hidden="true"
                  className={styles.gearLegendSwatch}
                  style={{ backgroundColor: colours.get(profile.camera) }}
                />
                <span>{profile.camera}</span>
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
                <div
                  className={styles.gearYearBar}
                  style={{ inlineSize: `${(year.total / busiestYear) * 100}%` }}
                >
                  {year.cameras.map((camera) => (
                    <Link
                      key={camera.camera}
                      href={
                        buildSearchFacetHref({ facetId: "camera", value: camera.camera }) ??
                        "/search"
                      }
                      className={styles.gearYearSegment}
                      title={`${camera.camera} in ${year.label}: ${camera.count.toLocaleString("en")} ${
                        camera.count === 1 ? "photo" : "photos"
                      }, ${Math.round(camera.share)}%`}
                      style={{
                        inlineSize: `${camera.share}%`,
                        backgroundColor: colours.get(camera.camera),
                      }}
                    >
                      <span className={styles.gearYearSegmentLabel}>
                        {Math.round(camera.share)}%
                      </span>
                    </Link>
                  ))}
                </div>
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
            <Caption as="span">Frames across each lens's own range</Caption>
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
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
};
