/** @jest-environment node */

const doctor = require("./doctor.cjs");

const context = { albumsDir: "/repo/albums" };

const makeHarness = ({ site = [], indexing = [], sidecars = [] } = {}) => ({
  services: {
    env: {},
    buildSiteProbes: jest.fn(() => site),
    buildIndexProbes: jest.fn(() => indexing),
    findZoneSidecars: jest.fn(() => sidecars),
    removeZoneSidecars: jest.fn((paths) => ({ removed: paths, failed: [] })),
  },
  log: jest.fn(),
  setExitCode: jest.fn(),
});

const run = async (args, harness) =>
  doctor.run({
    args: { indexing: false, fix: false, ...args },
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

  it("reports Zone.Identifier sidecars without removing them", async () => {
    const harness = makeHarness({ site: ok, sidecars: ["/repo/albums/a/p.jpg:Zone.Identifier"] });
    await run({}, harness);

    expect(harness.services.findZoneSidecars).toHaveBeenCalledWith("/repo/albums");
    expect(harness.services.removeZoneSidecars).not.toHaveBeenCalled();
    expect(harness.log.mock.calls.flat().join("\n")).toContain("album doctor --fix");
    expect(harness.setExitCode).not.toHaveBeenCalled();
  });

  it("removes sidecars with --fix", async () => {
    const sidecar = "/repo/albums/a/p.jpg:Zone.Identifier";
    const harness = makeHarness({ site: ok, sidecars: [sidecar] });
    await run({ fix: true }, harness);

    expect(harness.services.removeZoneSidecars).toHaveBeenCalledWith([sidecar]);
    expect(harness.log.mock.calls.flat().join("\n")).toContain(sidecar);
  });

  it("says nothing about sidecars when there are none", async () => {
    const harness = makeHarness({ site: ok });
    await run({ fix: true }, harness);

    expect(harness.services.removeZoneSidecars).not.toHaveBeenCalled();
    expect(harness.log.mock.calls.flat().join("\n")).not.toContain("Zone.Identifier");
  });
});
