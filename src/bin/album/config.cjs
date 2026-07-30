// Pure helpers for reading, validating and rewriting site.config.json.
// The filesystem adapters are wired in services.cjs.

const CONFIG_FILENAME = "site.config.json";

const SOCIAL_LABELS = ["GitHub", "Fediverse", "Bluesky"];

const normaliseOrigin = (value) => {
  const trimmed = value.trim();
  const withScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  return withScheme.replace(/\/$/, "");
};

/**
 * Throws with a readable reason rather than returning false: the caller either
 * re-prompts on the message or prints it and exits.
 */
const validateOrigin = (value) => {
  if (!value || !value.trim()) {
    throw new Error("A public site URL is required.");
  }

  const normalised = normaliseOrigin(value);
  let parsed;
  try {
    parsed = new URL(normalised);
  } catch {
    throw new Error(`Not a valid URL: ${value}`);
  }

  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    throw new Error(`Not a valid host: ${parsed.hostname}`);
  }

  return normalised;
};

const validateRequiredText = (value, field) => {
  if (!value || !value.trim()) {
    throw new Error(`${field} cannot be empty.`);
  }
  return value.trim();
};

const buildSocialLinks = (hrefs) =>
  SOCIAL_LABELS.map((label, index) => ({ label, href: (hrefs[index] ?? "").trim() })).filter(
    (link) => link.href.length > 0,
  );

/**
 * Applies answers over a base configuration, preserving every field the prompts
 * do not cover. Key order follows the base object so a re-run with unchanged
 * answers produces a byte-identical file and an empty `git diff`.
 */
const buildConfig = ({ base, answers }) => ({
  ...base,
  site: {
    ...base.site,
    name: answers.name,
    shortName: answers.name,
    description: answers.description,
    origin: answers.origin,
  },
  social: answers.social,
  paths: {
    ...base.paths,
    albumsDir: answers.albumsDir,
  },
});

const serialiseConfig = (config) => `${JSON.stringify(config, null, 2)}\n`;

/**
 * Neutral starting point for a fork whose site.config.json is absent. Carries
 * no identity of its own — every prompt overwrites what matters, and the map
 * key is blank because this project's key is locked to its own domain.
 */
const buildDefaultConfig = () => ({
  site: {
    name: "My Gallery",
    shortName: "My Gallery",
    description: "A personal photo gallery",
    origin: "http://localhost:3000",
    language: "en-GB",
  },
  branding: {
    themeColor: "#000000",
    backgroundColor: "#000000",
    socialPreviewImage: "/social-preview.svg",
    socialPreviewSubtitle: "Photos, albums, map views, and timelines",
  },
  social: [],
  map: { apiKey: "", galleryStyleId: null, defaultStyle: "streets" },
  search: { databaseUrl: "/search.sqlite", embeddingsDatabaseUrl: "/search-embeddings.sqlite" },
  paths: { albumsDir: "../albums" },
  analytics: { vercel: false },
  pwa: {
    description: "Fullscreen photo frame for the photo archive.",
    startUrl: "/slideshow/shell",
  },
});

const summariseConfig = (config) => [
  `  Name         ${config.site.name}`,
  `  Description  ${config.site.description}`,
  `  URL          ${config.site.origin}`,
  `  Albums       ${config.paths.albumsDir}`,
  `  Social       ${config.social.map((link) => link.label).join(", ") || "none"}`,
];

// A fork inherits this repository's history, and no CLI can rewrite that.
// Saying so plainly is more useful than a cleanup step that cannot work.
const HISTORY_DISCLOSURE = [
  "",
  "Note: this repository's git history still contains the original author's",
  "photographs (albums/test-* fixtures) and two search databases built from",
  "them. `album init` cannot remove data from history — only a history rewrite",
  "can, and that breaks every existing clone.",
];

const NEXT_STEPS = [
  "",
  "Next steps:",
  "  1. Put album folders in your albums directory",
  "  2. album doctor        — check this machine is ready",
  "  3. album dev           — run the site locally",
  "  4. album index         — build the search index (needs Python and a GPU)",
];

module.exports = {
  CONFIG_FILENAME,
  HISTORY_DISCLOSURE,
  NEXT_STEPS,
  SOCIAL_LABELS,
  buildConfig,
  buildDefaultConfig,
  buildSocialLinks,
  normaliseOrigin,
  serialiseConfig,
  summariseConfig,
  validateOrigin,
  validateRequiredText,
};
