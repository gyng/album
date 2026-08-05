// Chooses a port the e2e suite can actually listen on.
//
// The suite refuses to start when its port is taken, and the ways that happens
// have nothing to do with this project: another project's dev server, a
// leftover server from the previous run that has not finished letting go, or —
// under WSL — a *Windows* process holding the same number, which localhost
// forwarding turns into an EADDRINUSE that `ss` inside the distro cannot even
// see. None of those are worth a failed run, so a taken port becomes a
// different port rather than a stopped suite.
//
// Synchronous on purpose: a Playwright config is evaluated as CommonJS, so it
// cannot await anything. One short child process per run is the price.

const { execFileSync } = require("node:child_process");

/**
 * Binds the preferred port in a child process, falling back to whatever the
 * kernel hands out for port 0, and prints the port it got.
 */
const PROBE = `
const net = require("node:net");
const bind = (port) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      const chosen = server.address().port;
      server.close(() => resolve(chosen));
    });
  });

bind(Number(process.argv[1]))
  .catch(() => bind(0))
  .then(
    (port) => process.stdout.write(String(port)),
    () => process.exit(1),
  );
`;

/** @param {number} preferred @returns {string} the port the probe settled on */
const probeWithNode = (preferred) =>
  execFileSync(process.execPath, ["-e", PROBE, String(preferred)], {
    encoding: "utf8",
    timeout: 10_000,
  });

/**
 * @param {number} preferred the port to use if it is free.
 * @param {(preferred: number) => string} [probe] injected for tests.
 * @returns {number} `preferred` when it is free, another free port when it is
 *   not, and `preferred` again when the probe itself fails — a broken probe must
 *   not stop the suite from trying.
 */
const pickFreePort = (preferred, probe = probeWithNode) => {
  try {
    const port = Number.parseInt(probe(preferred), 10);
    return Number.isInteger(port) && port > 0 ? port : preferred;
  } catch {
    return preferred;
  }
};

module.exports = { pickFreePort };
