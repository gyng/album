const { STEPS } = require("../scripts.cjs");

module.exports = {
  name: "generate",
  aliases: ["build"],
  summary: "Build the static site",
  usage: "album generate [options]",
  flags: {
    profile: {
      type: "boolean",
      default: false,
      description: "Emit build profiling output",
    },
  },
  positional: null,
  // Deliberately does not refresh the search index: generating is a fast,
  // offline step, while indexing is a GPU/Python job behind a lockfile.
  // `album doctor` reports when the index has fallen behind.
  run: async ({ args, context, services }) => {
    const step = args.profile ? STEPS.buildProfile : STEPS.build;
    await services.runShellCommand({ command: step.command, cwd: context[step.cwd] });
  },
};
