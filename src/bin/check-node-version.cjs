const supportedMajors = new Set([24, 26]);
const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (!supportedMajors.has(major)) {
  console.error(
    [
      "Node 24 or 26 is required for this project.",
      `Current version: ${process.version}`,
      "Run `nvm use` for the Node 24 default, or `nvm use 26`, then try again.",
    ].join("\n"),
  );
  process.exit(1);
}
