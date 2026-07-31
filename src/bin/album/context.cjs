const path = require("node:path");

/**
 * Every path the CLI needs, derived from the Next app root. Pure — no
 * filesystem access — so tests can pass a fake `srcDir` and assert on the
 * result without touching disk.
 *
 * Repo-level data (albums, the Python indexer) hangs off `repoDir`; app-level
 * artefacts hang off `srcDir`. This mirrors `buildWizardContext` in
 * publish-wizard-lib.cjs and adds the paths the CLI itself needs.
 */
const buildAlbumContext = ({ srcDir }) => {
  const repoDir = path.resolve(srcDir, "..");
  const indexDir = path.join(repoDir, "index");

  return {
    srcDir,
    repoDir,
    indexDir,
    albumsDir: path.join(repoDir, "albums"),
    lastIndexStatsPath: path.join(indexDir, ".last-index-stats.json"),
    dbPath: path.join(srcDir, "public", "search.sqlite"),
    embeddingsDbPath: path.join(srcDir, "public", "search-embeddings.sqlite"),
    packageJsonPath: path.join(srcDir, "package.json"),
    configPath: path.join(srcDir, "site.config.json"),
  };
};

module.exports = { buildAlbumContext };
