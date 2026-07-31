// Spec-driven argument parsing shared by every `album` subcommand.
//
// Commands declare their flags once; both this parser and the help renderer in
// registry.cjs read that same declaration, so a flag cannot exist without
// documentation and documentation cannot describe a flag that was removed.
//
// Error phrasing deliberately matches the hand-rolled parsers in the sibling
// bin scripts ("Unknown argument: --wat", "Missing value for --out") so users
// see one dialect regardless of which layer catches the mistake.

const toKebabCase = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const buildLookup = (spec) => {
  const lookup = new Map();

  for (const [name, definition] of Object.entries(spec)) {
    lookup.set(`--${toKebabCase(name)}`, { name, definition });
    for (const alias of definition.aliases ?? []) {
      lookup.set(alias, { name, definition });
    }
  }

  return lookup;
};

const coerceValue = ({ definition, value, token }) => {
  if (definition.choices && !definition.choices.includes(value)) {
    throw new Error(
      `Invalid value for ${token}: ${value} (expected: ${definition.choices.join(", ")})`,
    );
  }

  return definition.type === "number" ? Number(value) : value;
};

const resolvePositional = ({ positional, value }) => {
  const resolved = value ?? positional.default;

  if (positional.choices && !positional.choices.includes(resolved)) {
    throw new Error(
      `Invalid ${positional.name}: ${resolved} (expected: ${positional.choices.join(", ")})`,
    );
  }

  return resolved;
};

const parseFlags = (command, argv) => {
  const spec = command.flags ?? {};
  const lookup = buildLookup(spec);
  const args = { help: false, rest: [] };

  for (const [name, definition] of Object.entries(spec)) {
    args[name] = definition.default;
  }

  let positionalValue = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    // Everything after a bare `--` is forwarded verbatim to the wrapped tool.
    if (token === "--") {
      args.rest = argv.slice(index + 1);
      break;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (!token.startsWith("-")) {
      if (!command.positional || positionalValue !== null) {
        throw new Error(`Unexpected argument: ${token}`);
      }
      positionalValue = token;
      continue;
    }

    const entry = lookup.get(token);
    if (!entry) {
      throw new Error(`Unknown argument: ${token}`);
    }

    if (entry.definition.type === "boolean") {
      args[entry.name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value === "") {
      throw new Error(`Missing value for ${token}`);
    }

    args[entry.name] = coerceValue({ definition: entry.definition, value, token });
    index += 1;
  }

  if (command.positional) {
    args[command.positional.name] = resolvePositional({
      positional: command.positional,
      value: positionalValue,
    });
  }

  return args;
};

module.exports = { parseFlags, toKebabCase };
