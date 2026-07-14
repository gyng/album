import { getRelativeTimeString } from "./time";

describe("getRelativeTimeString", () => {
  const now = Date.UTC(2026, 6, 14, 12, 0, 0);

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null for invalid dates and numbers", () => {
    expect(getRelativeTimeString(new Date("invalid"), { lang: "en" })).toBeNull();
    expect(getRelativeTimeString(Number.NaN, { lang: "en" })).toBeNull();
  });

  it.each([
    [30, "in 30 seconds"],
    [60, "in 1 minute"],
    [3_600, "in 1 hour"],
    [86_400, "tomorrow"],
    [86_400 * 7, "next week"],
    [86_400 * 30, "next month"],
    [86_400 * 365, "next year"],
  ])("selects the appropriate unit for a %i-second delta", (seconds, expected) => {
    expect(getRelativeTimeString(now + seconds * 1_000, { lang: "en" })).toBe(expected);
  });

  it("accepts Date objects and formats past values", () => {
    expect(getRelativeTimeString(new Date(now - 60_000), { lang: "en" })).toBe("1 minute ago");
  });

  it("supports narrow output", () => {
    expect(getRelativeTimeString(now + 2 * 3_600_000, { lang: "en", short: true })).toBe("in 2h");
  });

  it("uses the runtime language when no options are supplied", () => {
    expect(getRelativeTimeString(now)).toEqual(expect.any(String));
  });

  it("uses Intl's default locale when navigator is unavailable during SSG", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Reflect.deleteProperty(globalThis, "navigator");
    try {
      expect(getRelativeTimeString(now)).toEqual(expect.any(String));
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
});
