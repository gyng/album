#!/usr/bin/env node

const { existsSync } = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const cwd = path.resolve(__dirname, "..");
const buildIdPath = path.join(cwd, ".next", "BUILD_ID");

if (!existsSync(buildIdPath)) {
  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
}

const child = spawn("npm", ["start"], {
  cwd,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

