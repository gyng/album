#!/usr/bin/env node

// `album` — the front door to this gallery's build, index and publish tooling.
//
// This file is orchestration only: every side effect arrives through an
// injected parameter, so `main` is testable without a filesystem or a shell.
// The granular npm scripts remain the implementation layer beneath it.

const path = require("node:path");
const { buildAlbumContext } = require("./album/context.cjs");
const { parseFlags } = require("./album/flags.cjs");
const {
  buildRegistry,
  findCommand,
  formatCommandHelp,
  formatRootHelp,
  parseInvocation,
} = require("./album/registry.cjs");
const { buildDefaultServices } = require("./album/services.cjs");

// Explicit `.cjs` extensions throughout: Node's directory-index resolution does
// not consider `index.cjs`, and the sibling bin scripts require this way too.
const defaultCommands = buildRegistry([
  require("./album/commands/init.cjs"),
  require("./album/commands/doctor.cjs"),
  require("./album/commands/dev.cjs"),
  require("./album/commands/generate.cjs"),
  require("./album/commands/index.cjs"),
  require("./album/commands/deploy.cjs"),
  require("./album/commands/publish.cjs"),
]);

const main = async ({ argv, context, commands, services, now, log, error, setExitCode }) => {
  const { commandName, rest, wantsHelp, wantsVersion } = parseInvocation(argv);

  if (wantsVersion) {
    log(services.readVersion(context.packageJsonPath));
    return;
  }

  if (!commandName) {
    log(formatRootHelp(commands));
    return;
  }

  const command = findCommand(commands, commandName);
  if (!command) {
    error(`Unknown command: ${commandName}`);
    error("\nRun `album --help` to see available commands.");
    setExitCode(1);
    return;
  }

  if (wantsHelp) {
    log(formatCommandHelp(command));
    return;
  }

  let args;
  try {
    args = parseFlags(command, rest);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    error(`\nRun \`album ${command.name} --help\` for usage.`);
    setExitCode(1);
    return;
  }

  if (args.help) {
    log(formatCommandHelp(command));
    return;
  }

  await command.run({ args, context, services, now, log, error, setExitCode });
};

module.exports = { main };

/* istanbul ignore next -- direct CLI dispatch; orchestration is tested through main */
if (require.main === module) {
  main({
    argv: process.argv.slice(2),
    context: buildAlbumContext({ srcDir: path.resolve(__dirname, "..") }),
    commands: defaultCommands,
    services: buildDefaultServices(),
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
