const { resolveTarget } = require("../targets/registry.cjs");

module.exports = {
  name: "deploy",
  aliases: [],
  summary: "Preflight, build and deploy the gallery",
  usage: "album deploy [options]",
  flags: {
    target: {
      type: "string",
      default: "vercel",
      description: "Deploy target",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Print the deploy plan and stop",
    },
    skipPreflight: {
      type: "boolean",
      default: false,
      description: "Skip the album and index checks",
    },
    skipPull: {
      type: "boolean",
      default: false,
      description: "Skip pulling remote project settings",
    },
    skipBuild: {
      type: "boolean",
      default: false,
      description: "Deploy the existing build output",
    },
    archive: {
      type: "boolean",
      default: false,
      description: "Upload as an archive, for file-count limits",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Deploy despite preflight blockers",
    },
  },
  positional: null,
  run: async ({ args, context, services, log, error, setExitCode }) => {
    let target;
    try {
      target = resolveTarget({ name: args.target, targets: services.targets });
    } catch (err) {
      error(err.message);
      setExitCode(1);
      return;
    }

    if (!args.skipPreflight) {
      const report = await services.createPreflightReport({
        albumsDir: context.albumsDir,
        dbPath: context.dbPath,
        embeddingsDbPath: context.embeddingsDbPath,
        indexDir: context.indexDir,
        lastIndexStatsPath: context.lastIndexStatsPath,
        repoDir: context.repoDir,
      });
      services.printPreflightReport(report);

      const blockers = report.albums.flatMap((album) => album.blockers);
      if (blockers.length > 0 && !args.force) {
        error("\nPreflight blockers detected. Fix them or rerun with --force.");
        setExitCode(1);
        return;
      }
    }

    const steps = target.planSteps({ args, context });

    if (args.dryRun) {
      log(`\nDeploy plan (${target.name}):`);
      for (const step of steps) {
        log(`  ${step.label}: ${step.command}`);
      }
      return;
    }

    const preflightCommand = target.preflightCommand({ args, context });
    if (preflightCommand) {
      await services.runShellCommand({ command: preflightCommand, cwd: context.srcDir });
    }

    for (const step of steps) {
      await services.runShellCommand({ command: step.command, cwd: step.cwd });
    }

    log(`\nDeploy complete (${target.name}).`);
  },
};
