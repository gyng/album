// import { OnDeleteFn, TextBlock } from "../services/types";
import styles from "./VideoBlock.module.css";
import React from "react";
import { License } from "../License";

export type YoutubeBlockElProps = {
  id?: string;
  src: string;
  date?: string;

  // Deprecated
  //   isEditing: boolean;
  //   onEdit: (newBlock: TextBlock, newIndex: number) => void;
  //   onDelete: OnDeleteFn;
  //   maxIndex: number;
};

const VideoDetailsPanel: React.FC<{
  type: "youtube" | "local";
  id?: string;
  src: string;
  originalSrc?: string;
  date?: string;
  mimeType?: string;
  originalTechnicalData?: {
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
  };
}> = (props) => {
  const technicalProfile =
    props.type === "local"
      ? "H.264 (AVC) + AAC, web-optimised MP4"
      : "YouTube adaptive stream";

  return (
    <div id={props.id ?? props.src} className={styles.details}>
      <details>
        <summary title="More details&hellip;" className={styles.detailsSummary}>
          <span>ⓘ</span>
        </summary>

        <div className={styles.detailsContent}>
          <div className={styles.videoDetailsTableWrapper}>
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

                  {props.type === "local" &&
                  props.originalTechnicalData?.originalDate ? (
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
                        {props.originalTechnicalData.width}px ×{" "}
                        {props.originalTechnicalData.height}px
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
                      <td>
                        {(props.originalTechnicalData.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                      </td>
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

            <div className={styles.viewOriginal}>
              <a href={`#${props.id ?? props.src}`}>Permalink</a>
              &nbsp;&middot;&nbsp;
              {props.type === "local" ? (
                <>Optimized playback in page</>
              ) : (
                <>
                  Open <a href={props.src}>embed source</a>
                </>
              )}
            </div>

            <details className={styles.rawDetails}>
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

      <VideoDetailsPanel
        type="youtube"
        src={props.src}
        date={props.date}
        id={props.src}
      />
    </div>
  );
};

export type LocalVideoBlockElProps = {
  id?: string;
  src: string;
  originalSrc?: string;
  date?: string;
  mimeType?: string;
  originalTechnicalData?: {
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
  };
};

export const LocalVideoBlockEl: React.FC<LocalVideoBlockElProps> = (props) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        if (entry.isIntersecting) {
          videoEl.play().catch(() => {
            // noop: autoplay can be blocked depending on browser state
          });
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
    };
  }, []);

  return (
    <div className={styles.block} data-testid="videoblockel">
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
        />
      </div>

      <VideoDetailsPanel
        type="local"
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
