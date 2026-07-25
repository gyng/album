import { useEffect, useReducer, useSyncExternalStore } from "react";
import {
  ALL_THEME_CLASSES,
  resolveThemeName,
  THEME_LABELS,
  THEME_NAMES,
  type ThemeName,
  themeClassNames,
} from "../util/theme";
import { Select } from "./ui";
import styles from "./ThemeToggle.module.css";

const subscribeToHydration = () => () => {};

/**
 * What the reader has chosen: a theme, or the OS's own scheme.
 *
 * "system" is a stored choice rather than an empty slot, because an empty slot
 * now means something else — nobody has chosen, which starts dark.
 */
type ThemeChoice = ThemeName | "system";

/** A first visit gets this, rather than whatever the OS happens to be set to. */
const DEFAULT_THEME: ThemeChoice = "dark";

const readStoredTheme = (): ThemeChoice | null => {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "system") {
      return "system";
    }

    const theme = resolveThemeName(stored);
    if (theme) {
      return theme;
    }

    // Legacy boolean preference from the old light/dark-only toggle.
    const legacy = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    if (legacy === true || legacy === false) {
      return legacy ? "dark" : "light";
    }

    return null;
  } catch (err) {
    console.warn("Failed to read theme preference", err);
    return null;
  }
};

const writeStoredTheme = (value: ThemeChoice): void => {
  try {
    localStorage.setItem("theme", value);
    // The named-theme preference supersedes the legacy boolean.
    localStorage.removeItem("darkMode");
  } catch (err) {
    console.warn("Failed to persist theme preference", err);
  }
};

// Scopes each dropdown option to its theme's palette so the CSS swatch
// (option::before) previews that theme's own background and accent tokens.
const optionClassName = (name: ThemeName): string => {
  if (name === "light") {
    return styles.optionLight ?? "";
  }
  if (name === "dark") {
    return styles.optionDark ?? "";
  }
  return `theme-${name}`;
};

const getInitialTheme = (): ThemeChoice => {
  // This is the client snapshot passed to useSyncExternalStore. Server renders
  // use the explicit server snapshot below and never call this function.
  const url = new URL(window.location.toString());
  const theme = url.searchParams.get("theme");
  if (theme === "system") {
    return "system";
  }

  const resolvedTheme = resolveThemeName(theme);
  if (resolvedTheme) {
    return resolvedTheme;
  }

  // "system" applies no theme classes, so :root's `color-scheme: light dark`
  // tracks the OS; anything else applies its own. Nothing stored starts dark,
  // matching THEME_BOOTSTRAP_SCRIPT.
  return readStoredTheme() ?? DEFAULT_THEME;
};

export const ThemeToggle: React.FC = () => {
  const initialTheme = useSyncExternalStore(
    subscribeToHydration,
    getInitialTheme,
    () => DEFAULT_THEME,
  );
  const [themeOverride, setThemeOverride] = useReducer(
    (_state: ThemeChoice | undefined, next: ThemeChoice | undefined) => next,
    undefined,
  );
  const theme = themeOverride === undefined ? initialTheme : themeOverride;

  useEffect(() => {
    // Mirror THEME_BOOTSTRAP_SCRIPT, which sets the theme
    // classes on both the root element and the body. Updating only the body
    // would leave html in the stale theme — its color-scheme drives the
    // viewport scrollbar and overscroll glow.
    for (const el of [document.documentElement, document.body]) {
      el.classList.remove(...ALL_THEME_CLASSES);
      if (theme !== "system") {
        el.classList.add(...themeClassNames(theme));
      }
    }
  }, [theme]);

  return (
    <div className={styles.themeToggle}>
      <Select
        aria-label="Theme"
        className={styles.picker}
        value={theme}
        onChange={(event) => {
          const next = resolveThemeName(event.target.value) ?? "system";
          setThemeOverride(next);
          writeStoredTheme(next);
        }}
      >
        <option className={styles.optionSystem} value="system">
          System
        </option>
        {THEME_NAMES.map((name) => (
          <option key={name} className={optionClassName(name)} value={name}>
            {THEME_LABELS[name]}
          </option>
        ))}
      </Select>
    </div>
  );
};
