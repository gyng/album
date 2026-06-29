/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createBuildManifest,
  writeBuildManifest,
} = require("./write-build-manifest.cjs");

describe("build manifest generation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a manifest with an explicit build version", () => {
    const manifest = createBuildManifest({
      buildVersion: "build-123",
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });

    expect(manifest).toEqual({
      buildVersion: "build-123",
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });
  });

  it("uses the git SHA as the default reload version across timestamp-only rebuilds", () => {
    const first = createBuildManifest({
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });
    const second = createBuildManifest({
      builtAt: "2026-03-30T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });

    expect(first.buildVersion).toBe("abcdef1234567890");
    expect(second.buildVersion).toBe(first.buildVersion);
    expect(second.builtAt).not.toBe(first.builtAt);
  });

  it("ignores blank environment build versions", () => {
    process.env.NEXT_PUBLIC_BUILD_VERSION = "";

    const manifest = createBuildManifest({
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });

    expect(manifest.buildVersion).toBe("abcdef1234567890");
  });

  it("writes version.json and buildVersion.ts to the target app root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-manifest-"));

    const { manifest, versionJsonPath, buildVersionModulePath } =
      writeBuildManifest({
        appRoot: tempRoot,
        buildVersion: "build-456",
        builtAt: "2026-03-29T01:02:03.000Z",
        gitSha: "fedcba9876543210",
      });

    expect(manifest.buildVersion).toBe("build-456");
    expect(fs.existsSync(versionJsonPath)).toBe(true);
    expect(fs.existsSync(buildVersionModulePath)).toBe(true);

    const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, "utf8"));
    expect(versionJson).toEqual({
      buildVersion: "build-456",
      builtAt: "2026-03-29T01:02:03.000Z",
      gitSha: "fedcba9876543210",
    });

    const buildVersionModule = fs.readFileSync(buildVersionModulePath, "utf8");
    expect(buildVersionModule).toContain(
      'export const BUILD_VERSION = "build-456";',
    );
    expect(buildVersionModule).toContain('"gitSha": "fedcba9876543210"');
  });
});
