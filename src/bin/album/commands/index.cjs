const { STEPS } = require("../scripts.cjs");
const { formatIndexStats, formatProbeRows, hasBlockers } = require("../probes.cjs");

// Multi-stage modes delegate to the shell scripts in index/, which own the
// staging swap and the flock on /tmp/photo-gallery-index-workflow.lock. The CLI
// must not reimplement that lock — a second concurrent run corrupts the staging
// database.
const SCRIPT_MODES = {
  full: STEPS.indexFull,
  embeddings: STEPS.indexEmbeddings,
  retag: STEPS.indexRetag,
};

// Single-stage modes pass straight through to the Python CLI.
const PASSTHROUGH_MODES = new Set(["validate", "prune", "publish"]);

const MODES = ["full", "embeddings", "retag", "status", "validate", "prune", "publish"];

const runStatus = ({ context, services, log }) => {
  log("\nLast indexing run:");
  for (const line of formatIndexStats(services.readJsonFile(context.lastIndexStatsPath))) {
    log(line);
  }
};

module.exports = {
  name: "index",
  aliases: [],
  summary: "Build or refresh the search index",
  usage: "album index [mode] [options] [-- <python args>]",
  flags: {
    check: {
      type: "boolean",
      default: false,
      description: "Report toolchain readiness and stop",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Run even when a toolchain probe reports a blocker",
    },
  },
  positional: { name: "mode", default: "full", choices: MODES },
  run: async ({ args, context, services, log, error, setExitCode }) => {
    // `status` reads a JSON file the previous run left behind: no Python, no
    // toolchain, so it stays useful on a machine that cannot index at all.
    if (args.mode === "status") {
      runStatus({ context, services, log });
      return;
    }

    const probes = services.buildIndexProbes({ context, env: services.env });
    log("\nIndexing toolchain:");
    for (const line of formatProbeRows(probes)) {
      log(line);
    }

    if (args.check) {
      return;
    }

    if (hasBlockers(probes) && !args.force) {
      error("\nThe indexing toolchain is not ready. Fix the blockers above or rerun with --force.");
      setExitCode(1);
      return;
    }

    if (PASSTHROUGH_MODES.has(args.mode)) {
      const extra = args.rest.length > 0 ? ` ${args.rest.join(" ")}` : "";
      await services.runShellCommand({
        command: `uv run python index.py ${args.mode}${extra}`,
        cwd: context.indexDir,
      });
      return;
    }

    const step = SCRIPT_MODES[args.mode];
    const extra = args.rest.length > 0 ? ` -- ${args.rest.join(" ")}` : "";
    await services.runShellCommand({
      command: `${step.command}${extra}`,
      cwd: context[step.cwd],
    });
  },
};
