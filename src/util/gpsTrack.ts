// GPS track ingestion + time-based sampling. Parses GPX and Google Takeout into
// a normalized, time-sorted UTC track, and samples an interpolated position at
// an arbitrary instant with a confidence grade. Pure — no I/O.

import { XMLParser } from "fast-xml-parser";

export type TrackPoint = { utcMs: number; lat: number; lng: number; ele?: number };
export type TrackSource = "gpx" | "takeout";
export type Track = { points: TrackPoint[]; source: TrackSource };

export type Confidence = "high" | "medium" | "low";
export type TrackSample = {
  lat: number;
  lng: number;
  confidence: Confidence;
  gapMs: number;
} | null;

const HIGH_GAP_MS = 5 * 60_000;
const MEDIUM_GAP_MS = 30 * 60_000;

const toArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const scalarString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const finitePoint = (p: TrackPoint): boolean =>
  Number.isFinite(p.utcMs) && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Sort ascending by time, drop non-finite points, and collapse duplicate timestamps. */
export const normalizeTrack = (points: TrackPoint[], source: TrackSource): Track => {
  const sorted = points
    .filter(finitePoint)
    .slice()
    .sort((a, b) => a.utcMs - b.utcMs);
  const deduped: TrackPoint[] = [];
  for (const point of sorted) {
    if (deduped.length === 0 || deduped[deduped.length - 1].utcMs !== point.utcMs) {
      deduped.push(point);
    }
  }
  return { points: deduped, source };
};

export const parseGpx = (xml: string): Track => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const gpx = doc?.gpx ?? {};

  // Recorded tracks use trkpt; fall back to route points then waypoints.
  const rawPoints: unknown[] = [];
  for (const trk of toArray(gpx.trk)) {
    for (const seg of toArray((trk as Record<string, unknown>).trkseg)) {
      rawPoints.push(...toArray((seg as Record<string, unknown>).trkpt));
    }
  }
  for (const rte of toArray(gpx.rte)) {
    rawPoints.push(...toArray((rte as Record<string, unknown>).rtept));
  }
  if (rawPoints.length === 0) rawPoints.push(...toArray(gpx.wpt));

  const points: TrackPoint[] = [];
  for (const raw of rawPoints) {
    const node = raw as Record<string, unknown>;
    const utcMs = Date.parse(scalarString(node.time));
    const lat = Number(node["@_lat"]);
    const lng = Number(node["@_lon"]);
    if (!Number.isNaN(utcMs)) {
      const point: TrackPoint = { utcMs, lat, lng };
      if (node.ele !== undefined && Number.isFinite(Number(node.ele))) {
        point.ele = Number(node.ele);
      }
      points.push(point);
    }
  }
  return normalizeTrack(points, "gpx");
};

const parsePointString = (raw: string): { lat: number; lng: number } | null => {
  // Handles "35.0°, 139.0°", "35.0, 139.0", and "geo:35.0,139.0".
  const cleaned = raw.replace(/geo:/i, "").replace(/°/g, "").trim();
  const [lat, lng] = cleaned.split(",").map((n) => Number(n.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export const parseGoogleTakeout = (input: string | object): Track => {
  const data = (typeof input === "string" ? JSON.parse(input) : input) as Record<string, unknown>;
  const points: TrackPoint[] = [];

  // Classic Location History (Records.json): { locations: [{ latitudeE7, longitudeE7, timestampMs|timestamp }] }
  for (const loc of toArray(data.locations as unknown[])) {
    const node = loc as Record<string, unknown>;
    const utcMs =
      node.timestampMs !== undefined
        ? Number(node.timestampMs)
        : Date.parse(scalarString(node.timestamp));
    const lat = Number(node.latitudeE7) / 1e7;
    const lng = Number(node.longitudeE7) / 1e7;
    if (Number.isFinite(utcMs)) points.push({ utcMs, lat, lng });
  }

  // Newer Timeline export: { semanticSegments: [{ timelinePath: [{ point, time }] }] }
  for (const seg of toArray(data.semanticSegments as unknown[])) {
    for (const step of toArray((seg as Record<string, unknown>).timelinePath as unknown[])) {
      const node = step as Record<string, unknown>;
      const coords = parsePointString(scalarString(node.point));
      const utcMs = Date.parse(scalarString(node.time));
      if (coords && !Number.isNaN(utcMs)) {
        points.push({ utcMs, lat: coords.lat, lng: coords.lng });
      }
    }
  }

  return normalizeTrack(points, "takeout");
};

const gradeGap = (gapMs: number): Confidence =>
  gapMs <= HIGH_GAP_MS ? "high" : gapMs <= MEDIUM_GAP_MS ? "medium" : "low";

const normalizeLng = (lng: number): number => {
  let value = lng;
  while (value > 180) value -= 360;
  while (value <= -180) value += 360;
  return value;
};

/** Interpolate a position at `utcMs`, or null when outside the track's span. */
export const sampleTrackAt = (track: Track, utcMs: number): TrackSample => {
  const { points } = track;
  if (points.length === 0) return null;
  if (utcMs < points[0].utcMs || utcMs > points[points.length - 1].utcMs) return null;

  // Binary search for the leg [lo, lo+1] bracketing utcMs.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].utcMs <= utcMs) lo = mid;
    else hi = mid;
  }

  const a = points[lo];
  const b = points[hi];
  if (utcMs === a.utcMs) return { lat: a.lat, lng: a.lng, confidence: "high", gapMs: 0 };
  if (utcMs === b.utcMs) return { lat: b.lat, lng: b.lng, confidence: "high", gapMs: 0 };

  const gapMs = b.utcMs - a.utcMs;
  const f = (utcMs - a.utcMs) / gapMs;
  const lat = a.lat + f * (b.lat - a.lat);

  // Unwrap the longitude pair so the interpolation takes the short way round.
  let bLng = b.lng;
  if (bLng - a.lng > 180) bLng -= 360;
  else if (bLng - a.lng < -180) bLng += 360;
  const lng = normalizeLng(a.lng + f * (bLng - a.lng));

  return { lat, lng, confidence: gradeGap(gapMs), gapMs };
};
