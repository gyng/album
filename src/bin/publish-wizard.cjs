#!/usr/bin/env node

const path = require("path");
const {
  askYesNo,
  buildIndexVerification,
  buildWizardContext,
  createPreflightReport,
  getVercelPreflightCommand,
  hasIndexChanges,
  loadDbState,
  parseArgs,
  printExecutionPlan,
  printPreflightReport,
  printVerificationReport,
  resolveExecutionPlan,
  runShellCommand,
  writeReport,
} = require("./publish-wizard-lib.cjs");

const defaultServices = {
  askYesNo,
  buildIndexVerification,
  createPreflightReport,
  getVercelPreflightCommand,
  hasIndexChanges,
  loadDbState,
  printExecutionPlan,
  printPreflightReport,
  printVerificationReport,
  resolveExecutionPlan,
  runShellCommand,
  writeReport,
};

const main = async ({ args, context, services, now, log, error, setExitCode }) => {
  const report = await services.createPreflightReport({
    albumsDir: context.albumsDir,
    dbPath: context.dbPath,
    embeddingsDbPath: context.embeddingsDbPath,
    indexDir: context.indexDir,
    lastIndexStatsPath: context.lastIndexStatsPath,
    repoDir: context.repoDir,
  });
  services.writeReport(context.reportPath, report);
  services.printPreflightReport(report);

  if (args.json) {
    log(`\n${JSON.stringify(report, null, 2)}`);
  }

  const blockers = report.albums.flatMap((album) => album.blockers);
  if (blockers.length > 0 && !args.force) {
    error("\nPreflight blockers detected. Fix them or rerun with --force.");
    setExitCode(1);
    return;
  }

  if (args.dryRun) {
    log(`\nDry run complete. Report written to ${context.reportPath}`);
    return;
  }

  const executionPlan = await services.resolveExecutionPlan({ args, report });
  services.printExecutionPlan({ args, report, plan: executionPlan });

  const vercelPreflightCommand = services.getVercelPreflightCommand({
    args,
    plan: executionPlan,
  });
  if (vercelPreflightCommand) {
    await services.runShellCommand({
      command: vercelPreflightCommand,
      cwd: context.srcDir,
    });
  }

  if (services.hasIndexChanges(report)) {
    if (!executionPlan.runIndex) {
      log("Skipping indexing by user choice.");
      return;
    }

    await services.runShellCommand({ command: "npm run index:update", cwd: context.srcDir });
  } else {
    log("\nNo new or removed photos detected. Skipping index update.");
  }

  const discoveredPhotoPaths = report.albums.flatMap((album) => album.photoPaths);
  const newPhotoPaths = report.albums.flatMap((album) =>
    album.newPhotos.map((photo) => photo.path),
  );
  const refreshedDbState = await services.loadDbState(context.dbPath, context.embeddingsDbPath);
  const verification = services.buildIndexVerification({
    discoveredPhotoPaths,
    newPhotoPaths,
    dbState: refreshedDbState,
  });

  const finalReport = {
    ...report,
    verification,
    completedAt: now().toISOString(),
  };
  services.writeReport(context.reportPath, finalReport);
  services.printVerificationReport(verification);

  if (args.json) {
    log(`\n${JSON.stringify(finalReport, null, 2)}`);
  }

  if (!verification.ok && !args.force) {
    error("\nIndex verification failed. Build/deploy stopped.");
    setExitCode(1);
    return;
  }

  if (args.indexOnly) {
    log(`\nIndex-only run complete. Report written to ${context.reportPath}`);
    return;
  }

  if (!args.fastTrack && !args.skipBuild) {
    executionPlan.runBuild = await services.askYesNo({
      prompt: "Build the site now?",
      defaultValue: true,
      yes: args.yes,
    });
  }

  if (!args.skipBuild) {
    if (!executionPlan.runBuild) {
      log(
        `\nStopping after successful index verification. Report written to ${context.reportPath}`,
      );
      return;
    }

    if (!args.skipPull) {
      await services.runShellCommand({
        command: "npx --yes vercel@latest pull",
        cwd: context.srcDir,
      });
    }
    await services.runShellCommand({
      command: "npx --yes vercel@latest build --prod",
      cwd: context.srcDir,
    });
  }

  if (!args.fastTrack && !args.deploy && !args.skipBuild) {
    executionPlan.runDeploy = await services.askYesNo({
      prompt: "Deploy the prebuilt output now?",
      defaultValue: false,
      yes: args.yes,
    });
  }

  if (!executionPlan.runDeploy) {
    log(`\nBuild complete. Deployment skipped. Report written to ${context.reportPath}`);
    return;
  }

  await services.runShellCommand({
    command: "npx --yes vercel@latest deploy --prebuilt --prod",
    cwd: context.srcDir,
  });

  log(`\nPublish wizard complete. Report written to ${context.reportPath}`);
};

module.exports = { main };

/* istanbul ignore next -- direct CLI dispatch; orchestration is tested through main */
if (require.main === module) {
  main({
    args: parseArgs(process.argv.slice(2)),
    context: buildWizardContext({ srcDir: path.resolve(__dirname, "..") }),
    services: defaultServices,
    now: () => new Date(),
    log: console.log,
    error: console.error,
    setExitCode: (code) => {
      process.exitCode = code;
    },
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
