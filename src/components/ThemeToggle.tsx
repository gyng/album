import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

export const ThemeToggle: React.FC = () => {
  const [darkMode, setDarkMode] = useState<boolean | null>(null);
  const [browserDarkMode, setBrowserDarkMode] = useState<boolean | null>(null);

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

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    if (stored === true || stored === false) {
      setDarkMode(JSON.parse(stored));
    } else {
      const browserDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      setBrowserDarkMode(browserDark);
    }

    // Override initial theme, used for screenshots
    const url = new URL(window.location.toString());
    const theme = url.searchParams.get("theme");
    const requestedMode =
      theme === "dark" ? true : theme === "light" ? false : null;
    if (requestedMode != null) {
      setDarkMode(requestedMode);
    }
  }, []);

  return (
    <div className={styles.themeToggle}>
      <button
        title="Toggle dark mode"
        className="dark-mode-toggle"
        onClick={() => {
          const next = !!!(darkMode ?? browserDarkMode);
          setDarkMode(next);
          localStorage.setItem("darkMode", JSON.stringify(next));
        }}
      >
        {darkMode == null && browserDarkMode == null ? (
          <span style={{ opacity: 0 }}>☀️</span>
        ) : (darkMode ?? browserDarkMode) ? (
          "☀️"
        ) : (
          "🌙"
        )}
      </button>
      {darkMode != null ? (
        <button
          title="Reset to system default"
          onClick={() => {
            setDarkMode(null);
            localStorage.removeItem("darkMode");
          }}
        >
          ⟳
        </button>
      ) : null}
    </div>
  );
};
