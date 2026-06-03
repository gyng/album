import { decideBuildUpdate, decideDbUpdateAction } from "./kioskRefresh";

describe("decideDbUpdateAction", () => {
  it("seeds on the first observation so a cold start never reloads", () => {
    expect(
      decideDbUpdateAction({
        observedVersion: "v1",
        lastVersion: null,
        wakeLockHeld: false,
      }),
    ).toBe("seed");
    expect(
      decideDbUpdateAction({
        observedVersion: "v1",
        lastVersion: null,
        wakeLockHeld: true,
      }),
    ).toBe("seed");
  });

  it("does nothing when the version is unchanged", () => {
    expect(
      decideDbUpdateAction({
        observedVersion: "v1",
        lastVersion: "v1",
        wakeLockHeld: true,
      }),
    ).toBe("none");
  });

  it("refreshes the pool in place on change while the wake lock is held", () => {
    expect(
      decideDbUpdateAction({
        observedVersion: "v2",
        lastVersion: "v1",
        wakeLockHeld: true,
      }),
    ).toBe("refresh-in-place");
  });

  it("reloads on change when no wake lock is held", () => {
    expect(
      decideDbUpdateAction({
        observedVersion: "v2",
        lastVersion: "v1",
        wakeLockHeld: false,
      }),
    ).toBe("reload");
  });
});

describe("decideBuildUpdate", () => {
  it("is true only when latest is present and differs from current", () => {
    expect(decideBuildUpdate("b2", "b1")).toBe(true);
    expect(decideBuildUpdate("b1", "b1")).toBe(false);
    expect(decideBuildUpdate(undefined, "b1")).toBe(false);
    expect(decideBuildUpdate("", "b1")).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(decideBuildUpdate("  b1  ", "b1")).toBe(false);
    expect(decideBuildUpdate("  b2  ", "b1")).toBe(true);
  });
});
