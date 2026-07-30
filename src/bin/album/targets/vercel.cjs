// The only deploy target today. Both functions are pure — they return data and
// run nothing — so `album deploy --dry-run` falls out for free and the command
// is testable without mocking a shell.

const VERCEL_CLI = "npx --yes vercel@latest";

module.exports = {
  name: "vercel",
  summary: "Vercel prebuilt deployment",

  /**
   * Cheap credential check, run before any long step so an expired login fails
   * in seconds rather than after a full build.
   */
  preflightCommand: () => `${VERCEL_CLI} whoami`,

  planSteps: ({ args, context }) => {
    const steps = [];

    // Pulling only matters when a build follows it.
    if (!args.skipPull && !args.skipBuild) {
      steps.push({ label: "pull", command: `${VERCEL_CLI} pull`, cwd: context.srcDir });
    }

    if (!args.skipBuild) {
      steps.push({ label: "build", command: `${VERCEL_CLI} build --prod`, cwd: context.srcDir });
    }

    const archive = args.archive ? " --archive=tgz" : "";
    steps.push({
      label: "deploy",
      command: `${VERCEL_CLI} deploy --prebuilt --prod${archive}`,
      cwd: context.srcDir,
    });

    return steps;
  },
};
