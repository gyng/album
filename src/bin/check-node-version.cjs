const supportedMajors = new Set([24, 26]);

const checkNodeVersion = ({
  nodeVersion = process.versions.node,
  displayVersion = process.version,
  reportError = (...messages) => console.error(...messages),
  exit = (code) => process.exit(code),
} = {}) => {
  const major = Number.parseInt(nodeVersion.split(".")[0], 10);

  if (supportedMajors.has(major)) {
    return true;
  }

  reportError(
    [
      "Node 24 or 26 is required for this project.",
      `Current version: ${displayVersion}`,
      "Run `nvm use` for the Node 24 default, or `nvm use 26`, then try again.",
    ].join("\n"),
  );
  exit(1);
  return false;
};

module.exports = { checkNodeVersion };

/* istanbul ignore next -- direct CLI dispatch; checkNodeVersion is tested independently */
if (require.main === module) {
  checkNodeVersion();
}
