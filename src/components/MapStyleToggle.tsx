import React from "react";
import {
  getMapStyleName,
  getServerMapStyleName,
  MAP_STYLE_NAMES,
  MAP_STYLES,
  resolveMapStyleName,
  setMapStyleName,
  subscribeMapStyleName,
} from "../util/mapStyles";
import { Select } from "./ui";
import styles from "./MapStyleToggle.module.css";

/**
 * Reads the chosen basemap, and re-renders whoever asks when it changes.
 *
 * The server has no preference to read, so it renders the default and hydration
 * matches — the choice arrives on the client's first snapshot instead.
 */
export const useMapStyleName = () =>
  React.useSyncExternalStore(subscribeMapStyleName, getMapStyleName, getServerMapStyleName);

/**
 * Picks the basemap under the photos. Sits beside the site theme, because it is
 * the same kind of choice — how the page looks, remembered per device — and
 * every option comes from the map's existing provider and key.
 */
export const MapStyleToggle: React.FC = () => {
  const style = useMapStyleName();

  return (
    <Select
      className={styles.picker}
      aria-label="Map style"
      value={style}
      onChange={(event) => {
        const next = resolveMapStyleName(event.target.value);
        if (next) {
          setMapStyleName(next);
        }
      }}
    >
      {MAP_STYLE_NAMES.map((name) => (
        <option
          key={name}
          value={name}
          // The style's own ground colour, so the menu shows what it looks
          // like rather than only what it is called.
          style={{ "--swatch": MAP_STYLES[name].swatch } as React.CSSProperties}
        >
          {MAP_STYLES[name].label}
        </option>
      ))}
    </Select>
  );
};
