import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import exifr from "exifr";
import { afterAll, describe, expect, it } from "vitest";
import { buildLensTags, closeLensExiftool, writeLens } from "./lensWrite.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("buildLensTags", () => {
  it("writes the fields consumed by the gallery and search index", () => {
    expect(
      buildLensTags({
        make: "Voigtländer",
        model: "NOKTON 35mm F1.2",
        focalLength: 35,
        focalLength35mm: 53,
      }),
    ).toEqual({
      LensMake: "Voigtländer",
      LensModel: "NOKTON 35mm F1.2",
      FocalLength: "35 mm",
      FocalLengthIn35mmFormat: "53 mm",
    });
  });

  it("omits optional fields rather than clearing existing metadata", () => {
    expect(
      buildLensTags({
        make: "",
        model: "7Artisans 25mm F1.8",
        focalLength: null,
        focalLength35mm: null,
      }),
    ).toEqual({
      LensModel: "7Artisans 25mm F1.8",
    });
  });

  it("writes readable lens metadata and retains a reversible original", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "geotag-lens-"));
    const target = path.join(directory, "manual-lens.jpg");
    try {
      await fs.copyFile(
        path.resolve(here, "../../../albums/test-simple/DSCF0506-2.jpg"),
        target,
      );

      const [result] = await writeLens([
        {
          filename: "manual-lens.jpg",
          path: target,
          lens: {
            make: "Voigtländer",
            model: "NOKTON 35mm F1.2",
            focalLength: 35,
            focalLength35mm: 53,
          },
        },
      ]);
      const exif = (await exifr.parse(target)) as Record<string, unknown>;

      expect(result.ok).toBe(true);
      expect(exif.LensMake).toBe("Voigtländer");
      expect(exif.LensModel).toBe("NOKTON 35mm F1.2");
      expect(exif.FocalLength).toBe(35);
      expect(exif.FocalLengthIn35mmFormat).toBe(53);
      await expect(fs.stat(`${target}_original`)).resolves.toBeDefined();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

afterAll(closeLensExiftool);
