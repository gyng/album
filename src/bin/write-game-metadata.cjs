// Stamp the prebuilt output immediately before upload, including when reusing
// an older build. Its version.json identifies that build, not this checkout.
const fs = require("node:fs");
const path = require("node:path");

const writeGameMetadata = ({
  staticDir = path.resolve(__dirname, "../.vercel/output/static"),
  now = new Date(),
} = {}) => {
  const build = JSON.parse(fs.readFileSync(path.join(staticDir, "version.json"), "utf8"));
  const metadata = {
    schemaVersion: 1,
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...(typeof build.buildVersion === "string" && build.buildVersion.trim()
      ? { version: build.buildVersion }
      : {}),
    ...(/^[0-9a-f]{40}$/i.test(build.gitSha ?? "") ? { commit: build.gitSha } : {}),
  };
  const directory = path.join(staticDir, "fun");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "meta.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
};

module.exports = { writeGameMetadata };

/* istanbul ignore next -- CLI adapter */
if (require.main === module) {
  const metadata = writeGameMetadata();
  console.log(`Wrote game metadata for deployment at ${metadata.updatedAt}`);
}
