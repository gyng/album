/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { formatTimestamp, parseArgs, printHelp, run } = require("./backup-publish-assets.cjs");

describe("publish asset backups", () => {
  it("parses backup selection and output flags", () => {
    expect(parseArgs([])).toEqual({ outDir: null, withAlbums: false, withDb: true });
    expect(parseArgs(["--out", "archive", "--with-albums"])).toEqual({
      outDir: "archive",
      withAlbums: true,
      withDb: true,
    });
    expect(parseArgs(["-o", "archive", "--albums-only"])).toEqual({
      outDir: "archive",
      withAlbums: true,
      withDb: false,
    });
    expect(parseArgs(["--with-albums", "--db-only"])).toEqual({
      outDir: null,
      withAlbums: false,
      withDb: true,
    });
    expect(parseArgs(["-h"])).toMatchObject({ help: true });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
    expect(() => parseArgs(["--out"])).toThrow("Missing value for --out");
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });

  it("formats stable UTC snapshot timestamps", () => {
    expect(formatTimestamp(new Date("2026-03-04T05:06:07Z"))).toBe("20260304-050607Z");
    expect(formatTimestamp()).toMatch(/^\d{8}-\d{6}Z$/);
  });

  it("prints help through an injectable logger", () => {
    const log = jest.fn();
    printHelp(log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--albums-only"));

    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    printHelp();
    expect(consoleLog).toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it("backs up available databases and albums and records missing database files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-backup-"));
    const srcDir = path.join(root, "src");
    fs.mkdirSync(path.join(srcDir, "public"), { recursive: true });
    fs.mkdirSync(path.join(root, "albums", "trip"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "public", "search.sqlite"), "db");
    fs.writeFileSync(path.join(root, "albums", "trip", "photo.jpg"), "photo");
    const log = jest.fn();

    const manifest = run({
      srcDir,
      argv: ["--out", "custom-backups", "--with-albums"],
      now: () => new Date("2026-03-04T05:06:07Z"),
      log,
    });

    expect(manifest).toMatchObject({
      createdAt: "2026-03-04T05:06:07.000Z",
      options: { withDb: true, withAlbums: true },
    });
    expect(manifest.copiedFiles).toHaveLength(2);
    expect(manifest.missingFiles).toEqual([
      path.join(srcDir, "public", "search-embeddings.sqlite"),
    ]);
    expect(fs.existsSync(path.join(manifest.snapshotDir, "db", "search.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(manifest.snapshotDir, "albums", "trip", "photo.jpg"))).toBe(
      true,
    );
    expect(log).toHaveBeenCalledWith("Missing 1 item(s):");
    expect(log).toHaveBeenCalledWith(
      `- ${path.join(srcDir, "public", "search-embeddings.sqlite")}`,
    );
  });

  it("uses the default backup root and logger for a database-only snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-backup-default-"));
    const srcDir = path.join(root, "src");
    fs.mkdirSync(path.join(srcDir, "public"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "public", "search.sqlite"), "db");
    fs.writeFileSync(path.join(srcDir, "public", "search-embeddings.sqlite"), "embeddings");
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const manifest = run({
      srcDir,
      argv: [],
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    expect(manifest.snapshotDir).toContain(path.join(root, "backups", "publish-backup-"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Backup created at"));
    log.mockRestore();
  });

  it("returns after help and validates albums and empty selections", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-backup-errors-"));
    const srcDir = path.join(root, "src");
    fs.mkdirSync(path.join(srcDir, "public"), { recursive: true });
    const log = jest.fn();

    expect(run({ srcDir, argv: ["--help"], log })).toBeNull();
    expect(() => run({ srcDir, argv: ["--albums-only"], log })).toThrow(
      "Albums directory does not exist",
    );
    expect(() => run({ srcDir, argv: [], log })).toThrow(
      "Nothing was copied. Check your options and source files.",
    );
  });
});
