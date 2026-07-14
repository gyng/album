/**
 * @jest-environment node
 */

const { checkNodeVersion } = require("./check-node-version.cjs");

describe("Node version check", () => {
  it.each(["24.0.0", "26.3.1"])("accepts supported Node %s", (nodeVersion) => {
    expect(checkNodeVersion({ nodeVersion })).toBe(true);
  });

  it("reports the current version and exits for unsupported releases", () => {
    const reportError = jest.fn();
    const exit = jest.fn();

    expect(
      checkNodeVersion({
        nodeVersion: "22.18.0",
        displayVersion: "v22.18.0",
        reportError,
        exit,
      }),
    ).toBe(false);
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("Current version: v22.18.0"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uses the running process defaults", () => {
    expect(checkNodeVersion()).toBe(true);
  });
});
