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
  similarity?: number;
  rrfScore?: number;
  matchingColor?: [number, number, number];
};
