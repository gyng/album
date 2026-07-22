const { main } = require("./publish-wizard.cjs");

const baseArgs = {
  dryRun: false,
  fastTrack: true,
  yes: false,
  json: false,
  indexOnly: false,
  deploy: false,
  force: false,
  skipPull: false,
  skipBuild: false,
};

const context = {
  albumsDir: "/albums",
  dbPath: "/search.sqlite",
  embeddingsDbPath: "/embeddings.sqlite",
  indexDir: "/index",
  lastIndexStatsPath: "/stats.json",
  repoDir: "/repo",
  reportPath: "/report.json",
  srcDir: "/src",
};

const makeReport = ({ blockers = [], indexChanges = true } = {}) => ({
  albums: [
    {
      blockers,
      photoPaths: ["../albums/trip/old.jpg", "../albums/trip/new.jpg"],
      newPhotos: [{ path: "../albums/trip/new.jpg" }],
    },
  ],
  summary: {
    newPhotos: indexChanges ? 1 : 0,
    removedPhotos: 0,
  },
  db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0 },
});

const makeHarness = ({
  args = {},
  report = makeReport(),
  plan = { runIndex: true, runBuild: true, runDeploy: false },
  verification = { ok: true },
  preflightCommand = null,
  answers = [],
} = {}) => {
  const services = {
    askYesNo: jest.fn(),
    buildIndexVerification: jest.fn(() => verification),
    createPreflightReport: jest.fn(async () => report),
    getVercelPreflightCommand: jest.fn(() => preflightCommand),
    hasIndexChanges: jest.fn(() => report.summary.newPhotos > 0),
    loadDbState: jest.fn(async () => ({ indexedPhotoPaths: new Set() })),
    printExecutionPlan: jest.fn(),
    printPreflightReport: jest.fn(),
    printVerificationReport: jest.fn(),
    resolveExecutionPlan: jest.fn(async () => ({ ...plan })),
    runShellCommand: jest.fn(async () => {}),
    writeReport: jest.fn(),
  };
  services.askYesNo.mockImplementation(async () => answers.shift() ?? false);

  const log = jest.fn();
  const error = jest.fn();
  const setExitCode = jest.fn();
  const input = {
    args: { ...baseArgs, ...args },
    context,
    services,
    now: () => new Date("2026-07-14T12:00:00Z"),
    log,
    error,
    setExitCode,
  };

  return { input, services, log, error, setExitCode, report };
};

describe("publish wizard orchestration", () => {
  it("prints JSON and stops on preflight blockers", async () => {
    const harness = makeHarness({
      args: { json: true },
      report: makeReport({ blockers: ["broken album"] }),
    });

    await main(harness.input);

    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining('"broken album"'));
    expect(harness.error).toHaveBeenCalledWith(expect.stringContaining("Preflight blockers"));
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.services.resolveExecutionPlan).not.toHaveBeenCalled();
  });

  it("allows a forced dry run with blockers", async () => {
    const harness = makeHarness({
      args: { dryRun: true, force: true },
      report: makeReport({ blockers: ["broken album"] }),
    });

    await main(harness.input);

    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("Dry run complete"));
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("runs a preflight command and honours the choice to skip indexing", async () => {
    const harness = makeHarness({
      plan: { runIndex: false, runBuild: true, runDeploy: false },
      preflightCommand: "vercel whoami",
    });

    await main(harness.input);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "vercel whoami",
      cwd: "/src",
    });
    expect(harness.log).toHaveBeenCalledWith("Skipping indexing by user choice.");
    expect(harness.services.loadDbState).not.toHaveBeenCalled();
  });

  it("asks a second confirmation and continues when model info is unavailable and the user declines then accepts", async () => {
    const harness = makeHarness({
      report: {
        ...makeReport(),
        db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0, modelInfoUnavailable: true },
      },
      plan: { runIndex: false, runBuild: true, runDeploy: false },
      answers: [true],
    });

    await main(harness.input);

    expect(harness.log).toHaveBeenCalledWith("Skipping indexing by user choice.");
    expect(harness.services.askYesNo).toHaveBeenCalledWith({
      prompt: "Proceed with build and deploy without index verification?",
      defaultValue: false,
      yes: false,
    });
    expect(harness.services.runShellCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm run index:update" }),
    );
    expect(harness.error).toHaveBeenCalledWith(expect.stringContaining("index state is unknown"));
    expect(harness.services.loadDbState).toHaveBeenCalled();
    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npx --yes vercel@latest build --prod",
      cwd: "/src",
    });
  });

  it("asks a second confirmation and exits when model info is unavailable and the user declines twice", async () => {
    const harness = makeHarness({
      report: {
        ...makeReport(),
        db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0, modelInfoUnavailable: true },
      },
      plan: { runIndex: false, runBuild: true, runDeploy: false },
      answers: [false],
    });

    await main(harness.input);

    expect(harness.log).toHaveBeenCalledWith("Skipping indexing by user choice.");
    expect(harness.services.askYesNo).toHaveBeenCalledWith({
      prompt: "Proceed with build and deploy without index verification?",
      defaultValue: false,
      yes: false,
    });
    expect(harness.services.runShellCommand).not.toHaveBeenCalled();
    expect(harness.services.loadDbState).not.toHaveBeenCalled();
  });

  it("--yes skips index:update on unknown model info without prompting, and continues with a warning", async () => {
    const harness = makeHarness({
      args: { yes: true },
      report: {
        ...makeReport(),
        db: { missingEmbeddingCount: 0, staleEmbeddingCount: 0, modelInfoUnavailable: true },
      },
      plan: { runIndex: false, runBuild: true, runDeploy: false },
    });

    await main(harness.input);

    expect(harness.services.askYesNo).not.toHaveBeenCalled();
    expect(harness.services.runShellCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm run index:update" }),
    );
    expect(harness.error).toHaveBeenCalledWith(expect.stringContaining("index state is unknown"));
    expect(harness.services.loadDbState).toHaveBeenCalled();
    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npx --yes vercel@latest build --prod",
      cwd: "/src",
    });
  });

  it("skips an unnecessary index and reports a failed verification", async () => {
    const harness = makeHarness({
      args: { json: true },
      report: makeReport({ indexChanges: false }),
      verification: { ok: false, missingPhotoPaths: ["missing.jpg"] },
    });

    await main(harness.input);

    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("No new or removed"));
    expect(harness.services.buildIndexVerification).toHaveBeenCalledWith({
      discoveredPhotoPaths: ["../albums/trip/old.jpg", "../albums/trip/new.jpg"],
      newPhotoPaths: ["../albums/trip/new.jpg"],
      dbState: { indexedPhotoPaths: new Set() },
    });
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining('"completedAt"'));
    expect(harness.error).toHaveBeenCalledWith(expect.stringContaining("verification failed"));
    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });

  it("finishes an index-only run after indexing and verification", async () => {
    const harness = makeHarness({ args: { indexOnly: true } });

    await main(harness.input);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npm run index:update",
      cwd: "/src",
    });
    expect(harness.services.writeReport).toHaveBeenLastCalledWith(
      "/report.json",
      expect.objectContaining({ completedAt: "2026-07-14T12:00:00.000Z" }),
    );
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("Index-only run complete"));
  });

  it("stops when an interactive user declines the build", async () => {
    const harness = makeHarness({
      args: { fastTrack: false },
      answers: [false],
    });

    await main(harness.input);

    expect(harness.services.askYesNo).toHaveBeenCalledWith({
      prompt: "Build the site now?",
      defaultValue: true,
      yes: false,
    });
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("Stopping after successful"));
  });

  it("pulls, builds, and lets an interactive user skip deployment", async () => {
    const harness = makeHarness({
      args: { fastTrack: false },
      answers: [true, false],
    });

    await main(harness.input);

    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npx --yes vercel@latest pull",
      cwd: "/src",
    });
    expect(harness.services.runShellCommand).toHaveBeenCalledWith({
      command: "npx --yes vercel@latest build --prod",
      cwd: "/src",
    });
    expect(harness.services.askYesNo).toHaveBeenLastCalledWith({
      prompt: "Deploy the prebuilt output now?",
      defaultValue: false,
      yes: false,
    });
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("Deployment skipped"));
  });

  it("can force past verification, skip pulling, build, and deploy", async () => {
    const harness = makeHarness({
      args: { force: true, skipPull: true },
      plan: { runIndex: true, runBuild: true, runDeploy: true },
      verification: { ok: false },
    });

    await main(harness.input);

    expect(harness.services.runShellCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.stringContaining(" pull") }),
    );
    expect(harness.services.runShellCommand).toHaveBeenLastCalledWith({
      command: "npx --yes vercel@latest deploy --prebuilt --prod",
      cwd: "/src",
    });
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("Publish wizard complete"));
  });

  it("can deploy explicitly while the build is skipped", async () => {
    const harness = makeHarness({
      args: { deploy: true, skipBuild: true },
      plan: { runIndex: true, runBuild: false, runDeploy: true },
    });

    await main(harness.input);

    expect(harness.services.askYesNo).not.toHaveBeenCalled();
    expect(harness.services.runShellCommand).toHaveBeenLastCalledWith({
      command: "npx --yes vercel@latest deploy --prebuilt --prod",
      cwd: "/src",
    });
  });
});
