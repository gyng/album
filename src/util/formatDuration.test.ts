import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
  it("reads as a clip length rather than a number of seconds", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(73.4)).toBe("1:13");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("shows hours only once there are any", () => {
    expect(formatDuration(3599)).toBe("59:59");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  // A rounded 59.6 seconds must not read as "0:60".
  it("carries a rounded-up second into the next minute", () => {
    expect(formatDuration(59.6)).toBe("1:00");
  });

  it("returns nothing for a length it cannot use", () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(-5)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
  });
});
