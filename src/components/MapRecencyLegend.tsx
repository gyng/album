import styles from "./MapRecencyLegend.module.css";
import { recencyGradientCss } from "../util/mapColor";

/**
 * Legend for the map's colour encoding: colour = photo age (recency), running
 * blue (older) → red (newer). Grouping is read from the journey lines, not the
 * colour, so the legend only explains the recency ramp. Purely decorative —
 * `pointer-events: none` lets the map be dragged straight through it.
 */
export const MapRecencyLegend = ({
  olderLabel = "Older",
  newerLabel = "Newer",
}: {
  olderLabel?: string;
  newerLabel?: string;
}) => (
  <div className={`${styles.legend} maplibregl-ctrl maplibregl-ctrl-scale`}>
    <div className={styles.scale}>
      <span className={styles.end}>{olderLabel}</span>
      <span
        className={styles.bar}
        style={{ background: recencyGradientCss("90deg") }}
        aria-hidden="true"
      />
      <span className={styles.end}>{newerLabel}</span>
    </div>
  </div>
);
