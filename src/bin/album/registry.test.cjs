/** @jest-environment node */

const {
  buildRegistry,
  findCommand,
  formatCommandHelp,
  formatRootHelp,
  parseInvocation,
} = require("./registry.cjs");

const alpha = { name: "alpha", aliases: ["a"], summary: "First command", usage: "album alpha" };
const beta = { name: "beta", summary: "Second command", usage: "album beta" };

describe("buildRegistry", () => {
  it("keeps the registered commands", () => {
    expect(buildRegistry([alpha, beta])).toEqual([alpha, beta]);
  });

  it.each([
    [[alpha, { name: "alpha", summary: "dupe" }], "Duplicate command name or alias: alpha"],
    [
      [alpha, { name: "gamma", aliases: ["a"], summary: "dupe" }],
      "Duplicate command name or alias: a",
    ],
  ])("rejects a duplicate registration", (modules, message) => {
    expect(() => buildRegistry(modules)).toThrow(message);
  });
});

describe("findCommand", () => {
  const commands = [alpha, beta];

  it("resolves by name", () => {
    expect(findCommand(commands, "beta")).toBe(beta);
  });

  it("resolves by alias", () => {
    expect(findCommand(commands, "a")).toBe(alpha);
  });

  it("returns null when nothing matches", () => {
    expect(findCommand(commands, "missing")).toBeNull();
  });
});

describe("parseInvocation", () => {
  it("reports no command for empty argv", () => {
    expect(parseInvocation([])).toEqual({
      commandName: null,
      rest: [],
      wantsHelp: false,
      wantsVersion: false,
    });
  });

  it.each([["--help"], ["-h"]])("recognises the global %s", (token) => {
    expect(parseInvocation([token]).wantsHelp).toBe(true);
  });

  it.each([["--version"], ["-v"]])("recognises the global %s", (token) => {
    expect(parseInvocation([token]).wantsVersion).toBe(true);
  });

  it("splits the command from its own arguments", () => {
    expect(parseInvocation(["generate", "--profile"])).toMatchObject({
      commandName: "generate",
      rest: ["--profile"],
    });
  });

  it("leaves a command's own --help to the command", () => {
    expect(parseInvocation(["generate", "--help"])).toMatchObject({
      commandName: "generate",
      rest: ["--help"],
      wantsHelp: false,
    });
  });

  it("accepts a global flag before the command name", () => {
    expect(parseInvocation(["--help", "generate"])).toMatchObject({
      commandName: "generate",
      wantsHelp: true,
    });
  });
});

describe("help rendering", () => {
  it("lists every registered command, showing aliases", () => {
    const help = formatRootHelp([alpha, beta]);
    expect(help).toContain("alpha (a)");
    expect(help).toContain("beta");
    expect(help).toContain("First command");
  });

  it("omits the alias suffix for a command declaring an empty alias list", () => {
    const help = formatRootHelp([{ name: "dev", aliases: [], summary: "Dev server" }]);
    expect(help).toContain("dev");
    expect(help).not.toContain("dev (");
  });

  // The anti-drift contract: help is generated from the same `flags` object the
  // parser reads, so every declared flag must appear.
  it("documents every declared flag, with its type and aliases", () => {
    const help = formatCommandHelp({
      name: "deploy",
      summary: "Ship it",
      usage: "album deploy [options]",
      flags: {
        dryRun: { type: "boolean", default: false, description: "Print the plan" },
        target: { type: "string", default: null, description: "Where to ship", aliases: ["-t"] },
      },
    });

    expect(help).toContain("--dry-run");
    expect(help).toContain("--target, -t <string>");
    expect(help).toContain("Print the plan");
    expect(help).toContain("--help, -h");
  });

  it("still offers --help for a command declaring no flags", () => {
    const help = formatCommandHelp({ name: "dev", summary: "Dev server", usage: "album dev" });
    expect(help).toContain("--help, -h");
  });

  it("documents a positional argument and its choices", () => {
    const help = formatCommandHelp({
      name: "index",
      summary: "Index photos",
      usage: "album index [mode]",
      flags: {},
      positional: { name: "mode", default: "full", choices: ["full", "embeddings"] },
    });

    expect(help).toContain("Arguments:");
    expect(help).toContain("One of: full, embeddings (default: full)");
  });

  it("documents a positional with no choice list", () => {
    const help = formatCommandHelp({
      name: "album",
      summary: "Show an album",
      usage: "album album [slug]",
      flags: {},
      positional: { name: "slug", default: "all" },
    });

    expect(help).toContain("Default: all");
  });
});
