// The publish wizard's `main` already takes exactly the shape a command's `run`
// receives, so this is an adapter rather than a reimplementation: the same
// preflight, execution plan and verification loop, reached as `album publish`.
//
// The wizard keeps its own argument parser, because its flags are its own
// contract and its existing tests assert them. Everything after `--` is
// forwarded verbatim, so `album publish -- --dry-run` behaves as before.

module.exports = {
  name: "publish",
  aliases: [],
  summary: "Run the interactive publish wizard",
  usage: "album publish [-- <wizard args>]",
  flags: {},
  positional: null,
  run: async ({ args, context, services, now, log, error, setExitCode }) => {
    await services.runWizard({
      args: services.parseWizardArgs(args.rest),
      context: services.buildWizardContext({ srcDir: context.srcDir }),
      services: services.wizardServices,
      now,
      log,
      error,
      setExitCode,
    });
  },
};
