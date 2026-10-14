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
    fix: {
      type: "boolean",
      default: false,
      description: "Remove Windows Zone.Identifier sidecars from the albums",
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

    // Name-only walk, no EXIF: cheap enough to keep doctor fast.
    const sidecars = services.findZoneSidecars(context.albumsDir);
    if (sidecars.length > 0 && args.fix) {
      const { removed, failed } = services.removeZoneSidecars(sidecars);
      log(`\nRemoved ${removed.length} Zone.Identifier sidecar file(s):`);
      for (const file of removed) log(`  ${file}`);
      for (const { file, message } of failed) log(`  could not remove ${file}: ${message}`);
    } else if (sidecars.length > 0) {
      log(
        `\n${sidecars.length} Zone.Identifier sidecar file(s) in the albums; the build ignores them. Remove with: album doctor --fix`,
      );
    }

    if (hasBlockers([...rows, ...indexRows])) {
      setExitCode(1);
      return;
    }

    log("\nReady.");
  },
};
