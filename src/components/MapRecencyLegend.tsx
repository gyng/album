import styles from "./MapRecencyLegend.module.css";
import { DEFAULT_RECENCY_RAMP, recencyGradientCss, type RecencyRamp } from "../util/mapColor";

/**
 * Legend for the map's colour encoding: colour = photo age (recency), running
 * blue (older) → red (newer). Grouping is read from the journey lines, not the
 * colour, so the legend only explains the recency ramp. Purely decorative —
 * `pointer-events: none` lets the map be dragged straight through it.
 */
export const MapRecencyLegend = ({
  olderLabel = "Older",
  newerLabel = "Newer",
  ramp = DEFAULT_RECENCY_RAMP,
}: {
  olderLabel?: string;
  newerLabel?: string;
  /** The same two ends the pins are drawn from, or the legend explains nothing. */
  ramp?: RecencyRamp;
}) => (
  <div
    className={`${styles.legend} maplibregl-ctrl maplibregl-ctrl-scale`}
    // A hook for the one thing about this that is worth asserting: it is
    // decorative chrome with no role of its own, and it has to stay clear of
    // whatever the map puts along its bottom edge.
    data-map-legend="recency"
  >
    <div className={styles.scale}>
      <span className={styles.end}>{olderLabel}</span>
      <span
        className={styles.bar}
        style={{ background: recencyGradientCss("90deg", 7, ramp) }}
        aria-hidden="true"
      />
      <span className={styles.end}>{newerLabel}</span>
    </div>
  </div>
);
