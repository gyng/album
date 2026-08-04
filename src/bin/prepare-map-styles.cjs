// Writes the self-hosted basemap style for this deploy.
//
// The style itself is committed as a template; all this does is fill in the
// origin. MapLibre rejects a relative sprite URL outright ("must be absolute"),
// and the origin is not the same on a laptop, a preview and production — so it
// cannot be baked into the committed file.

const fs = require("node:fs");
const path = require("node:path");
const { resolveSiteOrigin } = require("./siteConfig.cjs");

const ORIGIN_TOKEN = "{{origin}}";

/** Replaces every origin token; returns the document untouched when there is none. */
const applyOrigin = (template, origin) => template.split(ORIGIN_TOKEN).join(origin);

/* istanbul ignore next -- disk; applyOrigin is what is tested */
const run = (log = console.log, env = process.env) => {
  const dir = path.join(__dirname, "..", "public", "map-styles");
  const source = path.join(dir, "gallery.template.json");
  if (!fs.existsSync(source)) {
    log("No self-hosted map style template; nothing to prepare.");
    return null;
  }

  const origin = resolveSiteOrigin(env);
  const output = path.join(dir, "gallery.json");
  fs.writeFileSync(output, applyOrigin(fs.readFileSync(source, "utf8"), origin));
  log(`Wrote public/map-styles/gallery.json for ${origin}`);
  return output;
};

module.exports = { applyOrigin, run };

/* istanbul ignore next -- direct CLI dispatch; run is tested through applyOrigin */
if (require.main === module) {
  run();
}
