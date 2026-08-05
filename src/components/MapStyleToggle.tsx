import React from "react";
import {
  AUTO_MAP_STYLE,
  defaultMapStyleForTheme,
  getStoredMapStyleChoice,
  MAP_STYLE_GROUPS,
  type MapStyleChoice,
  type MapStyleName,
  MAP_STYLES,
  mapStyleForChoice,
  resolveMapStyleChoice,
  setMapStyleChoice,
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
export const useMapStyleChoice = (): MapStyleChoice => {
  const chosen = React.useSyncExternalStore(
    subscribeMapStyleName,
    getStoredMapStyleChoice,
    () => null,
  );

  // Never having chosen and having chosen to follow the theme are the same
  // instruction, so they are the same value here.
  return chosen ?? AUTO_MAP_STYLE;
};

export const useMapStyleName = (): MapStyleName => {
  const choice = useMapStyleChoice();
  const theme = useActiveTheme();

  // A theme with an obvious map of its own supplies the default; a reader who
  // has pinned one keeps it, whatever they are wearing.
  return mapStyleForChoice(choice, theme);
};

/**
 * Picks the basemap under the photos. Sits beside the site theme, because it is
 * the same kind of choice — how the page looks, remembered per device — and
 * every option comes from the map's existing provider and key.
 */
export const MapStyleToggle: React.FC = () => {
  const choice = useMapStyleChoice();
  const theme = useActiveTheme();

  return (
    <Select
      className={styles.picker}
      aria-label="Map style"
      value={choice}
      onChange={(event) => {
        const next = resolveMapStyleChoice(event.target.value);
        if (next) {
          setMapStyleChoice(next);
        }
      }}
    >
      {/* Outside the groups because it is not a basemap: it is the instruction
          to keep wearing whatever the page is. Its swatch is the ground of the
          map it would load, so the row previews where it leads. */}
      <option
        value={AUTO_MAP_STYLE}
        style={
          {
            "--swatch": MAP_STYLES[defaultMapStyleForTheme(theme)].swatch,
          } as React.CSSProperties
        }
      >
        Match theme
      </option>
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
