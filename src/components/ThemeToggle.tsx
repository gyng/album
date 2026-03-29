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
    if (darkMode === true) {
      document.body.classList.add("dark");
      document.body.classList.remove("light");
    } else if (darkMode === false) {
      document.body.classList.add("light");
      document.body.classList.remove("dark");
    } else {
      document.body.classList.remove("light");
      document.body.classList.remove("dark");
    }
  }, [darkMode]);

  const displayDarkMode =
    darkMode == null ? (hasHydrated ? getFallbackDarkMode() : null) : darkMode;

  return (
    <div className={styles.themeToggle}>
      <button
        title="Toggle dark mode"
        className="dark-mode-toggle"
        onClick={() => {
          const next = !(darkMode ?? true);
          setDarkModeOverride(next);
          writeStoredDarkMode(next);
        }}
      >
        {displayDarkMode == null ? (
          <span style={{ opacity: 0 }}>☀️</span>
        ) : displayDarkMode ? (
          "🌙"
        ) : (
          "☀️"
        )}
      </button>
      {darkMode != null ? (
        <button
          title="Reset to system default"
          onClick={() => {
            setDarkModeOverride(null);
            writeStoredDarkMode(null);
          }}
        >
          ⟳
        </button>
      ) : null}
    </div>
  );
};
