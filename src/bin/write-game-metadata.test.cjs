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

it("preserves the prebuilt preview and changelog when stamping a deployment", () => {
  fs.writeFileSync(path.join(staticDir, "version.json"), JSON.stringify({ gitSha: commit }));
  fs.mkdirSync(path.join(staticDir, "fun"));
  const authored = {
    schemaVersion: 1,
    updatedAt: "2020-01-01T00:00:00Z",
    previewImage: { url: "preview.abc123.webp", alt: "A grid of photographs" },
    changelogUrl: "changelog.html",
  };
  fs.writeFileSync(path.join(staticDir, "fun/meta.json"), JSON.stringify(authored));
  writeGameMetadata({ staticDir, now: new Date("2026-10-19T00:00:00Z") });
  const read = () => JSON.parse(fs.readFileSync(path.join(staticDir, "fun/meta.json"), "utf8"));
  expect(read()).toEqual({
    schemaVersion: 1,
    updatedAt: "2026-10-19T00:00:00Z",
    commit,
    previewImage: authored.previewImage,
    changelogUrl: authored.changelogUrl,
  });
  writeGameMetadata({ staticDir, now: new Date("2026-10-20T00:00:00Z") });
  expect(read()).toMatchObject({
    updatedAt: "2026-10-20T00:00:00Z",
    previewImage: authored.previewImage,
    changelogUrl: authored.changelogUrl,
  });
});

it("keeps the authored template intact when Vercel hard-links it into the output", () => {
  fs.writeFileSync(path.join(staticDir, "version.json"), "{}");
  const templatePath = path.join(staticDir, "template.json");
  const authored = JSON.stringify({
    schemaVersion: 1,
    previewImage: { url: "preview.webp", alt: "Photos" },
  });
  fs.writeFileSync(templatePath, authored);
  fs.mkdirSync(path.join(staticDir, "fun"));
  fs.linkSync(templatePath, path.join(staticDir, "fun/meta.json"));
  writeGameMetadata({ staticDir });
  expect(fs.readFileSync(templatePath, "utf8")).toBe(authored);
  expect(JSON.parse(fs.readFileSync(path.join(staticDir, "fun/meta.json"), "utf8"))).toHaveProperty(
    "updatedAt",
  );
});

it("ships a decodable 800 by 500 preview with a content-hashed URL and accessible description", async () => {
  const crypto = require("node:crypto");
  const sharp = require("sharp");
  const publicDir = path.resolve(__dirname, "../public");
  const template = JSON.parse(fs.readFileSync(path.join(publicDir, "fun/meta.json"), "utf8"));
  expect(template.schemaVersion).toBe(1);
  const preview = template.previewImage;
  expect(preview.alt.trim().length).toBeGreaterThan(0);
  const url = new URL(preview.url, "https://example.com/fun/meta.json");
  expect(url.protocol).toBe("https:");
  expect(url.pathname).toMatch(/^\/fun\/preview\.[a-f0-9]+\.webp$/);
  const bytes = fs.readFileSync(path.join(publicDir, url.pathname));
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  expect(url.pathname).toBe(`/fun/preview.${hash}.webp`);
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 800, height: 500, format: "webp" });
  await expect(sharp(bytes).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
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
