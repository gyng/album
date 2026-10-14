import fs from "node:fs";
import path from "node:path";

// `--m-*` is the legacy spacing scale; new rules use `--space-*`. Remapping the
// old tokens globally would move chart and image geometry, so they retire one
// rule at a time instead. This ratchet only stops them spreading: migrating a
// rule lowers the count, and the baseline should be lowered with it.
const LEGACY_SPACING_BASELINE = 985;

const STYLE_ROOTS = ["components", "screens", "styles"];

const stylesheetsBelow = (directory: string): string[] =>
  fs
    .readdirSync(path.join(process.cwd(), directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => path.join(entry.parentPath, entry.name));

test("legacy --m-* spacing does not spread", () => {
  const uses = STYLE_ROOTS.flatMap(stylesheetsBelow).reduce(
    (total, file) =>
      total + (fs.readFileSync(file, "utf8").match(/var\(--m(?:-[a-z0-9]+)?\)/g)?.length ?? 0),
    0,
  );
  expect(uses).toBeLessThanOrEqual(LEGACY_SPACING_BASELINE);
});
