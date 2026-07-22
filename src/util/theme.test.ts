import { resolveThemeName } from "./theme";

describe("resolveThemeName", () => {
  it("resolves a known theme name", () => {
    expect(resolveThemeName("paper")).toBe("paper");
  });

  it("resolves a known legacy alias", () => {
    expect(resolveThemeName("porcelain")).toBe("watercolour");
  });

  it("returns null for an unknown theme name", () => {
    expect(resolveThemeName("nonexistent")).toBeNull();
  });

  // LEGACY_THEME_ALIASES[value] on a plain object leaks Object.prototype
  // members: resolveThemeName("constructor") would otherwise return the
  // Object constructor (truthy), which themeClassNames then turns into an
  // invalid CSS class, crashing classList.add via `?theme=constructor`.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "returns null for the inherited Object.prototype member %p rather than leaking it",
    (value) => {
      expect(resolveThemeName(value)).toBeNull();
    },
  );
});
