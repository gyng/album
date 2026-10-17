import type { Content, OptimisedPhoto } from "../services/types";

/** An album reduced to what a card shows: covers, first photograph and counts. */
export type AlbumPreview = Content & { photoCount?: number };

export type HomePageData = { albums: AlbumPreview[] };

export type AlbumPageData = { album: Content };

/** Render-ready photo data shared by the build loader and map UI. */
export type MapWorldEntry = {
  album: string;
  /** "video" when the entry is a clip drawn through its poster frame. */
  mediaKind?: "video";
  /** A clip's own file (`../albums/<album>/<name>`), which the map plays on hover. */
  clipPath?: string;
  src: OptimisedPhoto;
  decLat: number | null;
  decLng: number | null;
  date: string | null;
  /** EXIF OffsetTime naming the zone `date` is expressed in, when recorded. */
  dateOffset?: string | null;
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
  /** EXIF OffsetTime naming the zone `dateTimeOriginal` is expressed in. */
  dateOffset?: string | null;
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

/** Render-ready clip data shared by the build loader and the explore video grid. */
export type ExploreClipRow = {
  /** Clip filename, the album page's own anchor. */
  id: string;
  /** Album slug. */
  album: string;
  href: string;
  /** Poster frame — the `@800`-scale variant of `_build.poster.srcset`. */
  src: OptimisedPhoto;
  /** Naive camera-local wall clock; never built via UTC. */
  capturedAtLocal: string;
  year: number;
  durationSeconds?: number;
  /** The indexed row's `alt_text`, else the filename. */
  label: string;
  /** `rgb(r, g, b)` from the indexed row's first colour. */
  swatch?: string;
};
