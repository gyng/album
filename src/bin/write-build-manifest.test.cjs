/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createBuildManifest, run, writeBuildManifest } = require("./write-build-manifest.cjs");

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

  it("creates timestamped metadata from the running repository by default", () => {
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;
    delete process.env.VERCEL_GIT_COMMIT_SHA;

    const manifest = createBuildManifest();

    expect(Date.parse(manifest.builtAt)).not.toBeNaN();
    expect(manifest.gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.buildVersion).toBe(manifest.gitSha);
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

  it("falls back past a blank VERCEL_GIT_COMMIT_SHA to the git SHA", () => {
    // Vercel's `vercel pull` writes VERCEL_GIT_COMMIT_SHA="" — the empty string
    // must not short-circuit the fallback chain.
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;

    const manifest = createBuildManifest({
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "abcdef1234567890",
    });

    expect(manifest.buildVersion).toBe("abcdef1234567890");
    expect(manifest.gitSha).toBe("abcdef1234567890");
  });

  it("never ships an empty buildVersion when the SHA is blank and git is unavailable", () => {
    // Reproduces the live production bug: VERCEL_GIT_COMMIT_SHA="" with no
    // NEXT_PUBLIC_BUILD_VERSION and no reachable git repo. buildVersion must
    // fall through to builtAt, never "".
    process.env.VERCEL_GIT_COMMIT_SHA = "";
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;

    const manifest = createBuildManifest({
      builtAt: "2026-03-29T00:00:00.000Z",
      gitCwd: path.join(os.tmpdir(), "album-build-manifest-not-a-git-repo"),
    });

    expect(manifest.buildVersion).not.toBe("");
    expect(manifest.buildVersion).toBe("2026-03-29T00:00:00.000Z");
    expect(manifest.gitSha).toBeNull();
  });

  it("treats an explicitly blank gitSha option as absent", () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.NEXT_PUBLIC_BUILD_VERSION;

    const manifest = createBuildManifest({
      builtAt: "2026-03-29T00:00:00.000Z",
      gitSha: "",
      gitCwd: path.join(os.tmpdir(), "album-build-manifest-not-a-git-repo"),
    });

    expect(manifest.buildVersion).toBe("2026-03-29T00:00:00.000Z");
    expect(manifest.gitSha).toBeNull();
  });

  it("writes version.json and buildVersion.ts to the target app root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-manifest-"));

    const { manifest, versionJsonPath, buildVersionModulePath } = writeBuildManifest({
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
    expect(buildVersionModule).toContain('export const BUILD_VERSION = "build-456";');
    expect(buildVersionModule).toContain('"gitSha": "fedcba9876543210"');
  });

  it("uses the application root when no write options are supplied", () => {
    const mkdir = jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const write = jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    try {
      const result = writeBuildManifest();

      expect(result.versionJsonPath).toBe(path.resolve(__dirname, "../public/version.json"));
      expect(result.buildVersionModulePath).toBe(path.resolve(__dirname, "../lib/buildVersion.ts"));
      expect(mkdir).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      mkdir.mockRestore();
      write.mockRestore();
    }
  });

  it("reports the generated version through the command adapter", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-manifest-run-"));
    const log = jest.fn();

    const manifest = run(
      {
        appRoot: tempRoot,
        buildVersion: "release-789",
        builtAt: "2026-03-29T01:02:03.000Z",
        gitSha: "fedcba9876543210",
      },
      log,
    );

    expect(manifest.buildVersion).toBe("release-789");
    expect(log).toHaveBeenCalledWith("Wrote build manifest release-789");
  });

  it("logs through the console by default", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-build-manifest-console-"));
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      run({
        appRoot: tempRoot,
        buildVersion: "release-console",
        builtAt: "2026-03-29T01:02:03.000Z",
        gitSha: "fedcba9876543210",
      });

      expect(log).toHaveBeenCalledWith("Wrote build manifest release-console");
    } finally {
      log.mockRestore();
    }
  });
});
