/** @jest-environment node */

const { main } = require("./album.cjs");

const context = {
  srcDir: "/src",
  repoDir: "/repo",
  packageJsonPath: "/src/package.json",
};

const makeCommand = (overrides = {}) => ({
  name: "generate",
  aliases: ["build"],
  summary: "Build the static site",
  usage: "album generate [options]",
  flags: { profile: { type: "boolean", default: false, description: "Profile it" } },
  positional: null,
  run: jest.fn(async () => {}),
  ...overrides,
});

const makeHarness = ({ argv = [], commands } = {}) => {
  const generate = makeCommand();
  const dev = makeCommand({ name: "dev", aliases: [], summary: "Dev server", flags: {} });
  const services = {
    readVersion: jest.fn(() => "9.9.9"),
    runShellCommand: jest.fn(async () => {}),
  };
  const log = jest.fn();
  const error = jest.fn();
  const setExitCode = jest.fn();

  return {
    generate,
    dev,
    services,
    log,
    error,
    setExitCode,
    input: {
      argv,
      context,
      commands: commands ?? [generate, dev],
      services,
      now: () => new Date("2026-07-29T00:00:00Z"),
      log,
      error,
      setExitCode,
    },
  };
};

const output = (spy) => spy.mock.calls.map((call) => call[0]).join("\n");

describe("album dispatcher", () => {
  it("prints root help and succeeds when given no command", async () => {
    const harness = makeHarness();
    await main(harness.input);

    expect(output(harness.log)).toContain("Usage: album <command> [options]");
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("prints root help for a global --help", async () => {
    const harness = makeHarness({ argv: ["--help"] });
    await main(harness.input);

    expect(output(harness.log)).toContain("Commands:");
  });

  it("prints the version without running a command", async () => {
    const harness = makeHarness({ argv: ["--version"] });
    await main(harness.input);

    expect(harness.services.readVersion).toHaveBeenCalledWith("/src/package.json");
    expect(harness.log).toHaveBeenCalledWith("9.9.9");
    expect(harness.generate.run).not.toHaveBeenCalled();
  });

  it("routes to a command by name", async () => {
    const harness = makeHarness({ argv: ["generate"] });
    await main(harness.input);

    expect(harness.generate.run).toHaveBeenCalledTimes(1);
    expect(harness.dev.run).not.toHaveBeenCalled();
  });

  it("routes to a command by alias", async () => {
    const harness = makeHarness({ argv: ["build"] });
    await main(harness.input);

    expect(harness.generate.run).toHaveBeenCalledTimes(1);
  });

  it("hands the command its parsed arguments and the injected collaborators", async () => {
    const harness = makeHarness({ argv: ["generate", "--profile"] });
    await main(harness.input);

    const call = harness.generate.run.mock.calls[0][0];
    expect(call.args).toMatchObject({ profile: true });
    expect(call.context).toBe(context);
    expect(call.services).toBe(harness.services);
    expect(call.log).toBe(harness.log);
    expect(call.error).toBe(harness.error);
    expect(call.setExitCode).toBe(harness.setExitCode);
  });

  it("reports an unknown command and exits non-zero", async () => {
    const harness = makeHarness({ argv: ["genrate"] });
    await main(harness.input);

    expect(output(harness.error)).toContain("Unknown command: genrate");
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.generate.run).not.toHaveBeenCalled();
  });

  it("reports a bad flag with a usage hint and exits non-zero", async () => {
    const harness = makeHarness({ argv: ["generate", "--wat"] });
    await main(harness.input);

    const printed = output(harness.error);
    expect(printed).toContain("Unknown argument: --wat");
    expect(printed).toContain("Run `album generate --help` for usage.");
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.generate.run).not.toHaveBeenCalled();
  });

  it("reports a non-Error parse failure", async () => {
    const harness = makeHarness({ argv: ["boom"] });
    const boom = makeCommand({ name: "boom", aliases: [] });
    // Defined after construction so the spread in makeCommand does not trigger it.
    Object.defineProperty(boom, "flags", {
      get() {
        throw "string failure";
      },
    });
    harness.input.commands = [boom];
    await main(harness.input);

    expect(output(harness.error)).toContain("string failure");
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });

  it("prints command help for a global --help before the command name", async () => {
    const harness = makeHarness({ argv: ["--help", "generate"] });
    await main(harness.input);

    expect(output(harness.log)).toContain("album generate — Build the static site");
    expect(harness.generate.run).not.toHaveBeenCalled();
  });

  it("prints command help for a trailing --help without running it", async () => {
    const harness = makeHarness({ argv: ["generate", "--help"] });
    await main(harness.input);

    expect(output(harness.log)).toContain("Usage: album generate [options]");
    expect(harness.generate.run).not.toHaveBeenCalled();
  });

  it("propagates a failure thrown by the command", async () => {
    const harness = makeHarness({ argv: ["generate"] });
    harness.generate.run.mockRejectedValue(new Error("build failed"));

    await expect(main(harness.input)).rejects.toThrow("build failed");
  });
});
