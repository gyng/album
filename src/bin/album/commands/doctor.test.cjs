/** @jest-environment node */

const doctor = require("./doctor.cjs");

const context = { albumsDir: "/repo/albums" };

const makeHarness = ({ site = [], indexing = [] } = {}) => ({
  services: {
    env: {},
    buildSiteProbes: jest.fn(() => site),
    buildIndexProbes: jest.fn(() => indexing),
  },
  log: jest.fn(),
  setExitCode: jest.fn(),
});

const run = async (args, harness) =>
  doctor.run({
    args: { indexing: false, ...args },
    context,
    services: harness.services,
    log: harness.log,
    setExitCode: harness.setExitCode,
  });

const ok = [{ label: "node", level: "ok", value: "v26.5.0", hint: null }];
const blocked = [{ label: "node", level: "block", value: "v18.0.0", hint: "Use Node 24" }];

describe("album doctor", () => {
  it("reports a healthy site and succeeds", async () => {
    const harness = makeHarness({ site: ok });
    await run({}, harness);

    expect(harness.log.mock.calls.flat().join("\n")).toContain("Ready.");
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("skips the indexing toolchain unless asked", async () => {
    const harness = makeHarness({ site: ok });
    await run({}, harness);

    expect(harness.services.buildIndexProbes).not.toHaveBeenCalled();
  });

  it("includes the indexing toolchain on request", async () => {
    const harness = makeHarness({ site: ok, indexing: ok });
    await run({ indexing: true }, harness);

    expect(harness.services.buildIndexProbes).toHaveBeenCalled();
    expect(harness.log.mock.calls.flat().join("\n")).toContain("Indexing toolchain:");
  });

  it("exits non-zero when the site itself is blocked", async () => {
    const harness = makeHarness({ site: blocked });
    await run({}, harness);

    expect(harness.setExitCode).toHaveBeenCalledWith(1);
    expect(harness.log.mock.calls.flat().join("\n")).not.toContain("Ready.");
  });

  it("exits non-zero when only the indexing toolchain is blocked", async () => {
    const harness = makeHarness({ site: ok, indexing: blocked });
    await run({ indexing: true }, harness);

    expect(harness.setExitCode).toHaveBeenCalledWith(1);
  });
});
