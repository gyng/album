// Runs the build's prepare steps as parallel lanes instead of one long chain.
// Run one after another they took about nine seconds of a thirty-second warm
// build; most of them neither read nor write anything another step touches.
const { spawn } = require("node:child_process");

/**
 * Each lane runs in order; lanes run side by side. A step shares a lane with
 * every step whose output it reads:
 * - the embedding atlas packs the 800px variants of photographs (images) and
 *   video posters (posters), and the image step's cache cleanup walks the same
 *   directories the posters write into;
 * - map styles read the photographs' palette from the search database, which
 *   search framing writes — a read during that write would find it locked and
 *   quietly fall back to the default palette;
 * - the typecheck imports lib/buildVersion.ts, which the build manifest writes
 *   and git ignores, so on a fresh checkout it does not exist until that step
 *   has run.
 */
const BUILD_PREPARE_LANES = [
  ["prepare:images", "prepare:posters", "prepare:embedding-atlas"],
  ["prepare:build-manifest", "typecheck"],
  ["prepare:search-framing", "prepare:map-styles"],
  ["prepare:feeds", "prepare:pwa-icons", "prepare:vendor-maplibre"],
];

/**
 * Runs the lanes concurrently. After a failure no further step starts, steps
 * already running are told to stop through the signal, and the first failure
 * is rethrown once every lane has settled.
 */
const runLanes = async (lanes, runStep) => {
  const controller = new AbortController();
  let failure = null;
  await Promise.all(
    lanes.map(async (lane) => {
      for (const step of lane) {
        if (failure) return;
        try {
          await runStep(step, controller.signal);
        } catch (error) {
          failure ??= error;
          controller.abort();
          return;
        }
      }
    }),
  );
  if (failure) throw failure;
};

/** One npm script, its output streamed line by line under its own name. */
const runNpmScript = (step, signal) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn("npm", ["run", "--silent", step], {
      cwd: __dirname + "/..",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const prefix = (stream, target) => {
      let pending = "";
      stream.on("data", (chunk) => {
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) target.write(`[${step}] ${line}\n`);
      });
      stream.on("end", () => {
        if (pending) target.write(`[${step}] ${pending}\n`);
      });
    };
    prefix(child.stdout, process.stdout);
    prefix(child.stderr, process.stderr);
    const stop = () => child.kill("SIGTERM");
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", reject);
    child.on("close", (code, killedBy) => {
      signal.removeEventListener("abort", stop);
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        process.stdout.write(`[${step}] done in ${seconds}s\n`);
        resolve();
      } else {
        reject(
          new Error(`${step} ${killedBy ? `stopped (${killedBy})` : `failed (exit ${code})`}`),
        );
      }
    });
  });

if (require.main === module) {
  const startedAt = Date.now();
  runLanes(BUILD_PREPARE_LANES, runNpmScript)
    .then(() => {
      console.log(`Build prepared in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { BUILD_PREPARE_LANES, runLanes };
