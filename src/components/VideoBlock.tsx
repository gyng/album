import styles from "./VideoBlock.module.css";
import React from "react";
import { License } from "../License";
import commonStyles from "../styles/common.module.css";
import type { VideoBlock } from "../services/types";
import { rgbToString } from "../util/colorDistance";
import { exifRelativeTimestamp, formatExifWallClockDateTime } from "../util/exifTime";
import { formatDuration } from "../util/formatDuration";
import { HydratedRelativeTime } from "./HydratedRelativeTime";
import { MediaDetailsIcon } from "./MediaDetailsIcon";
import { ColourSwatches, TagLinks, cameraExifRows, narrowCellClass } from "./MediaDetailsParts";
import { ExifTable, type ExifTableRow } from "./Photo";
import { PhotoSimilarPhotosDeferred } from "./PhotoSimilarPhotosDeferred";
import { PhotoWeatherDetails } from "./PhotoWeatherDetails";
import { AppLink } from "./platform";
import { seekLinkedMoment } from "../util/seekLinkedMoment";
import type { ClipTimelineSegment } from "../util/clipTimeline";

/**
 * What happens in the clip and what is said, window by window, each moment a
 * link to itself: choosing one seeks the clip there and keeps the moment in the
 * URL, so it can be shared. Speech appears only where two independent readings
 * agreed (index/clip_timeline.py); the descriptions are the model's, as the
 * photo pane's are.
 */
const ClipTimeline: React.FC<{ id: string; timeline: ClipTimelineSegment[] }> = ({
  id,
  timeline,
}) => (
  <section className={styles.timeline}>
    <h3 className={styles.timelineHeading}>Timeline (AI)</h3>
    <ol aria-label="Timeline" className={styles.timelineList}>
      {timeline.map((segment) => {
        const moment = `?t=${Math.round(segment.start)}#${encodeURIComponent(id)}`;
        return (
          <li key={segment.start} className={styles.timelineSegment}>
            <a
              href={moment}
              className={styles.timelineMoment}
              onClick={(event) => {
                event.preventDefault();
                window.history.replaceState(window.history.state, "", moment);
                seekLinkedMoment((name) => (name === "t" ? String(segment.start) : null), `#${id}`);
              }}
            >
              {formatDuration(segment.start) ?? "0:00"}
            </a>
            <div>
              {segment.description ? <span>{segment.description}</span> : null}
              {segment.speech ? <q className={styles.timelineSpeech}>{segment.speech}</q> : null}
            </div>
          </li>
        );
      })}
    </ol>
  </section>
);

/** What a local clip knows about itself beyond its encoding. */
export type ClipReading = Pick<
  NonNullable<VideoBlock["_build"]>,
  | "capturedAtLocal"
  | "latDeg"
  | "lngDeg"
  | "locationInferredFrom"
  | "durationSeconds"
  | "camera"
  | "tags"
  | "timeline"
>;

// A decimal coordinate in the shape EXIF stores one, so the photo pane's
// location row — its place link and its map — reads a clip's place unchanged.
const toExifCoordinate = (value: number): [number, number, number] => {
  const magnitude = Math.abs(value);
  const degrees = Math.floor(magnitude);
  const minutes = Math.floor((magnitude - degrees) * 60);
  const seconds = ((magnitude - degrees) * 60 - minutes) * 60;
  return [degrees, minutes, seconds];
};

const describeInference = ({ photo, minutesApart }: { photo: string; minutesApart: number }) => {
  const minutes = Math.abs(minutesApart);
  if (minutes === 0) return `From ${photo}, taken the same minute`;
  const span = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `From ${photo}, ${span} ${minutesApart < 0 ? "before" : "after"}`;
};

/**
 * The rows a reader opens the pane for: when, where and with what the clip was
 * shot, and what the index says about its frame — the photo pane's rows, from
 * the clip's own reading.
 */
const clipRows = (reading: ClipReading): ExifTableRow[] => {
  const tags = reading.tags ?? {};
  const zone = tags.tz_offset;
  const capturedAt = formatExifWallClockDateTime(reading.capturedAtLocal, zone);
  const relative = exifRelativeTimestamp(reading.capturedAtLocal, zone);
  const placed = typeof reading.latDeg === "number" && typeof reading.lngDeg === "number";
  return [
    {
      kind: "coordinates",
      k: "Location",
      v: placed
        ? {
            GPSLatitude: toExifCoordinate(reading.latDeg!),
            GPSLatitudeRef: reading.latDeg! < 0 ? "S" : "N",
            GPSLongitude: toExifCoordinate(reading.lngDeg!),
            GPSLongitudeRef: reading.lngDeg! < 0 ? "W" : "E",
            geocode: tags.geocode,
          }
        : {},
      options: {
        showMap: true,
        ...(tags.colors?.[0] ? { markerColour: rgbToString(tags.colors[0]) } : {}),
      },
      valid: placed,
    },
    {
      kind: "kv",
      k: "Inferred",
      v: reading.locationInferredFrom ? describeInference(reading.locationInferredFrom) : undefined,
      valid: placed && Boolean(reading.locationInferredFrom),
    },
    {
      kind: "kv",
      k: "Camera datetime",
      v: capturedAt ? (
        <>
          {capturedAt}
          {relative != null ? (
            <>
              <br />
              <HydratedRelativeTime date={relative} />
            </>
          ) : null}
        </>
      ) : undefined,
    },
    { kind: "kv", k: "Duration", v: formatDuration(reading.durationSeconds) },
    ...cameraExifRows(reading.camera ?? {}),
    ...(tags.weather
      ? [{ kind: "kv" as const, k: "Weather", v: <PhotoWeatherDetails weather={tags.weather} /> }]
      : []),
    {
      kind: "kv",
      k: "Tags",
      v: <TagLinks tags={tags.tags ?? []} />,
      valid: Boolean(tags.tags?.length),
      className: narrowCellClass,
    },
    {
      kind: "kv",
      k: "Colours",
      v: <ColourSwatches colors={tags.colors ?? []} />,
      valid: Boolean(tags.colors?.length),
    },
    {
      kind: "kv",
      k: "Description (AI)",
      v: tags.alt_text,
      className: narrowCellClass,
    },
  ];
};

export type YoutubeBlockElProps = {
  id?: string | undefined;
  src: string;
  date?: string | undefined;

  // Deprecated
  //   isEditing: boolean;
  //   onEdit: (newBlock: TextBlock, newIndex: number) => void;
  //   onDelete: OnDeleteFn;
  //   maxIndex: number;
};

const VideoDetailsPanel: React.FC<{
  type: "youtube" | "local";
  reading?: ClipReading | undefined;
  id?: string | undefined;
  src: string;
  originalSrc?: string | undefined;
  date?: string | undefined;
  mimeType?: string | undefined;
  originalTechnicalData?:
    | {
        originalDate?: string;
        codec?: string;
        profile?: string;
        fps?: number;
        bitrateKbps?: number;
        fileSizeBytes?: number;
        durationSeconds?: number;
        width?: number;
        height?: number;
        audioCodec?: string;
        container?: string;
      }
    | undefined;
}> = (props) => {
  const technicalProfile =
    props.type === "local" ? "H.264 (AVC) + AAC, web-optimised MP4" : "YouTube adaptive stream";
  // The map and the similar photographs are fetched only once the pane opens,
  // as a photograph's are.
  const [isOpen, setIsOpen] = React.useState(false);
  const indexedPath = props.reading?.tags?.path;

  const technicalTable = (
    <table>
      <tbody>
        <tr>
          <td>Type</td>
          <td>{props.type}</td>
        </tr>

        <tr>
          <td>Technical profile</td>
          <td>{technicalProfile}</td>
        </tr>

        {props.mimeType ? (
          <tr>
            <td>Playback MIME</td>
            <td>{props.mimeType}</td>
          </tr>
        ) : null}

        {props.type === "local" ? (
          <tr>
            <td>Max width</td>
            <td>1920px</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalSrc ? (
          <tr>
            <td>Original file</td>
            <td className={styles.sourceCell}>{props.originalSrc}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.originalDate ? (
          <tr>
            <td>Original date</td>
            <td>{props.originalTechnicalData.originalDate}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.codec ? (
          <tr>
            <td>Codec</td>
            <td>{props.originalTechnicalData.codec}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.profile ? (
          <tr>
            <td>Profile</td>
            <td>{props.originalTechnicalData.profile}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.fps ? (
          <tr>
            <td>Framerate</td>
            <td>{props.originalTechnicalData.fps} fps</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.bitrateKbps ? (
          <tr>
            <td>Bitrate</td>
            <td>{props.originalTechnicalData.bitrateKbps} kbps</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.durationSeconds ? (
          <tr>
            <td>Duration</td>
            <td>{props.originalTechnicalData.durationSeconds}s</td>
          </tr>
        ) : null}

        {props.type === "local" &&
        props.originalTechnicalData?.width &&
        props.originalTechnicalData?.height ? (
          <tr>
            <td>Original size</td>
            <td>
              {props.originalTechnicalData.width}px × {props.originalTechnicalData.height}px
            </td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.audioCodec ? (
          <tr>
            <td>Audio codec</td>
            <td>{props.originalTechnicalData.audioCodec}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.container ? (
          <tr>
            <td>Original container</td>
            <td>{props.originalTechnicalData.container}</td>
          </tr>
        ) : null}

        {props.type === "local" && props.originalTechnicalData?.fileSizeBytes ? (
          <tr>
            <td>File size</td>
            <td>{(props.originalTechnicalData.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB</td>
          </tr>
        ) : null}

        {props.date ? (
          <tr>
            <td>Date</td>
            <td>{props.date}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  const links = (
    <div className={commonStyles.mediaDetailsViewOriginal}>
      <a href={`#${props.id ?? props.src}`}>Permalink</a>
      {props.type === "local" && indexedPath ? (
        <>
          &nbsp;&middot;&nbsp;
          <AppLink href={`/explore/wander?wander=${encodeURIComponent(indexedPath)}`}>
            Wander from here
          </AppLink>
        </>
      ) : null}
      {props.type === "local" ? (
        // As a photograph's pane links the sizes it is served at.
        <>
          &nbsp;&middot;&nbsp;
          <a target="_blank" href={props.src} rel="noreferrer">
            View 1920px
          </a>
        </>
      ) : null}
      {props.type === "youtube" ? (
        <>
          &nbsp;&middot;&nbsp;Open <a href={props.src}>embed source</a>
        </>
      ) : null}
    </div>
  );

  return (
    <div id={props.id ?? props.src} className={commonStyles.mediaDetails}>
      <details
        className={commonStyles.disclosure}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
      >
        <summary
          aria-label="Video details"
          title="Video details"
          className={commonStyles.mediaDetailsSummary}
        >
          <span aria-hidden="true" className={commonStyles.mediaDetailsGlyph}>
            <MediaDetailsIcon />
          </span>
        </summary>

        <div className={commonStyles.mediaDetailsContent}>
          <div className={commonStyles.mediaDetailsTable}>
            {props.type === "local" && props.reading ? (
              <>
                {/* What a reader opens the pane for comes first; the encoding,
                    which only says how the clip is served, folds away below. */}
                {isOpen ? <ExifTable rows={clipRows(props.reading)} /> : null}
                {isOpen && props.reading.timeline?.length ? (
                  <ClipTimeline id={props.id ?? props.src} timeline={props.reading.timeline} />
                ) : null}
                {isOpen && indexedPath ? (
                  <div className={styles.similarPhotosWrap}>
                    <PhotoSimilarPhotosDeferred path={indexedPath} />
                  </div>
                ) : null}
                {links}
                <details className={commonStyles.mediaDetailsRaw}>
                  <summary>Encoding</summary>
                  {technicalTable}
                </details>
              </>
            ) : (
              <>
                {technicalTable}
                {links}
              </>
            )}

            <details className={commonStyles.mediaDetailsRaw}>
              <summary>Raw video details</summary>
              <pre>
                {JSON.stringify(
                  {
                    type: props.type,
                    originalSrc: props.originalSrc,
                    playbackSrc: props.src,
                    originalTechnicalData: props.originalTechnicalData,
                    date: props.date,
                    mimeType: props.mimeType,
                    technicalProfile,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>

            <details>
              <summary>License</summary>
              <License />
            </details>
          </div>
        </div>
      </details>
    </div>
  );
};

export const YoutubeBlockEl: React.FC<YoutubeBlockElProps> = (props) => {
  return (
    <div className={styles.block} data-testid="videoblockel">
      <div className={styles.youtubeWrapper}>
        <iframe
          className={styles.youtubeIframe}
          width="560"
          height="315"
          src={props.src}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          allowFullScreen
        ></iframe>
      </div>

      <VideoDetailsPanel type="youtube" src={props.src} date={props.date} id={props.id} />
    </div>
  );
};

export type LocalVideoBlockElProps = {
  id?: string | undefined;
  /** When, where and with what the clip was shot, and its indexed row. */
  reading?: ClipReading | undefined;
  src: string;
  /** Extracted frame shown before playback; absent until the poster prepass has run. */
  posterSrc?: string | undefined;
  originalSrc?: string | undefined;
  date?: string | undefined;
  mimeType?: string | undefined;
  originalTechnicalData?:
    | {
        originalDate?: string;
        codec?: string;
        profile?: string;
        fps?: number;
        bitrateKbps?: number;
        fileSizeBytes?: number;
        durationSeconds?: number;
        width?: number;
        height?: number;
        audioCodec?: string;
        container?: string;
      }
    | undefined;
};

export const LocalVideoBlockEl: React.FC<LocalVideoBlockElProps> = (props) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    // The video is rendered unconditionally, so its ref is attached before
    // this effect runs.
    const videoEl = videoRef.current!;

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    let isIntersecting = false;
    // Set when the viewer pauses the video themselves, so the observer stops
    // fighting them by auto-resuming each time it scrolls back into view.
    let userPaused = false;

    const handlePause = () => {
      // A pause while on-screen is the viewer's; a pause while off-screen is
      // our own scroll-out pause below.
      if (isIntersecting) {
        userPaused = true;
      }
    };

    const handlePlay = () => {
      userPaused = false;
    };

    videoEl.addEventListener("pause", handlePause);
    videoEl.addEventListener("play", handlePlay);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        isIntersecting = entry.isIntersecting;

        if (entry.isIntersecting) {
          if (!userPaused) {
            videoEl.play().catch(() => {
              // noop: autoplay can be blocked depending on browser state
            });
          }
        } else {
          videoEl.pause();
        }
      },
      {
        threshold: 0.5,
      },
    );

    observer.observe(videoEl);
    return () => {
      observer.disconnect();
      videoEl.removeEventListener("pause", handlePause);
      videoEl.removeEventListener("play", handlePlay);
    };
  }, []);

  return (
    // The id is on the details panel below (it is the page anchor), so the block
    // carries it too — that is how a "?t=" deep link finds the element to seek.
    <div className={styles.block} data-testid="videoblockel" data-media-id={props.id}>
      <div className={styles.youtubeWrapper}>
        <video
          ref={videoRef}
          className={styles.youtubeIframe}
          controls
          muted
          playsInline
          loop
          preload="metadata"
          src={props.src}
          {...(props.posterSrc ? { poster: props.posterSrc } : {})}
          // A <video> has no alt: it is named for what it shows, as a
          // photograph is by its alt text.
          aria-label={props.reading?.tags?.alt_text ?? props.id ?? "Video"}
        />
      </div>

      <VideoDetailsPanel
        type="local"
        reading={props.reading}
        id={props.id}
        src={props.src}
        originalSrc={props.originalSrc}
        date={props.date}
        mimeType={props.mimeType}
        originalTechnicalData={props.originalTechnicalData}
      />
    </div>
  );
};
