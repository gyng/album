const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const getGitSha = (cwd = path.resolve(appRoot, "..")) => {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const createBuildManifest = (options = {}) => {
  const builtAt = options.builtAt ?? new Date().toISOString();
  const gitSha =
    options.gitSha ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    getGitSha(options.gitCwd);
  const commitShortSha = gitSha ? gitSha.slice(0, 12) : null;
  const buildVersion =
    options.buildVersion ??
    process.env.NEXT_PUBLIC_BUILD_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    `${builtAt}${commitShortSha ? `-${commitShortSha}` : ""}`;

  return {
    buildVersion,
    builtAt,
    gitSha,
  };
};

const writeBuildManifest = (options = {}) => {
  const targetAppRoot = options.appRoot ?? appRoot;
  const publicDir = path.join(targetAppRoot, "public");
  const libDir = path.join(targetAppRoot, "lib");
  const versionJsonPath = path.join(publicDir, "version.json");
  const buildVersionModulePath = path.join(libDir, "buildVersion.ts");
  const manifest = createBuildManifest(options);

  ensureDir(publicDir);
  ensureDir(libDir);

  fs.writeFileSync(versionJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    buildVersionModulePath,
    [
      `export const BUILD_VERSION = ${JSON.stringify(manifest.buildVersion)};`,
      `export const BUILD_METADATA = ${JSON.stringify(manifest, null, 2)} as const;`,
      "",
    ].join("\n"),
  );

  return {
    manifest,
    versionJsonPath,
    buildVersionModulePath,
  };
};

module.exports = {
  createBuildManifest,
  writeBuildManifest,
};

if (require.main === module) {
  const { manifest } = writeBuildManifest();
  console.log(`Wrote build manifest ${manifest.buildVersion}`);
}
