/** @jest-environment node */

describe("SimilarTrailBar server module", () => {
  it("can be imported without accessing browser globals", () => {
    jest.isolateModules(() => {
      const loadedModule = require("./SimilarTrailBar") as typeof import("./SimilarTrailBar");
      expect(typeof loadedModule.SimilarTrailBar).toBe("function");
    });
  });
});
