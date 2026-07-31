const { formatProbeRows, hasBlockers } = require("../probes.cjs");

module.exports = {
  name: "doctor",
  aliases: [],
  summary: "Check whether this machine can build and index the gallery",
  usage: "album doctor [options]",
  flags: {
    indexing: {
      type: "boolean",
      default: false,
      description: "Also check the Python indexing toolchain",
    },
  },
  positional: null,
  // Deliberately fast: presence checks only, no EXIF walk over the photo
  // library. The album-by-album analysis belongs to `album deploy`, which needs
  // it to decide whether publishing is safe.
  run: async ({ args, context, services, log, setExitCode }) => {
    const rows = services.buildSiteProbes({ context });

    log("\nSite:");
    for (const line of formatProbeRows(rows)) {
      log(line);
    }

    const indexRows = args.indexing
      ? services.buildIndexProbes({ context, env: services.env })
      : [];
    if (args.indexing) {
      log("\nIndexing toolchain:");
      for (const line of formatProbeRows(indexRows)) {
        log(line);
      }
    }

    if (hasBlockers([...rows, ...indexRows])) {
      setExitCode(1);
      return;
    }

    log("\nReady.");
  },
};
