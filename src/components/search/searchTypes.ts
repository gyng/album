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
  snippet?: string;
  bm25?: number;
  /** Semantic/similar cosine score in the 0–1 range. */
  similarity?: number;
  /** Colour-match score already scaled to a 0–100 percentage. Kept separate
   *  from `similarity` so the tile never renders a 0–1 cosine as "0%". */
  colorMatchScore?: number;
  rrfScore?: number;
  matchingColor?: [number, number, number];
};
