// Command registry and help rendering for the `album` CLI.
//
// Help text is derived from the same `flags` declaration the parser reads
// (see flags.cjs), so the two cannot drift apart.

const { toKebabCase } = require("./flags.cjs");

const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version", "-v"]);

const buildRegistry = (modules) => {
  const commands = [];
  const seen = new Set();

  for (const command of modules) {
    for (const key of [command.name, ...(command.aliases ?? [])]) {
      if (seen.has(key)) {
        throw new Error(`Duplicate command name or alias: ${key}`);
      }
      seen.add(key);
    }
    commands.push(command);
  }

  return commands;
};

const findCommand = (commands, name) =>
  commands.find((command) => command.name === name || (command.aliases ?? []).includes(name)) ??
  null;

/**
 * Splits `album [global flags] <command> [command args]`. The first token that
 * is not a global flag becomes the command; everything after it belongs to the
 * command, so `album index retag -- --match kanto` reaches the wrapped tool.
 */
const parseInvocation = (argv) => {
  let wantsHelp = false;
  let wantsVersion = false;
  let commandName = null;
  let rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (HELP_FLAGS.has(token)) {
      wantsHelp = true;
      continue;
    }

    if (VERSION_FLAGS.has(token)) {
      wantsVersion = true;
      continue;
    }

    commandName = token;
    rest = argv.slice(index + 1);
    break;
  }

  return { commandName, rest, wantsHelp, wantsVersion };
};

const formatFlagLabel = (name, definition) => {
  const names = [`--${toKebabCase(name)}`, ...(definition.aliases ?? [])];
  const label = names.join(", ");
  return definition.type === "boolean" ? label : `${label} <${definition.type}>`;
};

const padRows = (rows) => {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  return rows.map((row) => `  ${row.label.padEnd(width)}  ${row.description}`);
};

const formatRootHelp = (commands) => {
  const rows = commands.map((command) => ({
    label: command.aliases?.length
      ? `${command.name} (${command.aliases.join(", ")})`
      : command.name,
    description: command.summary,
  }));

  return [
    "album — build, index and publish this photo gallery",
    "",
    "Usage: album <command> [options]",
    "",
    "Commands:",
    ...padRows(rows),
    "",
    "Run `album <command> --help` for command options.",
  ].join("\n");
};

const formatCommandHelp = (command) => {
  const rows = Object.entries(command.flags ?? {}).map(([name, definition]) => ({
    label: formatFlagLabel(name, definition),
    description: definition.description,
  }));

  rows.push({ label: "--help, -h", description: "Show this help" });

  const positionalLines = command.positional
    ? [
        "",
        `Arguments:`,
        ...padRows([
          {
            label: command.positional.name,
            description: command.positional.choices
              ? `One of: ${command.positional.choices.join(", ")} (default: ${command.positional.default})`
              : `Default: ${command.positional.default}`,
          },
        ]),
      ]
    : [];

  return [
    `album ${command.name} — ${command.summary}`,
    "",
    `Usage: ${command.usage}`,
    ...positionalLines,
    "",
    "Options:",
    ...padRows(rows),
  ].join("\n");
};

module.exports = {
  buildRegistry,
  findCommand,
  formatCommandHelp,
  formatRootHelp,
  parseInvocation,
};
