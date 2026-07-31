/** @jest-environment node */

const path = require("node:path");
const {
  LLAMA_SERVER_ENV,
  buildIndexProbes,
  buildSiteProbes,
  defaultLlamaServerPaths,
  formatIndexStats,
  formatProbeRows,
  hasBlockers,
  resolveLlamaServer,
} = require("./probes.cjs");

const context = {
  indexDir: "/repo/index",
  albumsDir: "/repo/albums",
  dbPath: "/repo/src/public/search.sqlite",
  embeddingsDbPath: "/repo/src/public/search-embeddings.sqlite",
};

const levelOf = (rows, label) => rows.find((row) => row.label === label).level;

describe("resolveLlamaServer", () => {
  it("prefers an explicitly configured binary", () => {
    expect(
      resolveLlamaServer({
        env: { [LLAMA_SERVER_ENV]: "/opt/llama-server" },
        fileExists: (candidate) => candidate === "/opt/llama-server",
      }),
    ).toBe("/opt/llama-server");
  });

  it("returns null when the configured binary is absent", () => {
    expect(
      resolveLlamaServer({ env: { [LLAMA_SERVER_ENV]: "/opt/gone" }, fileExists: () => false }),
    ).toBeNull();
  });

  it("falls back to the discovery paths", () => {
    const [expected] = defaultLlamaServerPaths("/home/someone");
    expect(
      resolveLlamaServer({
        env: {},
        fileExists: (candidate) => candidate === expected,
        homedir: "/home/someone",
      }),
    ).toBe(expected);
  });

  it("returns null when nothing is discoverable", () => {
    expect(resolveLlamaServer({ env: {}, fileExists: () => false, homedir: "/home/x" })).toBeNull();
  });
});

describe("buildIndexProbes", () => {
  const build = ({ present = [], commands = [] }) =>
    buildIndexProbes({
      context,
      env: {},
      homedir: "/home/x",
      commandExists: (name) => commands.includes(name),
      fileExists: (candidate) => present.includes(candidate),
    });

  it("blocks when the Python toolchain is missing", () => {
    const rows = build({});
    expect(levelOf(rows, "uv")).toBe("block");
    expect(levelOf(rows, "python env")).toBe("block");
    expect(hasBlockers(rows)).toBe(true);
  });

  it("warns rather than blocks on a missing captioner or GPU", () => {
    const rows = build({
      commands: ["uv"],
      present: [path.join(context.indexDir, ".venv")],
    });
    expect(levelOf(rows, "llama-server")).toBe("warn");
    expect(levelOf(rows, "gpu")).toBe("warn");
    expect(hasBlockers(rows)).toBe(false);
  });

  it("reports a fully ready toolchain", () => {
    const [llama] = defaultLlamaServerPaths("/home/x");
    const rows = build({
      commands: ["uv", "nvidia-smi"],
      present: [path.join(context.indexDir, ".venv"), llama],
    });
    expect(rows.every((row) => row.level === "ok")).toBe(true);
  });

  it("attaches a remediation hint to every failure", () => {
    for (const row of build({}).filter((candidate) => candidate.level !== "ok")) {
      expect(row.hint).toBeTruthy();
    }
  });
});

describe("buildSiteProbes", () => {
  const build = ({ present = [], albums = 0, nodeOk = true }) =>
    buildSiteProbes({
      context,
      nodeVersion: "26.5.0",
      checkNodeVersion: () => nodeOk,
      countAlbums: () => albums,
      fileExists: (candidate) => present.includes(candidate),
    });

  it("blocks on an unsupported Node version", () => {
    expect(levelOf(build({ nodeOk: false }), "node")).toBe("block");
  });

  // checkNodeVersion reports through callbacks and would otherwise call
  // process.exit; the probe must silence both and decide from the return value.
  it("silences the checker's own reporting and never lets it exit the process", () => {
    let reported = null;
    let exitCode = null;

    const rows = buildSiteProbes({
      context,
      nodeVersion: "18.0.0",
      fileExists: () => false,
      countAlbums: () => 0,
      checkNodeVersion: ({ reportError, exit }) => {
        reportError("Node 24 or 26 is required for this project.");
        exit(1);
        return false;
      },
    });

    expect(levelOf(rows, "node")).toBe("block");
    expect(reported).toBeNull();
    expect(exitCode).toBeNull();
  });

  it("warns when the albums directory is missing", () => {
    const rows = build({});
    expect(levelOf(rows, "albums")).toBe("warn");
    expect(rows.find((row) => row.label === "albums").value).toContain("missing");
  });

  it("warns when the albums directory exists but is empty", () => {
    expect(levelOf(build({ present: [context.albumsDir], albums: 0 }), "albums")).toBe("warn");
  });

  // A missing database must never block: the gallery, map and timeline all
  // build from EXIF alone.
  it("treats missing databases as warnings, not blockers", () => {
    const rows = build({ present: [context.albumsDir], albums: 3 });
    expect(levelOf(rows, "search index")).toBe("warn");
    expect(levelOf(rows, "embeddings")).toBe("warn");
    expect(hasBlockers(rows)).toBe(false);
  });

  it("reports a fully provisioned site", () => {
    const rows = build({
      present: [context.albumsDir, context.dbPath, context.embeddingsDbPath],
      albums: 12,
    });
    expect(rows.every((row) => row.level === "ok")).toBe(true);
  });
});

describe("formatProbeRows", () => {
  it("renders one line per row and indents hints beneath them", () => {
    const lines = formatProbeRows([
      { label: "uv", level: "ok", value: "found", hint: null },
      { label: "python env", level: "block", value: "missing", hint: "Run uv sync" },
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("found");
    expect(lines[2].trim()).toBe("Run uv sync");
  });
});

describe("formatIndexStats", () => {
  it("reports when nothing has been indexed yet", () => {
    expect(formatIndexStats(null)).toEqual(["  No previous indexing run recorded."]);
  });

  it("summarises a completed run", () => {
    const lines = formatIndexStats({
      completedAt: "2026-07-28T03:06:57Z",
      modelProfile: "hybrid",
      workItemCount: 42,
      coreFailures: 1,
      captionFailures: 2,
      embeddingFailures: 0,
    }).join("\n");

    expect(lines).toContain("2026-07-28T03:06:57Z");
    expect(lines).toContain("hybrid");
    expect(lines).toContain("42");
    expect(lines).toContain("Failures       3");
  });

  it("tolerates a stats file missing every optional field", () => {
    const lines = formatIndexStats({}).join("\n");
    expect(lines).toContain("unknown");
    expect(lines).toContain("Failures       0");
  });
});
