export const convertDMSToDegree = (
  coords: number[],
  isSOrW: boolean
): number | null => {
  if (!coords || coords.length !== 3) {
    return null;
  }
  return (isSOrW ? -1 : 1) * (coords[0] + coords[1] / 60 + coords[2] / 3600);
};

export const getDegLatLngFromExif = (args: {
  GPSLongitude: number[];
  GPSLatitude: number[];
  GPSLongitudeRef: string;
  GPSLatitudeRef: string;
}) => {
  const decLng = convertDMSToDegree(
    args.GPSLongitude,
    args.GPSLongitudeRef === "W"
  );
  const decLat = convertDMSToDegree(
    args.GPSLatitude,
    args.GPSLatitudeRef === "S"
  );
  return { decLng, decLat };
};
