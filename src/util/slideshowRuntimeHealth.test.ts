import {
  isRuntimeHealth,
  runtimeHealthFailure,
  type SlideshowRuntimeHealth,
} from "./slideshowRuntimeHealth";

const health: SlideshowRuntimeHealth = {
  photo: "/photo.jpg",
  presentedAt: 1000,
  pendingSince: null,
  paused: false,
  nextAdvanceAt: 900000,
};

it("validates the optional cross-document health payload", () => {
  expect(isRuntimeHealth(health)).toBe(true);
  for (const value of [
    null,
    {},
    { ...health, photo: {} },
    { ...health, pendingSince: NaN },
    { ...health, paused: "false" },
  ]) {
    expect(isRuntimeHealth(value)).toBe(false);
  }
});

it("does not confuse a long slide interval or a pause with a frozen runtime", () => {
  expect(runtimeHealthFailure({ at: 60000, health }, 70000)).toBeNull();
  expect(
    runtimeHealthFailure({ at: 950000, health: { ...health, paused: true } }, 950001),
  ).toBeNull();
});
it("detects missing heartbeats after a successful presentation", () => {
  expect(runtimeHealthFailure({ at: 1000, health }, 47000)).toBe("heartbeat-timeout");
});
it("detects an overdue advance or a persistently unpresented replacement", () => {
  expect(runtimeHealthFailure({ at: 960000, health }, 960001)).toBe("advance-timeout");
  expect(
    runtimeHealthFailure({ at: 70000, health: { ...health, pendingSince: 1000 } }, 70001),
  ).toBe("image-timeout");
});
