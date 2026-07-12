import { describe, expect, it } from "vitest";
import {
  assignLensToPhotos,
  isLensMissing,
  normaliseLensDraft,
  parseLensPresets,
  upsertLensPreset,
  type LensMetadata,
} from "./lens.ts";

const nokton: LensMetadata = {
  make: "Voigtländer",
  model: "NOKTON 35mm F1.2",
  focalLength: 35,
  focalLength35mm: 53,
};

describe("normaliseLensDraft", () => {
  it("normalises a reusable manual-lens preset", () => {
    expect(
      normaliseLensDraft({
        name: "  Voigtländer 35  ",
        make: "  Voigtländer ",
        model: "  NOKTON 35mm F1.2  ",
        focalLength: "35",
        focalLength35mm: "53",
      }),
    ).toEqual({
      name: "Voigtländer 35",
      make: "Voigtländer",
      model: "NOKTON 35mm F1.2",
      focalLength: 35,
      focalLength35mm: 53,
    });
  });

  it("requires a model and rejects invalid focal lengths", () => {
    expect(
      normaliseLensDraft({ name: "", make: "", model: "", focalLength: "", focalLength35mm: "" }),
    ).toBeNull();
    expect(
      normaliseLensDraft({
        name: "Bad",
        make: "",
        model: "Lens",
        focalLength: "-1",
        focalLength35mm: "nope",
      }),
    ).toBeNull();
  });
});

describe("isLensMissing", () => {
  it("treats blank or absent lens models as missing", () => {
    expect(isLensMissing({ lensModel: null })).toBe(true);
    expect(isLensMissing({ lensModel: "   " })).toBe(true);
    expect(isLensMissing({ lensModel: "XF35mmF1.4 R" })).toBe(false);
  });
});

describe("manual-lens batches", () => {
  it("assigns a lens to the requested photos without dropping other pending work", () => {
    const other: LensMetadata = {
      make: "7Artisans",
      model: "25mm F1.8",
      focalLength: 25,
      focalLength35mm: null,
    };
    expect(assignLensToPhotos({ first: other }, ["second", "third"], nokton)).toEqual({
      first: other,
      second: nokton,
      third: nokton,
    });
  });

  it("updates a same-name preset instead of creating a hard-to-distinguish duplicate", () => {
    const existing = [{ ...nokton, id: "existing", name: "35 walkaround" }];
    const updated = { ...nokton, focalLength35mm: 52, name: "35 WALKAROUND" };
    expect(upsertLensPreset(existing, updated, () => "new")).toEqual([
      { ...updated, id: "existing" },
    ]);
  });
});

describe("parseLensPresets", () => {
  it("recovers safely from corrupt storage and drops invalid presets", () => {
    expect(parseLensPresets("not json")).toEqual([]);
    expect(
      parseLensPresets(
        JSON.stringify([
          { ...nokton, id: "good", name: "Nokton" },
          { ...nokton, id: "bad", name: "Broken", focalLength: -35 },
          { id: "partial", name: "Partial" },
        ]),
      ),
    ).toEqual([{ ...nokton, id: "good", name: "Nokton" }]);
  });
});
