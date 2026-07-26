const fs = require("node:fs");
const path = require("node:path");

const writeIfChanged = (outputPath, contents) => {
  const output = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (!fs.existsSync(outputPath) || !fs.readFileSync(outputPath).equals(output)) {
    fs.writeFileSync(outputPath, contents);
  }
};

/*
 * MapLibre 6 is ESM-only and locates its tile worker from `import.meta.url`
 * inside its own bundle, which Turbopack's production output does not keep as an
 * `http(s):` URL. MapLibre then falls back to an empty worker URL — silently, as
 * `new Worker("")`, which loads the page itself — and the map never requests a
 * tile. The worker is therefore served from `public/vendor/` and pointed at
 * explicitly by the MapLibre adapter.
 *
 * Both worker modules live beneath the installed MapLibre version. This is a
 * cache key as well as organisation: after an upgrade, even a page still
 * controlled by the previous service worker has no stale entry for the new
 * path. The worker imports `maplibre-gl-shared.mjs` from its own directory, so
 * the pair must remain together.
 */
const prepareMapLibreVendor = ({
  distDir = path.join(__dirname, "..", "node_modules", "maplibre-gl", "dist"),
  vendorDir = path.join(__dirname, "..", "public", "vendor"),
  version = JSON.parse(fs.readFileSync(path.join(distDir, "..", "package.json"), "utf8")).version,
} = {}) => {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new Error(`Invalid MapLibre package version: ${version}`);
  }

  fs.mkdirSync(vendorDir, { recursive: true });

  const source = fs.readFileSync(path.join(distDir, "maplibre-gl.css"), "utf8").trim();
  writeIfChanged(
    path.join(vendorDir, "maplibre-gl.css"),
    [
      "/* Generated from maplibre-gl/dist/maplibre-gl.css. Do not edit. */",
      "@layer vendor {",
      source,
      "}",
      "",
    ].join("\n"),
  );

  const workerDir = path.join(vendorDir, "maplibre-gl", version);
  fs.mkdirSync(workerDir, { recursive: true });
  for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    writeIfChanged(path.join(workerDir, name), fs.readFileSync(path.join(distDir, name)));
  }
};

if (require.main === module) {
  prepareMapLibreVendor();
}

module.exports = { prepareMapLibreVendor };
