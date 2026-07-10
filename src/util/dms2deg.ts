export const convertDMSToDegree = (
  coords: number[] | undefined,
  isSOrW: boolean,
): number | null => {
  if (!coords || coords.length !== 3) {
    return null;
  }
  const degrees = (isSOrW ? -1 : 1) * (coords[0] + coords[1] / 60 + coords[2] / 3600);
  // Malformed EXIF rationals produce NaN, which would defeat downstream
  // null guards and reach MapLibre as an invalid LngLat
  return Number.isFinite(degrees) ? degrees : null;
};

export const getDegLatLngFromExif = (args: {
  GPSLongitude?: number[];
  GPSLatitude?: number[];
  GPSLongitudeRef?: string;
  GPSLatitudeRef?: string;
}) => {
  const decLng = convertDMSToDegree(args.GPSLongitude, args.GPSLongitudeRef === "W");
  const decLat = convertDMSToDegree(args.GPSLatitude, args.GPSLatitudeRef === "S");
  return { decLng, decLat };
};
