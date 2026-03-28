#!/usr/bin/env node

const path = require("path");
const {
  askYesNo,
  buildIndexVerification,
  buildWizardContext,
  createPreflightReport,
  loadDbState,
  parseArgs,
  printExecutionPlan,
  printPreflightReport,
  printVerificationReport,
  resolveExecutionPlan,
  runShellCommand,
  writeReport,
} = require("./publish-wizard-lib.cjs");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const context = buildWizardContext({ srcDir: path.resolve(__dirname, "..") });

  const report = await createPreflightReport({
    albumsDir: context.albumsDir,
    dbPath: context.dbPath,
    indexDir: context.indexDir,
    lastIndexStatsPath: context.lastIndexStatsPath,
  });
  writeReport(context.reportPath, report);
  printPreflightReport(report);

  if (args.json) {
    console.log(`\n${JSON.stringify(report, null, 2)}`);
  }

  const blockers = report.albums.flatMap((album) => album.blockers);
  if (blockers.length > 0 && !args.force) {
    console.error("\nPreflight blockers detected. Fix them or rerun with --force.");
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log(`\nDry run complete. Report written to ${context.reportPath}`);
    return;
  }

  const executionPlan = await resolveExecutionPlan({ args, report });
  printExecutionPlan({ args, report, plan: executionPlan });

  const hasIndexChanges = report.summary.newPhotos > 0 || report.summary.removedPhotos > 0 || report.db.missingEmbeddingCount > 0;
  if (hasIndexChanges) {
    if (!executionPlan.runIndex) {
      console.log("Skipping indexing by user choice.");
      return;
    }

    await runShellCommand({ command: "npm run index:update", cwd: context.srcDir });
  } else {
    console.log("\nNo new or removed photos detected. Skipping index update.");
  }

  const discoveredPhotoPaths = report.albums.flatMap((album) => album.photoPaths);
  const newPhotoPaths = report.albums.flatMap((album) => album.newPhotos.map((photo) => photo.path));
  const refreshedDbState = await loadDbState(context.dbPath);
  const verification = buildIndexVerification({
    discoveredPhotoPaths,
    newPhotoPaths,
    dbState: refreshedDbState,
  });

  const finalReport = {
    ...report,
    verification,
    completedAt: new Date().toISOString(),
  };
  writeReport(context.reportPath, finalReport);
  printVerificationReport(verification);

  if (args.json) {
    console.log(`\n${JSON.stringify(finalReport, null, 2)}`);
  }

  if (!verification.ok && !args.force) {
    console.error("\nIndex verification failed. Build/deploy stopped.");
    process.exitCode = 1;
    return;
  }

  if (args.indexOnly) {
    console.log(`\nIndex-only run complete. Report written to ${context.reportPath}`);
    return;
  }

  if (!args.fastTrack && !args.skipBuild) {
    executionPlan.runBuild = await askYesNo({
      prompt: "Build the site now?",
      defaultValue: true,
      yes: args.yes,
    });
  }

  if (!args.skipBuild) {
    if (!executionPlan.runBuild) {
      console.log(`\nStopping after successful index verification. Report written to ${context.reportPath}`);
      return;
    }

    if (!args.skipPull) {
      await runShellCommand({ command: "npx vercel@latest pull", cwd: context.srcDir });
    }
    await runShellCommand({ command: "npx vercel@latest build --prod", cwd: context.srcDir });
  }

  if (!args.fastTrack && !args.deploy && !args.skipBuild) {
    executionPlan.runDeploy = await askYesNo({
      prompt: "Deploy the prebuilt output now?",
      defaultValue: false,
      yes: args.yes,
    });
  }

  if (!executionPlan.runDeploy) {
    console.log(`\nBuild complete. Deployment skipped. Report written to ${context.reportPath}`);
    return;
  }

  await runShellCommand({
    command: "npx vercel@latest deploy --prebuilt --prod",
    cwd: context.srcDir,
  });

  console.log(`\nPublish wizard complete. Report written to ${context.reportPath}`);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
