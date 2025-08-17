import { getDegLatLngFromExif } from "./dms2deg";

export const extractGPSFromExifString = (exifString: string): [number, number] | null => {
  if (!exifString) return null;

  const exifData: any = Object.fromEntries(
    exifString.split("\n").map((line: string) => {
      const [key, ...value] = line.split(":");
      return [key, value.join(":").trim()];
    })
  );

  try {
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
            return arrayMatch[1].split(",").map(s => {
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
          return coordStr.split(",").map(s => {
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
        const degMatch = coordStr.match(/(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)'?\s*(\d+(?:\.\d+)?)/);
        if (degMatch) {
          return [parseFloat(degMatch[1]), parseFloat(degMatch[2]), parseFloat(degMatch[3])];
        }
        
        // Handle simple space-separated format with fractions
        const spaceMatch = coordStr.trim().split(/\s+/);
        if (spaceMatch.length >= 3) {
          return spaceMatch.slice(0, 3).map(s => {
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
  } catch (err) {
    console.error("Error parsing GPS from EXIF data", err);
    return null;
  }
};

export const extractDateFromExifString = (exifString: string): Date | null => {
  const exifData: any =
    exifString &&
    Object.fromEntries(
      exifString.split("\n").map((line: string) => {
        const [key, ...value] = line.split(":");
        return [key, value.join(":").trim()];
      }),
    );

  try {
    if (exifData["EXIF DateTimeOriginal"]) {
      const splitDate = exifData["EXIF DateTimeOriginal"]
        .split(" ")[0]
        .replace(/:/g, "-");
      const splitTime = exifData["EXIF DateTimeOriginal"].split(" ")[1];

      const dateTimeOriginal = new Date(`${splitDate}T${splitTime}`);

      if (exifData["EXIF OffsetTime"]) {
        // This is kind of funky, needs verification
        const [offsetHours, offsetMinutes] = exifData["EXIF OffsetTime"]
          .split(":")
          .map(Number);

        dateTimeOriginal.setHours(dateTimeOriginal.getHours() + offsetHours);
        dateTimeOriginal.setMinutes(
          dateTimeOriginal.getMinutes() + offsetMinutes,
        );
      }

      return dateTimeOriginal;
    } else {
      return null;
    }
  } catch (err) {
    console.error("Error parsing exif data", err);
    return null;
  }
};
