/** @jest-environment node */

const { pruneDeployments } = require("./prune-vercel-deployments.cjs");

const project = { projectName: "gallery", orgId: "team_gallery" };
const current = {
  id: "dpl_current",
  name: "gallery",
  url: "gallery-current.vercel.app",
  target: "production",
  readyState: "READY",
  contextName: "gallery-team",
};
const row = (url, state = "READY") => ({ url, name: "gallery", state });
const page = (deployments, next = null) => ({
  contextName: "gallery-team",
  deployments,
  pagination: { next },
});

const harness = ({
  pages,
  live = current,
  refreshed = live,
  afterRemoval = [row(current.url)],
} = {}) => {
  const remaining = [...(pages ?? [page([row(current.url), row("gallery-old.vercel.app")])])];
  let inspected = false;
  let removed = false;
  const run = jest.fn((args) => {
    if (args[0] === "inspect") {
      const deployment = inspected ? refreshed : live;
      inspected = true;
      return JSON.stringify(deployment);
    }
    if (args[0] === "list") return JSON.stringify(removed ? page(afterRemoval) : remaining.shift());
    if (args[0] === "remove") {
      removed = true;
      return "Removed old deployments";
    }
    throw new Error(`Unexpected command: ${args[0]}`);
  });
  const execute = (extra = {}) =>
    pruneDeployments({
      project,
      origin: "https://photos.example.com",
      run,
      log: jest.fn(),
      ...extra,
    });
  const removals = () =>
    run.mock.calls.map(([args]) => args).filter(([command]) => command === "remove");
  return { run, execute, removals };
};

describe("keep the live Vercel deployment", () => {
  it("removes superseded output in the linked team using active-alias protection", () => {
    const h = harness();
    expect(h.execute()).toEqual({ kept: current.url, removed: ["gallery-old.vercel.app"] });
    expect(h.removals()).toEqual([
      ["remove", "gallery-old.vercel.app", "--safe", "--yes", "--scope", project.orgId],
    ]);
    expect(
      h.run.mock.calls.every(([args]) => args.slice(-2).join(" ") === `--scope ${project.orgId}`),
    ).toBe(true);
  });

  it("collects every page before deleting and includes failed and cancelled deployments", () => {
    const h = harness({
      pages: [
        page([row(current.url), row("gallery-failed.vercel.app", "ERROR")], 123),
        page([row("gallery-cancelled.vercel.app", "CANCELED")]),
      ],
    });
    expect(h.execute().removed).toEqual([
      "gallery-failed.vercel.app",
      "gallery-cancelled.vercel.app",
    ]);
    expect(h.run).toHaveBeenCalledWith(expect.arrayContaining(["--next", "123"]));
  });

  it("keeps the live deployment even when a newer unaliased deployment exists", () => {
    const h = harness({ pages: [page([row("gallery-newer.vercel.app"), row(current.url)])] });
    expect(h.execute().removed).toEqual(["gallery-newer.vercel.app"]);
  });

  it("makes no deletion requests in a dry run", () => {
    const h = harness();
    h.execute({ dryRun: true });
    expect(h.removals()).toEqual([]);
  });

  it("does nothing when only the live deployment remains", () => {
    const h = harness({ pages: [page([row(current.url)])] });
    expect(h.execute().removed).toEqual([]);
    expect(h.removals()).toEqual([]);
  });

  it.each([
    { readyState: "ERROR" },
    { target: "preview" },
    { name: "another-project" },
    { id: null },
  ])("refuses cleanup without a healthy production deployment: %j", (overrides) => {
    const h = harness({ live: { ...current, ...overrides } });
    expect(() => h.execute()).toThrow();
    expect(h.removals()).toEqual([]);
  });

  it.each([
    page([row("gallery-old.vercel.app")]),
    { ...page([row(current.url)]), contextName: "another-team" },
    page([row(current.url), { ...row("gallery-old.vercel.app"), name: "another-project" }]),
    page([row(current.url), row("--all")]),
    page([row(current.url), row("gallery-pending.vercel.app", "BUILDING")]),
  ])("refuses incomplete, mismatched or active deployment listings", (listing) => {
    const h = harness({ pages: [listing] });
    expect(() => h.execute()).toThrow();
    expect(h.removals()).toEqual([]);
  });

  it("stops if production changes during the listing", () => {
    const h = harness({ refreshed: { ...current, id: "dpl_replacement" } });
    expect(() => h.execute()).toThrow(/changed/);
    expect(h.removals()).toEqual([]);
  });

  it("does not delete a partial listing when pagination fails", () => {
    const h = harness({ pages: [page([row(current.url), row("gallery-old.vercel.app")], 123)] });
    expect(() => h.execute()).toThrow();
    expect(h.removals()).toEqual([]);
  });

  it("reports when active-alias protection leaves another deployment stored", () => {
    const h = harness({ afterRemoval: [row(current.url), row("gallery-old.vercel.app")] });
    expect(() => h.execute()).toThrow(/Other deployments remain/);
  });
});
