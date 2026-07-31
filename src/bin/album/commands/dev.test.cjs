/** @jest-environment node */

const dev = require("./dev.cjs");

describe("album dev", () => {
  it("runs the dev server from the app root", async () => {
    const services = { runShellCommand: jest.fn(async () => {}) };
    await dev.run({ args: {}, context: { srcDir: "/src" }, services });

    expect(services.runShellCommand).toHaveBeenCalledWith({
      command: "npm run dev",
      cwd: "/src",
    });
  });
});
