import { ExifTool, type WriteTags } from "exiftool-vendored";
import type { LensMetadata } from "../src/lens.ts";

let et: ExifTool | null = null;
const tool = (): ExifTool => (et ??= new ExifTool({ maxProcs: 1 }));

export type LensWriteAssignment = {
  filename: string;
  path: string;
  lens: LensMetadata;
};

export type LensWriteResult = LensWriteAssignment & {
  ok: boolean;
  error?: string;
};

export const buildLensTags = (lens: LensMetadata): WriteTags => ({
  ...(lens.make.trim() ? { LensMake: lens.make.trim() } : {}),
  LensModel: lens.model.trim(),
  ...(lens.focalLength ? { FocalLength: `${lens.focalLength} mm` } : {}),
  ...(lens.focalLength35mm
    ? { FocalLengthIn35mmFormat: `${lens.focalLength35mm} mm` }
    : {}),
});

/** Write manual-lens EXIF while retaining ExifTool's `<file>_original` backup. */
export const writeLens = async (
  assignments: LensWriteAssignment[],
): Promise<LensWriteResult[]> => {
  const exif = tool();
  const results: LensWriteResult[] = [];

  for (const assignment of assignments) {
    try {
      await exif.write(assignment.path, buildLensTags(assignment.lens));
      results.push({ ...assignment, ok: true });
    } catch (error) {
      results.push({
        ...assignment,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
};

export const closeLensExiftool = async (): Promise<void> => {
  if (et) {
    await et.end();
    et = null;
  }
};
