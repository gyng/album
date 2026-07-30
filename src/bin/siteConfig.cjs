// CommonJS twin of lib/siteConfig.ts, for next.config.js and the bin scripts,
// which cannot import a .ts module. Both read the same JSON file, so the site's
// identity has exactly one source of truth.

const path = require("node:path");

const siteConfig = require(path.join(__dirname, "..", "site.config.json"));

/** Mirrors getSiteOrigin in lib/seo.ts. */
const normaliseOrigin = (value) =>
  value.startsWith("http://") || value.startsWith("https://")
    ? value.replace(/\/$/, "")
    : `https://${value.replace(/\/$/, "")}`;

/**
 * Deploy-time override chain, falling back to the authored identity.
 *
 * Uses `||` rather than `??` on purpose: Vercel writes empty strings for
 * unset project variables, and `??` would let `""` through and produce a bare
 * "https://".
 */
const resolveSiteOrigin = (env = process.env) =>
  normaliseOrigin(
    env.NEXT_PUBLIC_SITE_URL ||
      env.SITE_URL ||
      env.VERCEL_PROJECT_PRODUCTION_URL ||
      siteConfig.site.origin,
  );

/** Resolves the configured albums directory against an app root. */
const resolveAlbumsDir = (appRoot) => path.resolve(appRoot, siteConfig.paths.albumsDir);

module.exports = { normaliseOrigin, resolveAlbumsDir, resolveSiteOrigin, siteConfig };
