import { isStyleUsable } from "./internal";
import type { MapRef } from "./types";

/**
 * `isStyleUsable` is the guard in front of every style mutation this adapter
 * makes, and it reads two properties MapLibre marks internal. If either is
 * renamed the guard quietly answers "no" for ever: no source, no layer and no
 * projection would ever be applied again, and nothing would throw. These cases
 * pin the shape it depends on so that break is loud.
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
