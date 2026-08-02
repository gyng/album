export interface Exif {
  CreateDate?: string;
  ModifyDate?: string;
  DateTimeOriginal?: string;
  OffsetTime?: string;
  // Present in the exifr output for newer cameras (X-T5 and later); used by the
  // geotag tool to reconcile camera-local time with a UTC GPS track.
  OffsetTimeOriginal?: string;
  OffsetTimeDigitized?: string;
  Orientation?: string;
  GPSLatitudeRef?: string;
  GPSLatitude?: [number, number, number];
  GPSLongitudeRef?: string;
  GPSLongitude?: [number, number, number];
  GPSAltitude?: number;
  GPSAltitudeRef?: number;
  // UTC date/time of the GPS fix (on already-geotagged photos) — lets the geotag
  // tool self-calibrate the camera's offset. exifr yields "YYYY:MM:DD" + [h,m,s].
  GPSDateStamp?: string;
  GPSTimeStamp?: [number, number, number];
  ExposureTime?: number;
  ISO?: number;
  FNumber?: number;
  ExposureCompensation?: number;
  FocalLength?: number;
  FocalLengthIn35mmFormat?: number;
  LensMake?: string;
  LensModel?: string;
  LensInfo?: string;
  Make?: string;
  Model?: string;
  ImageDescription?: string;
}

export interface Tags {
  tags?: string[];
  colors?: [number, number, number][];
  alt_text?: string;
  path?: string;
  geocode?: string;
  /** IANA zone derived from the photo's coordinates by the indexer. */
  tz_name?: string;
  /** UTC offset for that zone at the photo's own date, e.g. "+09:00". */
  tz_offset?: string;
}

export type SerializedTextBlock = TextBlock;

export interface OptimisedPhoto {
  src: string;
  width: number;
  height: number;
}

export interface TextBlock extends IBlock {
  kind: "text";
  id: string;
  data: {
    title: string;
    kicker?: string;
    description?: string;
  };
  formatting?: {};
}

export interface PhotoBlock extends IBlock {
  kind: "photo";
  id: string;
  data: {
    src: string;
    title?: string;
    kicker?: string;
    description?: string;
  };
  formatting?: {
    immersive?: boolean;
    cover?: boolean;
  };
  _build: {
    height: number;
    width: number;
    exif: Exif;
    tags: Tags;
    srcset: OptimisedPhoto[];
  };
}

export interface VideoBlock extends IBlock {
  kind: "video";
  id: string;
  data:
    | {
        type: "youtube";
        href: string;
        date?: string;
      }
    | {
        type: "local";
        href: string;
        date?: string;
      };
  _build?: {
    src: string;
    originalSrc?: string;
    mimeType: string;
    /**
     * The extracted frame that stands in for the clip wherever pixels are
     * needed but a `<video>` is not — the album page's `poster`, search tiles,
     * map markers. Written by services/videoPoster.ts into the album's own
     * `.resized_images` cache under the video's filename, so it is addressed by
     * exactly the same URLs as a photo's variants.
     */
    poster?: {
      srcset: OptimisedPhoto[];
    };
    /** Camera-local wall clock, no zone — the same reading EXIF dates use. */
    capturedAtLocal?: string;
    latDeg?: number;
    lngDeg?: number;
    durationSeconds?: number;
    originalTechnicalData?: {
      originalDate?: string;
      codec?: string;
      profile?: string;
      fps?: number;
      bitrateKbps?: number;
      fileSizeBytes?: number;
      durationSeconds?: number;
      width?: number;
      height?: number;
      audioCodec?: string;
      container?: string;
    };
  };
}

export interface SerializedPhotoBlock extends Partial<PhotoBlock> {
  kind: "photo";
  id: string;
  data: {
    src: string;
    description?: string;
  };
  formatting?: {
    immersive?: boolean;
    cover?: boolean;
  };
}

export interface SerializedVideoBlock extends Partial<VideoBlock> {
  kind: "video";
  id: string;
  data:
    | {
        type: "youtube";
        href: string;
        date?: string;
      }
    | {
        type: "local";
        href: string;
        date?: string;
      };
}

export interface IBlock {
  kind: unknown;
  data: unknown;
  id: string;
  formatting?: unknown;
  _build?: unknown;
}

export type Block = PhotoBlock | TextBlock | VideoBlock;
export type SerializedBlock = SerializedPhotoBlock | SerializedTextBlock | SerializedVideoBlock;

export type Content = {
  name: string;
  title: string;
  kicker?: string;
  blocks: Block[];
  order?: number;
  cover?: { src: string };
  formatting: {
    overlay?: boolean;
    sort?: "newest-first" | "oldest-first";
  };
  _build: {
    slug: string;
    timeRange?: [string | null, string | null];
    srcdir: string;
  };
};

export interface SerializedContent {
  // TODO: Move to .data
  name: string;
  title: string;
  kicker?: string;
  blocks: SerializedBlock[];
  formatting: {
    overlay?: boolean;
    sort?: "newest-first" | "oldest-first";
  };
}

export interface V2AlbumMetadata {
  sort?: "newest-first" | "oldest-first";
  cover?: string;
  externals?: Array<VideoBlock["data"]>;
  // TODO: use EXIF for title/notes
}

export type OnEditFn = (newBlock: IBlock, newIndex?: number) => void;
export type OnDeleteFn = (index: number) => void;
