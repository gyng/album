/** @jest-environment node */

const { defaultTargets, resolveTarget } = require("./registry.cjs");

describe("resolveTarget", () => {
  it("resolves the built-in Vercel target", () => {
    expect(resolveTarget({ name: "vercel" }).name).toBe("vercel");
  });

  it("resolves against an injected target list", () => {
    const fake = { name: "netlify" };
    expect(resolveTarget({ name: "netlify", targets: [fake] })).toBe(fake);
  });

  it("names the available targets when one is unknown", () => {
    expect(() => resolveTarget({ name: "s3" })).toThrow(
      "Unknown deploy target: s3 (available: vercel)",
    );
  });

  it("ships exactly one target today", () => {
    expect(defaultTargets.map((target) => target.name)).toEqual(["vercel"]);
  });
});
