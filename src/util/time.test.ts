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

  it("reuses formatters across redraws without caching ages or mixing locale and style", () => {
    const RelativeTimeFormat = Intl.RelativeTimeFormat;
    const constructor = jest
      .spyOn(Intl, "RelativeTimeFormat")
      .mockImplementation((...args) => new RelativeTimeFormat(...args));
    jest.isolateModules(() => {
      const { getRelativeTimeString: format } =
        jest.requireActual<typeof import("./time")>("./time");
      for (let redraw = 1; redraw <= 10; redraw++) {
        const date = now + redraw * 3_600_000;
        for (const lang of ["en-GB", "fr"]) {
          for (const short of [false, true]) {
            expect(format(date, { lang, short })).toBe(
              new RelativeTimeFormat(lang, {
                numeric: "auto",
                style: short ? "narrow" : "long",
              }).format(redraw, "hour"),
            );
          }
        }
      }
      const date = now + 2 * 3_600_000;
      expect(format(date, { short: true })).toBe("in 2 hr");
      jest.mocked(Date.now).mockReturnValue(now + 3_600_000);
      expect(format(date, { short: true })).toBe("in 1 hr");
      // Dragging redraws the slideshow chrome every frame; ICU setup must not.
      expect(constructor).toHaveBeenCalledTimes(4);
    });
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
