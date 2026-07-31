/** @jest-environment node */

const publish = require("./publish.cjs");

describe("album publish", () => {
  // The value of the adapter is that it reuses the wizard's own parser,
  // context and collaborators rather than restating them — so the assertion is
  // that each is threaded through untouched.
  it("delegates to the wizard with its own arguments, context and services", async () => {
    const wizardServices = { askYesNo: jest.fn() };
    const services = {
      runWizard: jest.fn(async () => {}),
      parseWizardArgs: jest.fn(() => ({ dryRun: true })),
      buildWizardContext: jest.fn(() => ({ srcDir: "/src", reportPath: "/src/.report.json" })),
      wizardServices,
    };
    const now = () => new Date("2026-07-31T00:00:00Z");
    const log = jest.fn();
    const error = jest.fn();
    const setExitCode = jest.fn();

    await publish.run({
      args: { rest: ["--dry-run"] },
      context: { srcDir: "/src" },
      services,
      now,
      log,
      error,
      setExitCode,
    });

    expect(services.parseWizardArgs).toHaveBeenCalledWith(["--dry-run"]);
    expect(services.buildWizardContext).toHaveBeenCalledWith({ srcDir: "/src" });
    expect(services.runWizard).toHaveBeenCalledWith({
      args: { dryRun: true },
      context: { srcDir: "/src", reportPath: "/src/.report.json" },
      services: wizardServices,
      now,
      log,
      error,
      setExitCode,
    });
  });

  it("passes no wizard arguments when none were forwarded", async () => {
    const services = {
      runWizard: jest.fn(async () => {}),
      parseWizardArgs: jest.fn(() => ({})),
      buildWizardContext: jest.fn(() => ({})),
      wizardServices: {},
    };

    await publish.run({
      args: { rest: [] },
      context: { srcDir: "/src" },
      services,
      now: () => new Date(0),
      log: jest.fn(),
      error: jest.fn(),
      setExitCode: jest.fn(),
    });

    expect(services.parseWizardArgs).toHaveBeenCalledWith([]);
  });
});
