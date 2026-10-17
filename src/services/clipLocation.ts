/**
 * Where a clip without a location of its own was probably shot.
 *
 * A camera without GPS, or a fix that never came, leaves a clip off the map —
 * and without a place it has no derived zone, geocode or weather either. A clip
 * is almost always shot between photographs, by the same person in the same
 * place, so the geotagged photograph nearest to it in time, in the same album,
 * stands in for it: within half an hour, beyond which the photographer may
 * have gone anywhere and a guessed pin is worse than none.
 *
 * The result is written into the clip's poster sidecar with where it came from
 * (`locationSource: "nearby-photo"` and the photo it borrowed), so everything
 * that reads a clip's place — the indexer's geocode, zone and weather, the map,
 * the album's details — gets it without a second implementation, and can say
 * it is inferred. A location the camera recorded is never replaced.
 *
 * Loaded directly by the CJS poster prepass through Node's TypeScript
 * stripping, so it takes no runtime relative import.
 */

import type { VideoPosterSidecar } from "./videoPoster";

export type GeotaggedPhoto = {
  /** The photograph's filename within the clip's album. */
  name: string;
  /** Camera-local wall clock, in EXIF's colon form or naive ISO. */
  capturedAtLocal: string;
  latDeg: number;
  lngDeg: number;
};

export type InferredLocation = {
  latDeg: number;
  lngDeg: number;
  photo: string;
  /** Whole minutes from the clip to the photograph; negative when it came first. */
  minutesApart: number;
};

export const CLIP_LOCATION_WINDOW_MINUTES = 30;

// Wall clocks are compared as wall clocks: both are camera-local, so anchoring
// them to UTC is only a way to subtract them, never an instant.
const wallClockMinutes = (value: string | undefined): number | undefined => {
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  const at = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  return Number.isFinite(at) ? at / 60_000 : undefined;
};

export const inferClipLocation = (
  clipWallClock: string | undefined,
  photos: readonly GeotaggedPhoto[],
  windowMinutes = CLIP_LOCATION_WINDOW_MINUTES,
): InferredLocation | undefined => {
  const clipAt = wallClockMinutes(clipWallClock);
  if (clipAt === undefined) return undefined;

  let best: { photo: GeotaggedPhoto; apart: number } | undefined;
  for (const candidate of photos) {
    const at = wallClockMinutes(candidate.capturedAtLocal);
    if (
      at === undefined ||
      !Number.isFinite(candidate.latDeg) ||
      !Number.isFinite(candidate.lngDeg)
    )
      continue;
    const apart = at - clipAt;
    if (Math.abs(apart) > windowMinutes) continue;
    // Nearest wins; a tie goes to the earlier name, so the answer is stable.
    if (
      !best ||
      Math.abs(apart) < Math.abs(best.apart) ||
      (Math.abs(apart) === Math.abs(best.apart) && candidate.name < best.photo.name)
    ) {
      best = { photo: candidate, apart };
    }
  }
  if (!best) return undefined;
  return {
    latDeg: best.photo.latDeg,
    lngDeg: best.photo.lngDeg,
    photo: best.photo.name,
    minutesApart: Math.round(best.apart),
  };
};

type LocatedSidecar = Pick<
  VideoPosterSidecar,
  "capturedAtLocal" | "latDeg" | "lngDeg" | "locationSource" | "locationInferredFrom"
>;

/**
 * The sidecar with its inferred location brought up to date against the
 * album's photographs — or the very same object when nothing changed, so the
 * caller rewrites only what moved. A recorded location (`"camera"`, or a
 * coordinate from before sources were recorded) is left exactly as it is.
 */
export const reconcileInferredLocation = <T extends LocatedSidecar>(
  sidecar: T,
  photos: readonly GeotaggedPhoto[],
): T => {
  const recorded =
    sidecar.locationSource === "camera" ||
    (sidecar.locationSource === undefined && typeof sidecar.latDeg === "number");
  if (recorded) return sidecar;

  const inferred = inferClipLocation(sidecar.capturedAtLocal, photos);
  const previous = sidecar.locationInferredFrom;
  if (
    inferred &&
    sidecar.locationSource === "nearby-photo" &&
    sidecar.latDeg === inferred.latDeg &&
    sidecar.lngDeg === inferred.lngDeg &&
    previous?.photo === inferred.photo &&
    previous.minutesApart === inferred.minutesApart
  ) {
    return sidecar;
  }
  if (!inferred && sidecar.locationSource === undefined && sidecar.latDeg === undefined) {
    return sidecar;
  }

  const {
    latDeg: _latDeg,
    lngDeg: _lngDeg,
    locationSource: _locationSource,
    locationInferredFrom: _locationInferredFrom,
    ...rest
  } = sidecar;
  if (!inferred) return rest as T;
  return {
    ...rest,
    latDeg: inferred.latDeg,
    lngDeg: inferred.lngDeg,
    locationSource: "nearby-photo",
    locationInferredFrom: { photo: inferred.photo, minutesApart: inferred.minutesApart },
  } as T;
};
