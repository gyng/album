import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import { AppLink as Link } from "../platform";
import { Caption, Thumb, HoverPlayClip } from "../ui";
import { formatDuration } from "../../util/formatDuration";
import { formatExifWallClockDate } from "../../util/exifTime";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreVideoSection.module.css";
import { ExploreStatGroup } from "./ExplorePrimitives";
import type { ExploreClipRow } from "../../util/pageDataTypes";

const styles = mergeCssModuleStyles(
  sharedStyles,
  localStyles,
  ["videoGrid", "videoTile", "videoThumbLink", "videoBadge", "videoMeta", "videoPoster"],
  [],
);

/**
 * The archive's clips as posters. Every tile links to the clip's own anchor on
 * its album page, so what a reader watches is the media the frame came from.
 */
export const ExploreVideoSection = ({ clips }: { clips: ExploreClipRow[] }) => {
  if (clips.length === 0) return null;

  return (
    <ExploreStatGroup
      id="video"
      title="Video"
      deferContent
      deferredSummary={`${clips.length} ${clips.length === 1 ? "clip" : "clips"}`}
    >
      <section className={`${styles.section} ${styles.sectionWide}`}>
        <ul className={styles.videoGrid}>
          {clips.map((clip) => {
            const duration = formatDuration(clip.durationSeconds);
            const capturedLabel = formatExifWallClockDate(clip.capturedAtLocal);
            const caption = capturedLabel ? `${clip.album} · ${capturedLabel}` : clip.album;
            return (
              <li key={clip.href} className={styles.videoTile}>
                <Link href={clip.href} className={styles.videoThumbLink}>
                  <HoverPlayClip
                    clipPath={`../albums/${clip.album}/${clip.id}`}
                    className={styles.videoPoster}
                  >
                    <Thumb
                      src={clip.src.src}
                      alt={clip.label}
                      loading="lazy"
                      {...(clip.swatch ? { style: { backgroundColor: clip.swatch } } : {})}
                    />
                  </HoverPlayClip>
                  {duration ? (
                    <span
                      className={styles.videoBadge}
                      role="img"
                      aria-label={`Video, ${duration}`}
                    >
                      <span aria-hidden="true">▶</span>
                      <span>{duration}</span>
                    </span>
                  ) : null}
                </Link>
                <Caption as="div" size="sm" className={styles.videoMeta}>{caption}</Caption>
              </li>
            );
          })}
        </ul>
      </section>
    </ExploreStatGroup>
  );
};
