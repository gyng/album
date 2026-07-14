/** @jest-environment node */

describe("SimilarTrailBar server module", () => {
  it("selects a server-safe effect implementation", () => {
    jest.isolateModules(() => {
      const loadedModule = require("./SimilarTrailBar") as typeof import("./SimilarTrailBar");
      expect(loadedModule.SimilarTrailBar).toEqual(expect.any(Function));
    });
  });
});
