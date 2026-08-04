import React from "react";
import { NAMED_THEMES, type ThemeName } from "../util/theme";

/**
 * The theme the page is actually wearing, read off the root element.
 *
 * Not from the picker's own state: the theme can also arrive from the pre-paint
 * script, from `?theme=`, or from another tab, and all of those reach the DOM
 * before they reach any React state. The class list is the one place that is
 * always right.
 */
const readTheme = (): ThemeName => {
  if (typeof document === "undefined") return "light";
  const classes = document.documentElement.classList;
  const named = NAMED_THEMES.find((theme) => classes.contains(`theme-${theme}`));
  if (named) return named;
  return classes.contains("dark") ? "dark" : "light";
};

export const useActiveTheme = (): ThemeName => {
  // The server renders the default; the first effect corrects it, which is the
  // same shape every other client-only preference here takes.
  const [theme, setTheme] = React.useState<ThemeName>("light");

  React.useEffect(() => {
    setTheme(readTheme());

    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
};
