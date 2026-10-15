import type { PhotoGamePhoto } from "./photoGames";

export const photoLocationDistance = (
  a: NonNullable<PhotoGamePhoto["location"]>,
  b: NonNullable<PhotoGamePhoto["location"]>,
): number => {
  const radians = Math.PI / 180;
  const value =
    Math.sin(((b.lat - a.lat) * radians) / 2) ** 2 +
    Math.cos(a.lat * radians) *
      Math.cos(b.lat * radians) *
      Math.sin(((b.lng - a.lng) * radians) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
};
