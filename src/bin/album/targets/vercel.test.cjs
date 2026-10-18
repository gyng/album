/** @jest-environment node */

const vercel = require("./vercel.cjs");

const context = { srcDir: "/src" };

const plan = (args) =>
  vercel
    .planSteps({
      args: { skipPull: false, skipBuild: false, archive: false, ...args },
      context,
    })
    .map((step) => step.label);

describe("vercel target", () => {
  it("plans pull, build and deploy by default", () => {
    expect(plan({})).toEqual(["pull", "build", "deploy"]);
  });

  it("drops the pull step when asked", () => {
    expect(plan({ skipPull: true })).toEqual(["build", "deploy"]);
  });

  it("drops pull along with build, since pulling only serves a build", () => {
    expect(plan({ skipBuild: true })).toEqual(["deploy"]);
  });

  it("runs every step from the app root", () => {
    const steps = vercel.planSteps({
      args: { skipPull: false, skipBuild: false, archive: false },
      context,
    });
    expect(steps.every((step) => step.cwd === "/src")).toBe(true);
  });

  it("adds the archive flag only to the deploy step", () => {
    const steps = vercel.planSteps({
      args: { skipPull: false, skipBuild: false, archive: true },
      context,
    });
    const deploy = steps.find((step) => step.label === "deploy");

    expect(deploy.command).toContain("--archive=tgz");
    expect(steps.find((step) => step.label === "build").command).not.toContain("--archive");
  });

  it.each([false, true])(
    "stamps metadata before uploading, including skipBuild=%s",
    (skipBuild) => {
      const steps = vercel.planSteps({ args: { skipBuild }, context });
      expect(steps.find((step) => step.label === "deploy").command).toBe(
        "node ./bin/write-game-metadata.cjs && npx --yes vercel@latest deploy --prebuilt --prod",
      );
    },
  );

  it("checks credentials before any long step", () => {
    expect(vercel.preflightCommand({ args: {}, context })).toContain("whoami");
  });
});
