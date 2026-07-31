// Wires the real adapters into the service object `main` receives.
//
// Kept out of album.cjs so these bindings are exercised by a test rather than
// living inside the istanbul-ignored dispatch block.

const fs = require("node:fs");
const os = require("node:os");
const { checkNodeVersion } = require("../check-node-version.cjs");
const wizard = require("../publish-wizard.cjs");
const wizardLib = require("../publish-wizard-lib.cjs");
const { askYesNo, createPreflightReport, printPreflightReport, runShellCommand } = wizardLib;

// The exact collaborator set publish-wizard.cjs injects when run directly.
const wizardServices = {
  askYesNo: wizardLib.askYesNo,
  buildIndexVerification: wizardLib.buildIndexVerification,
  createPreflightReport: wizardLib.createPreflightReport,
  getVercelPreflightCommand: wizardLib.getVercelPreflightCommand,
  hasIndexChanges: wizardLib.hasIndexChanges,
  loadDbState: wizardLib.loadDbState,
  printExecutionPlan: wizardLib.printExecutionPlan,
  printPreflightReport: wizardLib.printPreflightReport,
  printVerificationReport: wizardLib.printVerificationReport,
  resolveExecutionPlan: wizardLib.resolveExecutionPlan,
  runShellCommand: wizardLib.runShellCommand,
  writeReport: wizardLib.writeReport,
};
const { askText } = require("./prompt.cjs");
const { defaultTargets } = require("./targets/registry.cjs");
const { readVersion } = require("./pkg.cjs");
const { commandExists, fileExists, readJsonFile } = require("./probeAdapters.cjs");
const { buildIndexProbes, buildSiteProbes } = require("./probes.cjs");

const countAlbums = (albumsDir) =>
  fs.readdirSync(albumsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;

const writeFile = (filePath, contents) => fs.writeFileSync(filePath, contents);

const buildDefaultServices = () => ({
  env: process.env,
  askText,
  askYesNo,
  writeFile,
  createPreflightReport,
  printPreflightReport,
  readJsonFile,
  readVersion,
  runShellCommand,
  targets: defaultTargets,
  runWizard: wizard.main,
  parseWizardArgs: wizardLib.parseArgs,
  buildWizardContext: wizardLib.buildWizardContext,
  wizardServices,
  buildIndexProbes: ({ context, env }) =>
    buildIndexProbes({ context, env, commandExists, fileExists, homedir: os.homedir() }),
  buildSiteProbes: ({ context }) =>
    buildSiteProbes({
      context,
      fileExists,
      countAlbums,
      checkNodeVersion,
      nodeVersion: process.versions.node,
    }),
});

module.exports = { buildDefaultServices, countAlbums, writeFile };
