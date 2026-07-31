/** @jest-environment node */

// Drives the real filesystem and subprocess adapters, so the wiring in
// services.cjs is proven rather than merely constructed.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { commandExists, fileExists, readJsonFile } = require("./probeAdapters.cjs");
const { buildDefaultServices, countAlbums, writeFile } = require("./services.cjs");

const withTempDir = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "album-services-"));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("probe adapters", () => {
  it("detects an existing path and rejects a missing one", () => {
    withTempDir((dir) => {
      expect(fileExists(dir)).toBe(true);
      expect(fileExists(path.join(dir, "nope"))).toBe(false);
    });
  });

  it("resolves a command that exists and one that does not", () => {
    expect(commandExists("node")).toBe(true);
    expect(commandExists("definitely-not-a-real-binary-xyz")).toBe(false);
  });

  it.each([
    ["win32", "where"],
    ["linux", "which"],
  ])("uses the %s lookup tool", (platform, expected) => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { configurable: true, value: platform });
    try {
      const spawnImpl = jest.fn(() => ({ status: 0 }));
      expect(commandExists("node", spawnImpl)).toBe(true);
      expect(spawnImpl).toHaveBeenCalledWith(expected, ["node"], { stdio: "ignore" });
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  it("reads JSON and returns null for unreadable or malformed files", () => {
    withTempDir((dir) => {
      const good = path.join(dir, "good.json");
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(good, JSON.stringify({ modelProfile: "hybrid" }));
      fs.writeFileSync(bad, "{ not json");

      expect(readJsonFile(good)).toEqual({ modelProfile: "hybrid" });
      expect(readJsonFile(bad)).toBeNull();
      expect(readJsonFile(path.join(dir, "missing.json"))).toBeNull();
    });
  });
});

describe("countAlbums", () => {
  it("counts directories and ignores loose files", () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, "kanto"));
      fs.mkdirSync(path.join(dir, "kansai"));
      fs.writeFileSync(path.join(dir, "README.md"), "not an album");

      expect(countAlbums(dir)).toBe(2);
    });
  });
});

describe("writeFile", () => {
  it("writes contents that read back unchanged", () => {
    withTempDir((dir) => {
      const target = path.join(dir, "site.config.json");
      writeFile(target, '{"a":1}\n');
      expect(fs.readFileSync(target, "utf8")).toBe('{"a":1}\n');
    });
  });
});

describe("buildDefaultServices", () => {
  it("exposes the collaborators every command depends on", () => {
    const services = buildDefaultServices();

    for (const key of [
      "env",
      "askText",
      "askYesNo",
      "writeFile",
      "readJsonFile",
      "readVersion",
      "runShellCommand",
      "createPreflightReport",
      "printPreflightReport",
      "targets",
      "buildIndexProbes",
      "buildSiteProbes",
    ]) {
      expect(services[key]).toBeDefined();
    }
  });

  it("builds site probes against the real filesystem", () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, "albums"));
      fs.mkdirSync(path.join(dir, "albums", "kanto"));

      const rows = buildDefaultServices().buildSiteProbes({
        context: {
          albumsDir: path.join(dir, "albums"),
          dbPath: path.join(dir, "search.sqlite"),
          embeddingsDbPath: path.join(dir, "search-embeddings.sqlite"),
        },
      });

      expect(rows.find((row) => row.label === "albums").value).toContain("1 found");
      expect(rows.find((row) => row.label === "search index").level).toBe("warn");
    });
  });

  it("builds index probes against the real toolchain", () => {
    withTempDir((dir) => {
      const rows = buildDefaultServices().buildIndexProbes({
        context: { indexDir: dir },
        env: {},
      });

      expect(rows.map((row) => row.label)).toEqual(["uv", "python env", "llama-server", "gpu"]);
      // The .venv was never created in this temp dir, so this must block.
      expect(rows.find((row) => row.label === "python env").level).toBe("block");
    });
  });
});
