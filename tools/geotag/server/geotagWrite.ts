import { ExifTool, type WriteTags } from "exiftool-vendored";
import { buildWritePlan, type WriteAssignment } from "../../../src/util/gpsWriteModel";

// Lazy singleton — spawning the exiftool process is expensive, so keep one for
// the life of the dev server.
let et: ExifTool | null = null;
const tool = (): ExifTool => (et ??= new ExifTool({ maxProcs: 1 }));

export type WriteResult = {
  filename: string;
  path: string;
  ok: boolean;
  error?: string;
  lat: number;
  lng: number;
};

/**
 * Write GPS tags into each photo's EXIF. Default exiftool behaviour keeps a
 * `<file>_original` backup beside each edited file, so a write is reversible.
 */
export const writeGps = async (assignments: WriteAssignment[]): Promise<WriteResult[]> => {
  const plan = buildWritePlan(assignments);
  const exif = tool();
  const results: WriteResult[] = [];

  for (const item of plan) {
    const tags: WriteTags = {
      GPSLatitude: item.tags.GPSLatitude,
      GPSLatitudeRef: item.tags.GPSLatitudeRef,
      GPSLongitude: item.tags.GPSLongitude,
      GPSLongitudeRef: item.tags.GPSLongitudeRef,
    };
    if (item.tags.GPSProcessingMethod) {
      tags.GPSProcessingMethod = item.tags.GPSProcessingMethod;
    }

    try {
      await exif.write(item.path, tags);
      results.push({
        filename: item.filename,
        path: item.path,
        ok: true,
        lat: item.after.lat,
        lng: item.after.lng,
      });
    } catch (error) {
      results.push({
        filename: item.filename,
        path: item.path,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        lat: item.after.lat,
        lng: item.after.lng,
      });
    }
  }

  return results;
};

export const closeExiftool = async (): Promise<void> => {
  if (et) {
    await et.end();
    et = null;
  }
};
