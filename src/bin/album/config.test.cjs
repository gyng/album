/** @jest-environment node */

const {
  buildConfig,
  buildDefaultConfig,
  buildSocialLinks,
  normaliseOrigin,
  serialiseConfig,
  summariseConfig,
  validateOrigin,
  validateRequiredText,
} = require("./config.cjs");

describe("normaliseOrigin", () => {
  it.each([
    ["https://example.com", "https://example.com"],
    ["https://example.com/", "https://example.com"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["example.com", "https://example.com"],
    ["  example.com  ", "https://example.com"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseOrigin(input)).toBe(expected);
  });
});

describe("validateOrigin", () => {
  it("accepts and normalises a bare hostname", () => {
    expect(validateOrigin("example.com/")).toBe("https://example.com");
  });

  it("accepts localhost for local development", () => {
    expect(validateOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it.each([
    ["", "A public site URL is required."],
    ["   ", "A public site URL is required."],
    ["not a url", "Not a valid URL: not a url"],
    ["intranet", "Not a valid host: intranet"],
  ])("rejects %j", (input, message) => {
    expect(() => validateOrigin(input)).toThrow(message);
  });
});

describe("validateRequiredText", () => {
  it("trims an acceptable value", () => {
    expect(validateRequiredText("  Gallery  ", "Site name")).toBe("Gallery");
  });

  it.each([[""], ["   "], [null]])("rejects %j", (input) => {
    expect(() => validateRequiredText(input, "Site name")).toThrow("Site name cannot be empty.");
  });
});

describe("buildSocialLinks", () => {
  it("labels the answers in order and drops the blanks", () => {
    expect(buildSocialLinks(["https://github.test/me", "  ", "https://bsky.test/me"])).toEqual([
      { label: "GitHub", href: "https://github.test/me" },
      { label: "Bluesky", href: "https://bsky.test/me" },
    ]);
  });

  it("returns nothing when every answer is blank", () => {
    expect(buildSocialLinks(["", "", ""])).toEqual([]);
  });

  it("tolerates fewer answers than labels", () => {
    expect(buildSocialLinks([])).toEqual([]);
  });
});

describe("buildConfig", () => {
  const base = buildDefaultConfig();
  const answers = {
    name: "Test Gallery",
    description: "A description",
    origin: "https://example.test",
    albumsDir: "../photos",
    social: [{ label: "GitHub", href: "https://github.test/me" }],
  };

  it("applies every answer", () => {
    const config = buildConfig({ base, answers });

    expect(config.site).toMatchObject({
      name: "Test Gallery",
      shortName: "Test Gallery",
      description: "A description",
      origin: "https://example.test",
    });
    expect(config.paths.albumsDir).toBe("../photos");
    expect(config.social).toEqual(answers.social);
  });

  it("preserves fields the prompts do not cover", () => {
    const config = buildConfig({ base, answers });

    expect(config.branding).toEqual(base.branding);
    expect(config.pwa).toEqual(base.pwa);
    expect(config.search).toEqual(base.search);
    expect(config.site.language).toBe(base.site.language);
  });

  // Re-running init with unchanged answers must leave an empty git diff.
  it("round-trips to a byte-identical file", () => {
    const once = buildConfig({ base, answers });
    const twice = buildConfig({ base: once, answers });

    expect(serialiseConfig(twice)).toBe(serialiseConfig(once));
  });
});

describe("serialiseConfig", () => {
  it("writes indented JSON with a trailing newline", () => {
    const text = serialiseConfig({ a: 1 });
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ a: 1 });
  });
});

describe("summariseConfig", () => {
  it("reports the configured social labels", () => {
    const lines = summariseConfig(
      buildConfig({
        base: buildDefaultConfig(),
        answers: {
          name: "G",
          description: "d",
          origin: "https://e.test",
          albumsDir: "../a",
          social: [{ label: "GitHub", href: "https://github.test" }],
        },
      }),
    ).join("\n");

    expect(lines).toContain("GitHub");
  });

  it("says so plainly when there are no social links", () => {
    expect(summariseConfig(buildDefaultConfig()).join("\n")).toContain("none");
  });
});

describe("buildDefaultConfig", () => {
  // A fork must never inherit a map key locked to someone else's domain, nor
  // a private style id that will 403 on their account.
  it("carries no inherited credentials or private style", () => {
    const config = buildDefaultConfig();

    expect(config.map.apiKey).toBe("");
    expect(config.map.galleryStyleId).toBeNull();
    expect(config.map.defaultStyle).toBe("streets");
    expect(config.social).toEqual([]);
    expect(config.analytics.vercel).toBe(false);
  });
});
