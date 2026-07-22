import { LEGACY_THEME_ALIASES, NAMED_THEMES, THEME_SCHEMES } from "./theme";

/**
 * Renderer-neutral, pre-paint theme initialiser. HTML entry adapters should
 * install this inline before application markup to avoid a theme flash.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(() => {
  const schemes = ${JSON.stringify(THEME_SCHEMES)};
  const named = ${JSON.stringify(NAMED_THEMES)};
  const aliases = ${JSON.stringify(LEGACY_THEME_ALIASES)};

  // Enable theme-change transitions only after the correctly themed first
  // frame has painted. Two frames ensure the class cannot animate the initial
  // system-to-stored-theme change.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.dataset.themeReady = "";
    });
  });

  const applyTheme = (theme) => {
    const scheme = theme == null ? null : schemes[theme];
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.classList.toggle("light", scheme === "light");
      el.classList.toggle("dark", scheme === "dark");
      for (const name of named) {
        el.classList.toggle("theme-" + name, name === theme);
      }
    }
  };

  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("theme");
    const urlTheme = fromUrl && Object.hasOwn(aliases, fromUrl) ? aliases[fromUrl] : fromUrl;
    if (urlTheme && Object.hasOwn(schemes, urlTheme)) {
      applyTheme(urlTheme);
      return;
    }

    const stored = localStorage.getItem("theme");
    const storedTheme = stored && Object.hasOwn(aliases, stored) ? aliases[stored] : stored;
    if (storedTheme && Object.hasOwn(schemes, storedTheme)) {
      applyTheme(storedTheme);
      if (storedTheme !== stored) {
        // Best-effort migration of the legacy alias to its canonical name.
        // The theme is already applied above, so a quota/private-mode
        // failure here must not discard the (already-applied) preference.
        try {
          localStorage.setItem("theme", storedTheme);
        } catch (_migrateErr) {
          // Ignore — the resolved theme still applies for this session.
        }
      }
      return;
    }

    // Legacy boolean preference from the old light/dark-only toggle.
    const legacy = JSON.parse(localStorage.getItem("darkMode") ?? "null");
    if (legacy === true || legacy === false) {
      applyTheme(legacy ? "dark" : "light");
      return;
    }
  } catch (_err) {
    // Fall back to the system scheme when storage or URL parsing is unavailable.
  }

  // No explicit preference: clear theme classes so :root's
  // "color-scheme: light dark" follows the OS live.
  applyTheme(null);
})();
`;
