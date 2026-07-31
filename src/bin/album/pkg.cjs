const fs = require("node:fs");

/** Reads the CLI's own version out of package.json for `album --version`. */
const readVersion = (packageJsonPath) =>
  JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;

module.exports = { readVersion };
