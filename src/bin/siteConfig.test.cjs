/** @jest-environment node */

const path = require("node:path");
const {
  normaliseOrigin,
  resolveAlbumsDir,
  resolveSiteOrigin,
  siteConfig,
} = require("./siteConfig.cjs");

describe("normaliseOrigin", () => {
  it.each([
    ["https://example.com", "https://example.com"],
    ["https://example.com/", "https://example.com"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["example.com", "https://example.com"],
    ["example.com/", "https://example.com"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseOrigin(input)).toBe(expected);
  });
});

describe("resolveSiteOrigin", () => {
  it("falls back to the authored identity when nothing is set", () => {
    expect(resolveSiteOrigin({})).toBe(siteConfig.site.origin);
  });

  it("reads the ambient environment when none is supplied", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://ambient.example";
    try {
      expect(resolveSiteOrigin()).toBe("https://ambient.example");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = previous;
      }
    }
  });

  it.each([
    ["NEXT_PUBLIC_SITE_URL", "https://first.example"],
    ["SITE_URL", "https://second.example"],
    ["VERCEL_PROJECT_PRODUCTION_URL", "third.example"],
  ])("honours %s", (key, value) => {
    expect(resolveSiteOrigin({ [key]: value })).toBe(normaliseOrigin(value));
  });

  it("prefers the earliest variable in the chain", () => {
    expect(
      resolveSiteOrigin({
        NEXT_PUBLIC_SITE_URL: "https://first.example",
        SITE_URL: "https://second.example",
      }),
    ).toBe("https://first.example");
  });

  // Vercel writes empty strings for unset project variables. A `??` chain would
  // let "" through and yield a bare "https://".
  it("treats an empty variable as unset rather than as an origin", () => {
    expect(resolveSiteOrigin({ NEXT_PUBLIC_SITE_URL: "", SITE_URL: "https://real.example" })).toBe(
      "https://real.example",
    );
  });
});

describe("resolveAlbumsDir", () => {
  it("resolves the configured directory against the app root", () => {
    expect(resolveAlbumsDir("/repo/src")).toBe(
      path.resolve("/repo/src", siteConfig.paths.albumsDir),
    );
  });
});
