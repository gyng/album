// Toolchain probes for the Python indexing pipeline.
//
// These exist so a missing toolchain is reported in one readable line before
// any long-running work starts, rather than surfacing as `Command failed (127)`
// after the fact — or, worse, as a CUDA OOM forty minutes into a GPU run.
//
// Every function here is pure given its injected collaborators; the real
// filesystem and subprocess adapters live in probeAdapters.cjs.

const os = require("node:os");
const path = require("node:path");
const { statusLabel } = require("../publish-wizard-lib.cjs");

const LLAMA_SERVER_ENV = "LLAMA_SERVER";

// Mirrors DEFAULT_LLAMA_SERVER_PATHS in index/index.py. A /tmp build silently
// disappears on reboot, so discovery deliberately avoids it.
const defaultLlamaServerPaths = (homedir) => [
  path.join(homedir, ".local", "opt", "llama.cpp", "build", "bin", "llama-server"),
  "/usr/local/bin/llama-server",
];

const resolveLlamaServer = ({ env, fileExists, homedir = os.homedir() }) => {
  const configured = env[LLAMA_SERVER_ENV];

  if (configured) {
    return fileExists(configured) ? configured : null;
  }

  return defaultLlamaServerPaths(homedir).find((candidate) => fileExists(candidate)) ?? null;
};

/**
 * Returns `{ label, level, value, hint }` rows describing whether the indexing
 * pipeline can run here. `block` means it certainly cannot; `warn` means it can
 * but slowly, or only on the rollback backend.
 */
const buildIndexProbes = ({ context, env, commandExists, fileExists, homedir }) => {
  const rows = [];

  const hasUv = commandExists("uv");
  rows.push({
    label: "uv",
    level: hasUv ? "ok" : "block",
    value: hasUv ? "found" : "not on PATH",
    hint: hasUv ? null : "Install uv: https://docs.astral.sh/uv/getting-started/installation/",
  });

  const venvPath = path.join(context.indexDir, ".venv");
  const hasVenv = fileExists(venvPath);
  rows.push({
    label: "python env",
    level: hasVenv ? "ok" : "block",
    value: hasVenv ? venvPath : "missing",
    hint: hasVenv ? null : "Run `uv sync --extra inference` in index/",
  });

  const llamaServer = resolveLlamaServer({ env, fileExists, homedir });
  rows.push({
    label: "llama-server",
    level: llamaServer ? "ok" : "warn",
    value: llamaServer ?? "not found",
    hint: llamaServer
      ? null
      : "Default captioner needs it; fall back with `--classifier-backend janus`",
  });

  const hasGpu = commandExists("nvidia-smi");
  rows.push({
    label: "gpu",
    level: hasGpu ? "ok" : "warn",
    value: hasGpu ? "nvidia-smi found" : "no nvidia-smi",
    hint: hasGpu ? null : "Captioning and embeddings will be very slow without a GPU",
  });

  return rows;
};

/**
 * Readiness of the site build itself, as opposed to the indexing pipeline.
 * A missing search database is a `warn`, not a blocker: the gallery, map,
 * timeline and album pages all build without one.
 */
const buildSiteProbes = ({ context, fileExists, countAlbums, checkNodeVersion, nodeVersion }) => {
  const rows = [];

  const nodeOk = checkNodeVersion({
    nodeVersion,
    displayVersion: `v${nodeVersion}`,
    reportError: () => {},
    exit: () => {},
  });
  rows.push({
    label: "node",
    level: nodeOk ? "ok" : "block",
    value: `v${nodeVersion}`,
    hint: nodeOk ? null : "Node 24 or 26 is required; run `nvm use`",
  });

  const albumCount = fileExists(context.albumsDir) ? countAlbums(context.albumsDir) : null;
  rows.push({
    label: "albums",
    level: albumCount ? "ok" : "warn",
    value: albumCount === null ? `missing (${context.albumsDir})` : `${albumCount} found`,
    hint: albumCount ? null : `Add album folders under ${context.albumsDir}`,
  });

  const hasDb = fileExists(context.dbPath);
  rows.push({
    label: "search index",
    level: hasDb ? "ok" : "warn",
    value: hasDb ? context.dbPath : "not built",
    hint: hasDb ? null : "Search stays unavailable until `album index` runs",
  });

  const hasEmbeddings = fileExists(context.embeddingsDbPath);
  rows.push({
    label: "embeddings",
    level: hasEmbeddings ? "ok" : "warn",
    value: hasEmbeddings ? context.embeddingsDbPath : "not built",
    hint: hasEmbeddings ? null : "Semantic and similarity search need this database",
  });

  return rows;
};

const hasBlockers = (rows) => rows.some((row) => row.level === "block");

/** Renders probe rows as lines for an injected logger; never prints directly. */
const formatProbeRows = (rows) => {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);

  return rows.flatMap((row) => {
    const line = `  ${statusLabel(row.level)} ${row.label.padEnd(width)}  ${row.value}`;
    return row.hint ? [line, `      ${row.hint}`] : [line];
  });
};

/** Summarises the last indexing run for `album index status`. */
const formatIndexStats = (stats) => {
  if (!stats) {
    return ["  No previous indexing run recorded."];
  }

  const failures =
    (stats.coreFailures ?? 0) + (stats.captionFailures ?? 0) + (stats.embeddingFailures ?? 0);

  return [
    `  Completed at   ${stats.completedAt ?? "unknown"}`,
    `  Model profile  ${stats.modelProfile ?? "unknown"}`,
    `  Work items     ${stats.workItemCount ?? 0}`,
    `  Failures       ${failures}`,
  ];
};

module.exports = {
  LLAMA_SERVER_ENV,
  buildIndexProbes,
  buildSiteProbes,
  defaultLlamaServerPaths,
  formatIndexStats,
  formatProbeRows,
  hasBlockers,
  resolveLlamaServer,
};
