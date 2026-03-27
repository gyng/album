export type SearchResultRow = {
  path: string;
  album_relative_path: string;
  filename: string;
  geocode: string;
  exif: string;
  tags: string;
  colors: string;
  alt_text: string;
  critique: string;
  suggested_title: string;
  composition_critique: string;
  subject: string;
  snippet?: string;
  bm25?: number;
  similarity?: number;
  rrfScore?: number;
};
