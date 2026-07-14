import { getDegLatLngFromExif } from "./dms2deg";
import { parseExifLocalDateTime } from "./exifTime";

export const extractGPSFromExifString = (exifString: string): [number, number] | null => {
  if (!exifString) return null;

  const exifData: Record<string, string> = Object.fromEntries(
    exifString.split("\n").map((line: string) => {
      const [key, ...value] = line.split(":");
      return [key, value.join(":").trim()];
    }),
  );

  // Extract GPS coordinates from EXIF data
  const gpsLat = exifData["GPS GPSLatitude"];
  const gpsLatRef = exifData["GPS GPSLatitudeRef"];
  const gpsLng = exifData["GPS GPSLongitude"];
  const gpsLngRef = exifData["GPS GPSLongitudeRef"];

  if (gpsLat && gpsLatRef && gpsLng && gpsLngRef) {
    // Parse coordinate strings in various formats:
    // "[36, 341/40, 0]"
    // "49 deg 16' 32.64"
    // "49,16,32.64"
    const parseCoordinate = (coordStr: string): number[] => {
      // Handle array-like strings with fractions
      if (coordStr.includes("[") && coordStr.includes("]")) {
        const arrayMatch = coordStr.match(/\[([^\]]+)\]/);
        if (arrayMatch) {
          return arrayMatch[1].split(",").map((s) => {
            const trimmed = s.trim();
            // Handle fractions like "341/40"
            if (trimmed.includes("/")) {
              const [num, den] = trimmed.split("/");
              return parseFloat(num) / parseFloat(den);
            }
            return parseFloat(trimmed);
          });
        }
      }

      // Handle comma-separated values with fractions
      if (coordStr.includes(",")) {
        return coordStr.split(",").map((s) => {
          const trimmed = s.trim();
          // Handle fractions like "341/40"
          if (trimmed.includes("/")) {
            const [num, den] = trimmed.split("/");
            return parseFloat(num) / parseFloat(den);
          }
          return parseFloat(trimmed);
        });
      }

      // Handle degree/minute/second format
      const degMatch = coordStr.match(
        /(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)'?\s*(\d+(?:\.\d+)?)/,
      );
      if (degMatch) {
        return [parseFloat(degMatch[1]), parseFloat(degMatch[2]), parseFloat(degMatch[3])];
      }

      // Handle simple space-separated format with fractions
      const spaceMatch = coordStr.trim().split(/\s+/);
      if (spaceMatch.length >= 3) {
        return spaceMatch.slice(0, 3).map((s) => {
          // Handle fractions like "341/40"
          if (s.includes("/")) {
            const [num, den] = s.split("/");
            return parseFloat(num) / parseFloat(den);
          }
          return parseFloat(s);
        });
      }

      return [];
    };

    const latArray = parseCoordinate(gpsLat);
    const lngArray = parseCoordinate(gpsLng);

    if (latArray.length >= 3 && lngArray.length >= 3) {
      const { decLat, decLng } = getDegLatLngFromExif({
        GPSLatitude: latArray.slice(0, 3),
        GPSLatitudeRef: gpsLatRef,
        GPSLongitude: lngArray.slice(0, 3),
        GPSLongitudeRef: gpsLngRef,
      });

      if (decLat !== null && decLng !== null) {
        return [decLat, decLng];
      }
    }
  }

  return null;
};

export const extractDateFromExifString = (exifString: string): Date | null => {
  if (!exifString) return null;
  const exifData: Record<string, string> = Object.fromEntries(
    exifString.split("\n").map((line: string) => {
      const [key, ...value] = line.split(":");
      return [key, value.join(":").trim()];
    }),
  );

  const dt = parseExifLocalDateTime(exifData["EXIF DateTimeOriginal"]);
  if (!dt) {
    return null;
  }

  // EXIF DateTimeOriginal is camera-local wall-clock time; constructing the
  // Date from its components keeps that wall clock under local getters and
  // formatters. OffsetTime is deliberately not applied — it only names the
  // zone the wall clock is already expressed in.
  return new Date(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second);
};
