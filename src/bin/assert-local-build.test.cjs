const { isVercelBuildContainer, run } = require("./assert-local-build.cjs");

describe("isVercelBuildContainer", () => {
  it("recognises the build container by the directory it clones into", () => {
    expect(isVercelBuildContainer("/vercel/path0")).toBe(true);
    expect(isVercelBuildContainer("/vercel/path0/src")).toBe(true);
  });

  it("leaves an ordinary checkout alone, including one that merely mentions vercel", () => {
    expect(isVercelBuildContainer("/home/g/p/a/src")).toBe(false);
    expect(isVercelBuildContainer("/home/g/vercel/album")).toBe(false);
    expect(isVercelBuildContainer("/vercelish/path0")).toBe(false);
  });
});

describe("run", () => {
  it("passes locally, saying nothing", () => {
    const error = jest.fn();
    expect(run("/home/g/p/a/src", error)).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("defaults to this process's own directory and console", () => {
    expect(run()).toBe(0);
  });

  it("fails in the build container and says how to deploy instead", () => {
    const error = jest.fn();
    expect(run("/vercel/path0/src", error)).toBe(1);
    expect(error.mock.calls[0][0]).toContain("./album deploy");
  });
});
