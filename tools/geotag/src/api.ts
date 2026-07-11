import type { Confidence } from "@shared/gpsTrack";

export type GeotagPhoto = {
  filename: string;
  path: string;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  decLat: number | null;
  decLng: number | null;
  gpsUtcMs: number | null;
};

export type SubDir = { name: string; imageCount: number };

export type FolderListing = {
  path: string;
  parent: string | null;
  subdirs: SubDir[];
  photos: GeotagPhoto[];
};

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data as T;
};

/** List any directory: its sub-folders (to navigate) and its photos. */
export const listFolder = async (folderPath?: string): Promise<FolderListing> =>
  json<FolderListing>(`/api/folder${folderPath ? `?path=${encodeURIComponent(folderPath)}` : ""}`);

export const thumbUrl = (filePath: string, w = 240): string =>
  `/api/thumb?path=${encodeURIComponent(filePath)}&w=${w}`;

export const isLocated = (p: GeotagPhoto): boolean => p.decLat !== null && p.decLng !== null;

export type PendingFix = {
  lat: number;
  lng: number;
  confidence?: Confidence;
  interpolated?: boolean;
};

export type WriteItem = {
  filename: string;
  path: string;
  lat: number;
  lng: number;
  interpolated?: boolean;
};

export type WriteResult = {
  filename: string;
  path: string;
  ok: boolean;
  error?: string;
  lat: number;
  lng: number;
};

/** Write GPS into the given files. `root` is the open folder — the server
 *  refuses any path outside it, and the header defeats cross-site POSTs. */
export const writeGps = async (items: WriteItem[], root: string): Promise<WriteResult[]> => {
  const res = await fetch("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-geotag-tool": "1" },
    body: JSON.stringify({ root, items }),
  });
  const data = (await res.json()) as { results?: WriteResult[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data.results ?? [];
};

export const fetchTz = async (lat: number, lng: number): Promise<string | null> => {
  try {
    return (await json<{ zone: string | null }>(`/api/tz?lat=${lat}&lng=${lng}`)).zone;
  } catch {
    return null;
  }
};

export const formatOffsetMinutes = (min: number): string => {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

/** Parse a "lat, lng" (or "lat lng") string into a fix, or null. */
export const parseLatLng = (raw: string): { lat: number; lng: number } | null => {
  const [lat, lng] = raw
    .trim()
    .split(/[,\s]+/)
    .map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};
