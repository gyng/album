import type { Content, OptimisedPhoto } from "../services/types";

export type HomePageData = { albums: Content[] };

export type AlbumPageData = { album: Content };

/** Render-ready photo data shared by the build loader and map UI. */
export type MapWorldEntry = {
  album: string;
  /** "video" when the entry is a clip drawn through its poster frame. */
  mediaKind?: "video";
  src: OptimisedPhoto;
  decLat: number | null;
  decLng: number | null;
  date: string | null;
  href: string;
  placeholderColor?: string;
  placeholderWidth?: number;
  placeholderHeight?: number;
};

export type TimeRange = { fromMs: number; toMs: number };

/** Render-ready photo data shared by the build loader and timeline UI. */
export type TimelineEntry = {
  album: string;
  /** "video" when the entry is a clip drawn through its poster frame. */
  mediaKind?: "video";
  date: string;
  dateTimeOriginal: string;
  decLat?: number | null;
  decLng?: number | null;
  geocode?: string | null;
  src: OptimisedPhoto;
  href: string;
  path: string;
  placeholderColor: string;
  placeholderWidth: number;
  placeholderHeight: number;
};
