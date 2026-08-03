import type { Content, PhotoBlock } from "../services/types";
import type { TripPhoto } from "./computeTrips";
import { getGeocodeCity, getGeocodeCountry } from "./geocode";
import { getDegLatLngFromExif } from "./dms2deg";
import { getMapPhotoHref } from "./mapSearchIndex";
import { encodePublicAssetPath } from "./encodePublicAssetPath";
import { rgbToString } from "./colorDistance";

/**
 * `Tags.tags` is declared `string[]`, but the search index stores the column as
 * one comma-separated string and the row reaches here unparsed, so that is what
 * actually arrives. Accept both rather than trusting either.
 */
const toTagList = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === "string");
  if (typeof raw === "string") return raw.split(",").map((tag) => tag.trim());
  return [];
};

/**
 * The one place a photograph becomes trip input.
 *
 * Both callers — the build, over every album, and the album page, over its own
 * blocks — must read a photograph identically or the same journey renders
 * differently depending on which page asked.
 */
export const tripPhotoFromBlock = (album: Content, photo: PhotoBlock): TripPhoto => {
  const exif = photo._build.exif;
  const { decLat, decLng } = getDegLatLngFromExif(exif);
  const geocode = photo._build.tags?.geocode;
  const dominant = photo._build.tags?.colors?.[0] as [number, number, number] | undefined;
  const tags = toTagList(photo._build.tags?.tags);

  return {
    date: exif.DateTimeOriginal ?? null,
    album: album._build.slug,
    src: photo._build.srcset?.[0]?.src ?? encodePublicAssetPath(photo.data.src),
    href: getMapPhotoHref(album._build.slug, photo),
    // Never undefined: getStaticProps cannot serialise it.
    label: photo.data.title ?? photo.id ?? "",
    city: getGeocodeCity(geocode),
    country: getGeocodeCountry(geocode),
    lat: typeof decLat === "number" ? decLat : null,
    lng: typeof decLng === "number" ? decLng : null,
    ...(dominant ? { swatch: rgbToString(dominant) } : {}),
    ...(exif.Model ? { camera: exif.Model } : {}),
    // Absent on a fixed-lens body — unrecorded, not lensless.
    ...(exif.LensModel ? { lens: exif.LensModel } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
};
