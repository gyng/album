import { useEffect, useReducer, useSyncExternalStore } from "react";
import styles from "./ThemeToggle.module.css";

const subscribeToHydration = () => () => {};

const readStoredDarkMode = (): boolean | null => {
  try {
    const stored = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    return stored === true || stored === false ? stored : null;
  } catch (err) {
    console.warn("Failed to read dark mode preference", err);
    return null;
  }
};

const writeStoredDarkMode = (value: boolean | null): void => {
  try {
    if (value == null) {
      localStorage.removeItem("darkMode");
      return;
    }

    localStorage.setItem("darkMode", JSON.stringify(value));
  } catch (err) {
    console.warn("Failed to persist dark mode preference", err);
  }
};

const getInitialDarkMode = (): boolean | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.toString());
  const theme = url.searchParams.get("theme");
  if (theme === "dark") {
    return true;
  }
  if (theme === "light") {
    return false;
  }

  const stored = readStoredDarkMode();
  if (stored === true || stored === false) {
    return stored;
  }

  return true;
};

const getFallbackDarkMode = (): boolean => {
  if (typeof document !== "undefined") {
    if (document.body.classList.contains("dark")) {
      return true;
    }
    if (document.body.classList.contains("light")) {
      return false;
    }
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  return true;
};

export const ThemeToggle: React.FC = () => {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const initialDarkMode = useSyncExternalStore(
    subscribeToHydration,
    getInitialDarkMode,
    () => null,
  );
  const [darkModeOverride, setDarkModeOverride] = useReducer(
    (
      _state: boolean | null | undefined,
      next: boolean | null | undefined,
    ) => next,
    undefined,
  );
  const darkMode =
    darkModeOverride === undefined ? initialDarkMode : darkModeOverride;

  useEffect(() => {
    // Mirror the pre-paint init script in _document.tsx, which toggles the
    // theme class on both the root element and the body. Updating only the
    // body would leave html in the stale theme — its color-scheme drives the
    // viewport scrollbar and overscroll glow.
    const root = document.documentElement;
    const { body } = document;
    if (darkMode === true) {
      root.classList.add("dark");
      root.classList.remove("light");
      body.classList.add("dark");
      body.classList.remove("light");
    } else if (darkMode === false) {
      root.classList.add("light");
      root.classList.remove("dark");
      body.classList.add("light");
      body.classList.remove("dark");
    } else {
      root.classList.remove("light");
      root.classList.remove("dark");
      body.classList.remove("light");
      body.classList.remove("dark");
    }
  }, [darkMode]);

  const displayDarkMode =
    darkMode == null ? (hasHydrated ? getFallbackDarkMode() : null) : darkMode;

  return (
    <div className={styles.themeToggle}>
      <button
        type="button"
        aria-label={`Switch to ${displayDarkMode ? "light" : "dark"} theme`}
        className="dark-mode-toggle"
        onClick={() => {
          const next = !(darkMode ?? true);
          setDarkModeOverride(next);
          writeStoredDarkMode(next);
        }}
      >
        {displayDarkMode == null ? (
          <span aria-hidden="true" style={{ opacity: 0 }}>
            ☀️
          </span>
        ) : (
          <span aria-hidden="true">{displayDarkMode ? "🌙" : "☀️"}</span>
        )}
      </button>
      {darkMode != null ? (
        <button
          type="button"
          aria-label="Reset theme to system default"
          onClick={() => {
            setDarkModeOverride(null);
            writeStoredDarkMode(null);
          }}
        >
          <span aria-hidden="true">⟳</span>
        </button>
      ) : null}
    </div>
  );
};
