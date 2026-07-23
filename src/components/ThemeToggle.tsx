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

const readStoredTheme = (): ThemeName | null => {
  try {
    const stored = localStorage.getItem("theme");
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

const writeStoredTheme = (value: ThemeName | null): void => {
  try {
    if (value == null) {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", value);
    }
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

const getInitialTheme = (): ThemeName | null => {
  // This is the client snapshot passed to useSyncExternalStore. Server renders
  // use the explicit server snapshot below and never call this function.
  const url = new URL(window.location.toString());
  const theme = url.searchParams.get("theme");
  const resolvedTheme = resolveThemeName(theme);
  if (resolvedTheme) {
    return resolvedTheme;
  }

  // No explicit preference (null) follows the system: :root declares
  // `color-scheme: light dark`, so with no theme classes applied the
  // light-dark() tokens track the OS, matching THEME_BOOTSTRAP_SCRIPT.
  return readStoredTheme();
};

export const ThemeToggle: React.FC = () => {
  const initialTheme = useSyncExternalStore(subscribeToHydration, getInitialTheme, () => null);
  const [themeOverride, setThemeOverride] = useReducer(
    (_state: ThemeName | null | undefined, next: ThemeName | null | undefined) => next,
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
      if (theme != null) {
        el.classList.add(...themeClassNames(theme));
      }
    }
  }, [theme]);

  return (
    <div className={styles.themeToggle}>
      <Select
        aria-label="Theme"
        className={styles.picker}
        value={theme ?? "system"}
        onChange={(event) => {
          const next = resolveThemeName(event.target.value);
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
