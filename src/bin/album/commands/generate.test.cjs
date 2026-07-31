/** @jest-environment node */

const generate = require("./generate.cjs");

describe("album generate", () => {
  const run = async (args) => {
    const services = { runShellCommand: jest.fn(async () => {}) };
    await generate.run({ args, context: { srcDir: "/src" }, services });
    return services.runShellCommand;
  };

  it("builds the site from the app root", async () => {
    expect(await run({ profile: false })).toHaveBeenCalledWith({
      command: "npm run build",
      cwd: "/src",
    });
  });

  it("switches to the profiling build when asked", async () => {
    expect(await run({ profile: true })).toHaveBeenCalledWith({
      command: "npm run build:profile",
      cwd: "/src",
    });
  });
});
