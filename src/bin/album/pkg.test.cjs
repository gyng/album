/** @jest-environment node */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readVersion } = require("./pkg.cjs");

describe("readVersion", () => {
  it("reads the version out of a package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "album-pkg-"));
    try {
      const packageJsonPath = path.join(dir, "package.json");
      fs.writeFileSync(packageJsonPath, JSON.stringify({ name: "album", version: "1.2.3" }));
      expect(readVersion(packageJsonPath)).toBe("1.2.3");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
