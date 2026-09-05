import type { RandomPhotoRow } from "../components/search/api";
import { getSlideshowPhotoSrc } from "./slideshowQueue";

export const RECENT_SLIDESHOW_CACHE = "snapshots-slideshow-recent-v1";

export const chooseRecentSlideshowPhoto = (
  pool: RandomPhotoRow[],
  urls: string[],
  currentPath?: string,
): RandomPhotoRow | null => {
  const cached = new Set(urls.map((url) => new URL(url, "https://cache.invalid").pathname));
  const available = pool.filter((photo) => {
    const src = getSlideshowPhotoSrc(photo);
    return src !== null && cached.has(new URL(src, "https://cache.invalid").pathname);
  });
  const current = available.findIndex((photo) => photo.path === currentPath);
  const next = available[(current + 1) % available.length];
  return next && next.path !== currentPath ? next : null;
};

export const readRecentSlideshowUrls = async (): Promise<string[]> => {
  try {
    if (typeof caches === "undefined" || !(await caches.has(RECENT_SLIDESHOW_CACHE))) return [];
    const cache = await caches.open(RECENT_SLIDESHOW_CACHE);
    return (await cache.keys()).map((request) => request.url);
  } catch {
    return [];
  }
};
