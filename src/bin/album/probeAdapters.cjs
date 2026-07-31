// Real filesystem and subprocess adapters behind the probes in probes.cjs.
// Kept separate so the probe logic itself stays pure and testable.

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const fileExists = (candidate) => fs.existsSync(candidate);

/**
 * True when `name` resolves to an executable. Uses the platform's own lookup
 * rather than walking PATH, so shell builtins and shims behave as the user
 * expects.
 */
const commandExists = (name, spawnImpl = spawnSync) => {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnImpl(probe, [name], { stdio: "ignore" });
  return result.status === 0;
};

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

module.exports = { commandExists, fileExists, readJsonFile };
