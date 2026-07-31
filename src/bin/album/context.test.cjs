/** @jest-environment node */

const path = require("node:path");
const { buildAlbumContext } = require("./context.cjs");

describe("buildAlbumContext", () => {
  const context = buildAlbumContext({ srcDir: path.join("/repo", "src") });

  it("derives the repo root from the app root", () => {
    expect(context.repoDir).toBe(path.resolve("/repo"));
  });

  it.each([
    ["albumsDir", path.join("/repo", "albums")],
    ["indexDir", path.join("/repo", "index")],
    ["lastIndexStatsPath", path.join("/repo", "index", ".last-index-stats.json")],
    ["dbPath", path.join("/repo", "src", "public", "search.sqlite")],
    ["embeddingsDbPath", path.join("/repo", "src", "public", "search-embeddings.sqlite")],
    ["packageJsonPath", path.join("/repo", "src", "package.json")],
    ["configPath", path.join("/repo", "src", "site.config.json")],
  ])("resolves %s", (key, expected) => {
    expect(context[key]).toBe(expected);
  });
});
