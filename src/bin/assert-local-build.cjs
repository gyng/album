// Fails a build that is running on Vercel rather than here.
//
// This gallery deploys prebuilt — `album deploy` runs `vercel build` locally
// and uploads the output — so a build in Vercel's container means someone
// reached for plain `vercel deploy` by mistake. Left alone it fails anyway,
// slowly and cryptically: sqlite3 ships a prebuilt binary linked against
// GLIBC 2.38, the build image has an older libm, and the first thing to load
// it is page-data collection for /album/[[...slug]], minutes in.

/** Vercel clones the repository into /vercel/path0 and builds from there. */
const isVercelBuildContainer = (cwd) => cwd === "/vercel" || cwd.startsWith("/vercel/");

const MESSAGE = [
  "",
  "  This gallery is deployed prebuilt, not built on Vercel.",
  "",
  "    ./album deploy        builds here and uploads with --prebuilt",
  "",
  "  Building in the container fails regardless: sqlite3's prebuilt binary",
  "  needs GLIBC 2.38, which the build image does not have, so collecting",
  "  page data for /album/[[...slug]] dies partway through.",
  "",
].join("\n");

const run = (cwd = process.cwd(), error = console.error) => {
  if (!isVercelBuildContainer(cwd)) {
    return 0;
  }

  error(MESSAGE);
  return 1;
};

module.exports = { isVercelBuildContainer, run };

/* istanbul ignore next -- direct CLI dispatch; run is tested independently */
if (require.main === module) {
  process.exit(run());
}
