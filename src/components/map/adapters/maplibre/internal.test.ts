import { isStyleUsable } from "./internal";
import type { MapRef } from "./types";

/**
 * `isStyleUsable` is the guard in front of every style mutation this adapter
 * makes. These cases pin its decision — which combinations of removed, loading
 * and absent count as usable — and nothing more.
 *
 * They deliberately do not pin the two internal MapLibre properties it reads
 * (`_removed`, `style._loaded`): each case builds its own literal and casts it
 * to `MapRef`, so a rename in MapLibre would leave every one of them passing.
 * What catches that is `tsc`, because `MapRef` is MapLibre's own `Map` type and
 * `internal.ts` reads the properties off it unaliased.
 */
const asMap = (map: Partial<MapRef>): MapRef => map as MapRef;

describe("isStyleUsable", () => {
  it("is false without a map at all", () => {
    expect(isStyleUsable(null)).toBe(false);
  });

  it("is false once the map has been removed, loaded style or not", () => {
    expect(
      isStyleUsable(asMap({ _removed: true, style: { _loaded: true } as MapRef["style"] })),
    ).toBe(false);
  });

  it("is false while the style is still loading", () => {
    expect(
      isStyleUsable(asMap({ _removed: false, style: { _loaded: false } as MapRef["style"] })),
    ).toBe(false);
  });

  it("is false before a style exists", () => {
    expect(isStyleUsable(asMap({ _removed: false }))).toBe(false);
  });

  it("is true for a live map with a loaded style", () => {
    expect(
      isStyleUsable(asMap({ _removed: false, style: { _loaded: true } as MapRef["style"] })),
    ).toBe(true);
  });
});
