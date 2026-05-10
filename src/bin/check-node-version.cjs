const requiredMajor = 24;
const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (major !== requiredMajor) {
  console.error(
    [
      `Node ${requiredMajor} is required for this project.`,
      `Current version: ${process.version}`,
      "Run `nvm use` from the repo root, then try `npm run dev` again.",
    ].join("\n"),
  );
  process.exit(1);
}
