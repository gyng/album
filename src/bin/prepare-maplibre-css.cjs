const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.join(
  __dirname,
  "..",
  "node_modules",
  "maplibre-gl",
  "dist",
  "maplibre-gl.css",
);
const outputPath = path.join(__dirname, "..", "public", "vendor", "maplibre-gl.css");
const source = fs.readFileSync(sourcePath, "utf8").trim();
const output = [
  "/* Generated from maplibre-gl/dist/maplibre-gl.css. Do not edit. */",
  "@layer vendor {",
  source,
  "}",
  "",
].join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
  fs.writeFileSync(outputPath, output);
}
