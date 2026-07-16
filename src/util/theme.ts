/**
 * Site theme registry. "light" and "dark" are the plain schemes; named themes
 * re-tint the token palette in globals.css on top of a base colour scheme.
 * The renderer-neutral pre-paint script in themeBootstrap.ts serialises these maps, so the
 * registry must stay JSON-safe.
 */

export const NAMED_THEMES = ["paper", "ink", "slate"] as const;

export type NamedTheme = (typeof NAMED_THEMES)[number];
export type ThemeName = "light" | "dark" | NamedTheme;

/** Colour scheme each theme resolves light-dark() tokens against. */
export const THEME_SCHEMES: Record<ThemeName, "light" | "dark"> = {
  light: "light",
  dark: "dark",
  paper: "light",
  ink: "dark",
  slate: "dark",
};

export const THEME_NAMES = Object.keys(THEME_SCHEMES) as readonly ThemeName[];

export const THEME_LABELS: Record<ThemeName, string> = {
  light: "Light",
  dark: "Dark",
  paper: "Paper",
  ink: "Ink",
  slate: "Slate",
};

export const isThemeName = (value: unknown): value is ThemeName =>
  typeof value === "string" && Object.hasOwn(THEME_SCHEMES, value);

/** Every class the theme system may set on html/body. */
export const ALL_THEME_CLASSES: readonly string[] = [
  "light",
  "dark",
  ...NAMED_THEMES.map((name) => `theme-${name}`),
];

/** Classes a theme applies: its base colour scheme, plus the named palette. */
export const themeClassNames = (theme: ThemeName): readonly string[] =>
  theme === "light" || theme === "dark" ? [theme] : [THEME_SCHEMES[theme], `theme-${theme}`];
