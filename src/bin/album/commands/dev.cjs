const { STEPS } = require("../scripts.cjs");

module.exports = {
  name: "dev",
  aliases: [],
  summary: "Run the development server",
  usage: "album dev",
  flags: {},
  positional: null,
  // `npm run dev` carries a `predev` chain (image, poster, icon and vendor
  // preparation) plus the libvips tuning, so it is the whole command.
  run: async ({ context, services }) => {
    const step = STEPS.dev;
    await services.runShellCommand({ command: step.command, cwd: context[step.cwd] });
  },
};
