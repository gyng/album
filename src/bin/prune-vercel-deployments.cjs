// Vercel's retention policy protects three recent Hobby deployments. This
// gallery keeps only the live production output after a successful publish.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { siteConfig } = require("./siteConfig.cjs");

const deploymentUrl = (value) =>
  typeof value === "string" && /^[a-z0-9-]+\.vercel\.app$/i.test(value);

const pruneDeployments = ({ project, origin, run, log = console.log, dryRun = false }) => {
  if (!project.projectName || !project.orgId) throw new Error("Missing linked Vercel project.");
  const scope = ["--scope", project.orgId];
  const inspect = () => JSON.parse(run(["inspect", new URL(origin).hostname, "--json", ...scope]));
  const current = inspect();
  if (
    !/^dpl_\w+$/.test(current.id ?? "") ||
    !deploymentUrl(current.url) ||
    current.name !== project.projectName ||
    current.target !== "production" ||
    current.readyState !== "READY" ||
    !current.contextName
  ) {
    throw new Error("Cleanup requires a healthy live production deployment in the linked project.");
  }

  const list = () => {
    const deployments = [];
    const cursors = new Set();
    let next = null;
    do {
      const args = ["list", project.projectName, "--json", "--limit", "100"];
      if (next !== null) args.push("--next", String(next));
      const result = JSON.parse(run([...args, ...scope]));
      if (result.contextName !== current.contextName || !Array.isArray(result.deployments)) {
        throw new Error("Invalid deployment listing or Vercel team mismatch.");
      }
      for (const deployment of result.deployments) {
        if (
          deployment.name !== project.projectName ||
          !deploymentUrl(deployment.url) ||
          !["READY", "ERROR", "CANCELED"].includes(deployment.state)
        ) {
          throw new Error("Cleanup stopped: a deployment is active or its identity is invalid.");
        }
        deployments.push(deployment);
      }
      if (!result.pagination || !("next" in result.pagination)) {
        throw new Error("Deployment pagination is incomplete.");
      }
      next = result.pagination.next;
      if (next !== null) {
        if (!Number.isFinite(next) || cursors.has(next))
          throw new Error("Invalid deployment cursor.");
        cursors.add(next);
      }
    } while (next !== null);
    if (!deployments.some(({ url }) => url === current.url)) {
      throw new Error("The live deployment is missing from the project listing.");
    }
    return [...new Set(deployments.map(({ url }) => url))];
  };

  const candidates = list().filter((url) => url !== current.url);
  log(`Keeping live production deployment: ${current.url}`);
  if (dryRun) {
    for (const url of candidates) log(`Would remove: ${url}`);
    return { kept: current.url, removed: [] };
  }
  if (candidates.length === 0) return { kept: current.url, removed: [] };
  if (inspect().id !== current.id) throw new Error("Production changed during cleanup; stopping.");

  for (let start = 0; start < candidates.length; start += 50) {
    // --safe also protects aliases assigned after the production check.
    const output = run([
      "remove",
      ...candidates.slice(start, start + 50),
      "--safe",
      "--yes",
      ...scope,
    ]);
    if (output.trim()) log(output.trim());
  }
  if (list().some((url) => url !== current.url)) {
    throw new Error("Other deployments remain; active aliases may protect them from cleanup.");
  }
  log(`Removed ${candidates.length} superseded deployment(s).`);
  return { kept: current.url, removed: candidates };
};

module.exports = { pruneDeployments };

/* istanbul ignore next -- CLI adapter; deletion policy is tested above the process boundary */
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--dry-run")) throw new Error("Only --dry-run is supported.");
    const srcDir = path.resolve(__dirname, "..");
    const project = JSON.parse(fs.readFileSync(path.join(srcDir, ".vercel/project.json"), "utf8"));
    pruneDeployments({
      project,
      origin: siteConfig.site.origin,
      dryRun: args.includes("--dry-run"),
      run: (command) =>
        execFileSync("npx", ["--yes", "vercel@latest", ...command], {
          cwd: srcDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          timeout: 60000,
          maxBuffer: 16 * 1024 * 1024,
        }),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
