/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { prepareMapLibreVendor } = require("./prepare-maplibre-vendor.cjs");

describe("prepareMapLibreVendor", () => {
  it("puts both worker modules beneath a dependency-versioned cache key", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "maplibre-vendor-"));
    const distDir = path.join(root, "dist");
    const vendorDir = path.join(root, "vendor");
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, "maplibre-gl.css"), ".map { display: block; }\n");
    fs.writeFileSync(
      path.join(distDir, "maplibre-gl-worker.mjs"),
      'import "./maplibre-gl-shared.mjs";\n',
    );
    fs.writeFileSync(path.join(distDir, "maplibre-gl-shared.mjs"), "export const shared = true;\n");

    prepareMapLibreVendor({ distDir, vendorDir, version: "6.1.2" });

    const versionDir = path.join(vendorDir, "maplibre-gl", "6.1.2");
    expect(fs.readFileSync(path.join(versionDir, "maplibre-gl-worker.mjs"), "utf8")).toBe(
      'import "./maplibre-gl-shared.mjs";\n',
    );
    expect(fs.readFileSync(path.join(versionDir, "maplibre-gl-shared.mjs"), "utf8")).toBe(
      "export const shared = true;\n",
    );
  });
});
