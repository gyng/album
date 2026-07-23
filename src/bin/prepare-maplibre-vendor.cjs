const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "node_modules", "maplibre-gl", "dist");
const vendorDir = path.join(__dirname, "..", "public", "vendor");

const writeIfChanged = (outputPath, contents) => {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath) !== contents) {
    fs.writeFileSync(outputPath, contents);
  }
};

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

/*
 * MapLibre 6 is ESM-only and locates its tile worker from `import.meta.url`
 * inside its own bundle, which Turbopack's production output does not keep as an
 * `http(s):` URL. MapLibre then falls back to an empty worker URL — silently, as
 * `new Worker("")`, which loads the page itself — and the map never requests a
 * tile. The worker is therefore served from `public/vendor/` and pointed at
 * explicitly by the MapLibre adapter. It imports `maplibre-gl-shared.mjs` from
 * its own directory, so both files ship and neither may be renamed.
 */
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  writeIfChanged(path.join(vendorDir, name), fs.readFileSync(path.join(distDir, name)));
}
