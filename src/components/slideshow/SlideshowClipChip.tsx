import React from "react";
import styles from "./SlideshowClipChip.module.css";
import { formatClipDuration } from "./clipAudio";

// The corner chip on a clip slide: whether it is playing with sound, how long
// it runs, and the one press that changes the first. It is a sibling of the
// slide layers, not a child, so pressing it is never the tap that advances.
export type SlideshowClipChipProps = {
  // What the reader hears now: the setting, or a mute the browser forced.
  muted: boolean;
  // The browser refused sound without a gesture; pressing the chip is one.
  soundBlocked: boolean;
  durationSeconds?: number | undefined;
  // The toolbar is up and carries its own Mute, in the same corner.
  controlsVisible: boolean;
  onToggle: () => void;
};

export const SlideshowClipChip: React.FC<SlideshowClipChipProps> = (props) => {
  const duration = formatClipDuration(props.durationSeconds);
  return (
    <button
      type="button"
      className={styles.chip}
      data-clip-chip="true"
      data-controls-visible={String(props.controlsVisible)}
      aria-label="Mute clip"
      aria-pressed={props.muted}
      title={props.soundBlocked ? "The browser muted this clip. Press for sound." : "Mute clip (M)"}
      // Hidden behind the open toolbar, it leaves the tab order too.
      tabIndex={props.controlsVisible ? -1 : 0}
      onClick={props.onToggle}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
        {props.muted ? (
          <path d="M16 9.5l5 5m0-5l-5 5" />
        ) : (
          <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
        )}
      </svg>
      {duration ? <span className={styles.duration}>{duration}</span> : null}
    </button>
  );
};
