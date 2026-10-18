/** @jest-environment node */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeGameMetadata } = require("./write-game-metadata.cjs");

const commit = "0123456789abcdef0123456789abcdef01234567";
let staticDir;
beforeEach(() => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "album-game-meta-"));
});
afterEach(() => fs.rmSync(staticDir, { recursive: true, force: true }));

it("stamps each deployment while retaining the identity of the prebuilt game", () => {
  fs.writeFileSync(
    path.join(staticDir, "version.json"),
    JSON.stringify({
      gitSha: commit,
      buildVersion: "release-1",
      builtAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  const now = new Date("2026-10-18T14:30:00.123Z");
  writeGameMetadata({ staticDir, now });
  const read = () => JSON.parse(fs.readFileSync(path.join(staticDir, "fun/meta.json"), "utf8"));
  expect(read()).toEqual({
    schemaVersion: 1,
    updatedAt: "2026-10-18T14:30:00Z",
    version: "release-1",
    commit,
  });
  expect(read()).toEqual(read());
  writeGameMetadata({ staticDir, now: new Date("2026-10-19T00:00:00Z") });
  expect(read()).toEqual({
    schemaVersion: 1,
    updatedAt: "2026-10-19T00:00:00Z",
    version: "release-1",
    commit,
  });
});

it("omits unavailable optional fields rather than attributing the build to the current checkout", () => {
  fs.writeFileSync(
    path.join(staticDir, "version.json"),
    JSON.stringify({ gitSha: null, buildVersion: "" }),
  );
  writeGameMetadata({ staticDir });
  const metadata = JSON.parse(fs.readFileSync(path.join(staticDir, "fun/meta.json"), "utf8"));
  expect(metadata.schemaVersion).toBe(1);
  expect(metadata.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(metadata).not.toHaveProperty("commit");
  expect(metadata).not.toHaveProperty("version");
});

it("refuses to stamp a missing prebuilt output", () => {
  expect(() => writeGameMetadata({ staticDir })).toThrow();
  expect(fs.existsSync(path.join(staticDir, "fun/meta.json"))).toBe(false);
});

it("configures public JSON with CORS and mandatory revalidation", async () => {
  const config = require("../next.config.js");
  const rule = (await config.headers()).find(({ source }) => source === "/fun/meta.json");
  expect(rule.headers).toEqual(
    expect.arrayContaining([
      { key: "Content-Type", value: "application/json" },
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Cache-Control", value: "no-cache" },
    ]),
  );
});
