export type SearchResultRow = {
  path: string;
  album_relative_path: string;
  filename: string;
  geocode: string;
  exif: string;
  tags: string;
  colors: string;
  alt_text: string;
  subject: string;
  snippet?: string | undefined;
  bm25?: number | undefined;
  /** Semantic/similar cosine score in the 0–1 range. */
  similarity?: number | undefined;
  /** Colour-match score already scaled to a 0–100 percentage. Kept separate
   *  from `similarity` so the tile never renders a 0–1 cosine as "0%". */
  colorMatchScore?: number | undefined;
  rrfScore?: number | undefined;
  /** "video" for a clip indexed through its poster frame; absent for photos and
   *  for databases built before videos were indexed. */
  mediaKind?: string | undefined;
  durationSeconds?: number | undefined;
  matchingColor?: [number, number, number] | undefined;
};
