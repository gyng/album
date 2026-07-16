import {
  buildMapPhotoSearchText,
  getMapPhotoHref,
  hasMapCoordinates,
  type MapSearchIndexEntry,
} from "../util/mapSearchIndex";
import { getAlbums } from "./album";

/** Builds the portable JSON payload consumed by the interactive map. */
export const loadMapSearchIndexEntries = async (): Promise<MapSearchIndexEntry[]> => {
  const albums = await getAlbums();
  const entries = albums.flatMap((album): MapSearchIndexEntry[] =>
    album.blocks.filter(hasMapCoordinates).flatMap((photo) => {
      const searchText = buildMapPhotoSearchText(photo);
      return searchText
        ? [[getMapPhotoHref(album._build.slug, photo), searchText] satisfies MapSearchIndexEntry]
        : [];
    }),
  );
  return entries;
};
