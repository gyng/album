const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const publicDir = path.join(appRoot, "public");
const libDir = path.join(appRoot, "lib");
const versionJsonPath = path.join(publicDir, "version.json");
const buildVersionModulePath = path.join(libDir, "buildVersion.ts");

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const getGitSha = () => {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: path.resolve(appRoot, ".."),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const builtAt = new Date().toISOString();
const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || getGitSha();
const commitShortSha = gitSha ? gitSha.slice(0, 12) : null;
const buildVersion =
  process.env.NEXT_PUBLIC_BUILD_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  `${builtAt}${commitShortSha ? `-${commitShortSha}` : ""}`;

const manifest = {
  buildVersion,
  builtAt,
  gitSha,
};

ensureDir(publicDir);
ensureDir(libDir);

fs.writeFileSync(versionJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);

fs.writeFileSync(
  buildVersionModulePath,
  [
    `export const BUILD_VERSION = ${JSON.stringify(buildVersion)};`,
    `export const BUILD_METADATA = ${JSON.stringify(manifest, null, 2)} as const;`,
    "",
  ].join("\n"),
);

console.log(`Wrote build manifest ${buildVersion}`);
