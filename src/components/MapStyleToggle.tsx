import React from "react";
import {
  defaultMapStyleForTheme,
  getStoredMapStyleName,
  MAP_STYLE_GROUPS,
  type MapStyleName,
  MAP_STYLES,
  resolveMapStyleName,
  setMapStyleName,
  subscribeMapStyleName,
} from "../util/mapStyles";
import { useActiveTheme } from "./useActiveTheme";
import { Select } from "./ui";
import styles from "./MapStyleToggle.module.css";

/**
 * Reads the basemap in force, and re-renders whoever asks when it changes.
 *
 * The server has no preference and no theme to read, so it renders the
 * configured default and hydration matches — the reader's own choice, or the
 * one their theme implies, arrives on the client's first snapshot instead.
 */
export const useMapStyleName = (): MapStyleName => {
  const chosen = React.useSyncExternalStore(
    subscribeMapStyleName,
    getStoredMapStyleName,
    () => null,
  );
  const theme = useActiveTheme();

  // A theme with an obvious map of its own supplies the default; a reader who
  // has chosen one keeps it, whatever they are wearing.
  return chosen ?? defaultMapStyleForTheme(theme);
};

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
      {/* Grouped, because eighteen names in one list is a list nobody reads to
          the end of — and the split is the one a reader is actually deciding
          between: a basemap somebody else drew, or one this site made. */}
      {MAP_STYLE_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.names.map((name) => (
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
        </optgroup>
      ))}
    </Select>
  );
};
