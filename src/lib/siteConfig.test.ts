import { siteConfig } from "./siteConfig";

// These assert structural invariants a fork's own site.config.json must hold,
// not this site's particular wording. A bad value here silently poisons
// canonical URLs, feeds and sitemaps, so it is worth catching at test time.
describe("siteConfig", () => {
  it("declares an absolute origin with no trailing slash", () => {
    expect(siteConfig.site.origin).toMatch(/^https?:\/\//);
    expect(siteConfig.site.origin).not.toMatch(/\/$/);
  });

  it("declares a non-empty name and description", () => {
    expect(siteConfig.site.name.length).toBeGreaterThan(0);
    expect(siteConfig.site.description.length).toBeGreaterThan(0);
  });

  it("gives every social link a label and an absolute URL", () => {
    for (const link of siteConfig.social) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.href).toMatch(/^https?:\/\//);
    }
  });

  it("points both database URLs at site-root-relative paths", () => {
    expect(siteConfig.search.databaseUrl.startsWith("/")).toBe(true);
    expect(siteConfig.search.embeddingsDatabaseUrl.startsWith("/")).toBe(true);
  });

  // The search database stores keys like `../albums/<name>/<file>`, so this is
  // a data-format constant rather than a free choice of path.
  it("keeps the albums directory repo-relative", () => {
    expect(siteConfig.paths.albumsDir.startsWith("/")).toBe(false);
  });

  it("names a default map style that the configuration can supply", () => {
    if (siteConfig.map.defaultStyle === "gallery") {
      expect(siteConfig.map.galleryStyleId).not.toBeNull();
    }
  });
});
