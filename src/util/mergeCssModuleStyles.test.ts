import { mergeCssModuleStyles } from "./mergeCssModuleStyles";

describe("a class declared local but never defined there", () => {
  // Both explore's trips and time sections claimed `section` and
  // `sectionHeader` as their own without defining them, so those panels
  // rendered with className={undefined} — no layout, no gap.
  it("falls back to the shared class rather than resolving to nothing", () => {
    const styles = mergeCssModuleStyles({ section: "shared-section" }, {}, ["section"]);

    expect(styles.section).toBe("shared-section");
  });

  it("still prefers the local class where one exists", () => {
    const styles = mergeCssModuleStyles({ section: "shared" }, { section: "local" }, ["section"]);

    expect(styles.section).toBe("local");
  });
});
