import type { AlbumPreview } from "./pageDataTypes";

export const ALBUMS_URL = "/data/albums.json";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Every album as a card, in the home page's order. */
export const fetchAlbumPreviews = async (
  fetcher: FetchLike = (input, init) => fetch(input, init),
): Promise<AlbumPreview[]> => {
  // A deploy changes the list, so never trust a stored copy without asking.
  const response = await fetcher(ALBUMS_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load the album list (${response.status})`);
  const payload = (await response.json()) as { albums?: unknown };
  return Array.isArray(payload.albums)
    ? (payload.albums as AlbumPreview[]).filter(
        (album) => typeof album?._build?.slug === "string" && Array.isArray(album.blocks),
      )
    : [];
};

export type AlbumNeighbours = { previous?: AlbumPreview; next?: AlbumPreview };

/** The albums either side of `slug`; none past either end, nor for an unknown album. */
export const albumNeighbours = (albums: readonly AlbumPreview[], slug: string): AlbumNeighbours => {
  const index = albums.findIndex((album) => album._build.slug === slug);
  if (index < 0) return {};
  const previous = albums[index - 1];
  const next = albums[index + 1];
  return { ...(previous ? { previous } : {}), ...(next ? { next } : {}) };
};
