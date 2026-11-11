/**
 * @jest-environment jsdom
 */

import { canSetMediaVolume, formatClipDuration, rampMediaVolume } from "./clipAudio";

describe("rampMediaVolume", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("moves the volume to its target over the duration, then reports it", () => {
    const element = { volume: 0.8 };
    const done = jest.fn();
    rampMediaVolume(element, 0, 250, done);

    jest.advanceTimersByTime(125);
    expect(element.volume).toBeGreaterThan(0);
    expect(element.volume).toBeLessThan(0.8);
    expect(done).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(element.volume).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stops where it is when cancelled, without reporting", () => {
    const element = { volume: 0 };
    const done = jest.fn();
    const cancel = rampMediaVolume(element, 1, 250, done);
    jest.advanceTimersByTime(100);
    const reached = element.volume;
    cancel();
    jest.advanceTimersByTime(1000);

    expect(element.volume).toBe(reached);
    expect(done).not.toHaveBeenCalled();
  });

  it("finishes at once when there is nothing to move", () => {
    const element = { volume: 0.5 };
    const done = jest.fn();
    rampMediaVolume(element, 0.5, 250, done);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("canSetMediaVolume", () => {
  it("is true where a written volume reads back", () => {
    expect(canSetMediaVolume(() => ({ volume: 1 }))).toBe(true);
  });

  // iOS: the property accepts the write and keeps reporting 1.
  it("is false where the volume ignores the write", () => {
    const fixed = {
      get volume() {
        return 1;
      },
      set volume(_value: number) {},
    };
    expect(canSetMediaVolume(() => fixed)).toBe(false);
  });

  it("assumes it can when the probe itself fails", () => {
    expect(
      canSetMediaVolume(() => {
        throw new Error("no media");
      }),
    ).toBe(true);
  });
});

describe("formatClipDuration", () => {
  it("writes minutes and padded seconds, and hours when there are any", () => {
    expect(formatClipDuration(42.4)).toBe("0:42");
    expect(formatClipDuration(125)).toBe("2:05");
    expect(formatClipDuration(3725)).toBe("1:02:05");
  });

  it("has nothing to say for an unknown length", () => {
    expect(formatClipDuration(undefined)).toBeNull();
    expect(formatClipDuration(0)).toBeNull();
    expect(formatClipDuration(Number.NaN)).toBeNull();
  });
});
