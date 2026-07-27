import {
  buildMapPhotoSearchText,
  getMapPhotoHref,
  hasMapCoordinates,
  type MapSearchIndexEntry,
} from "../util/mapSearchIndex";
import { toVideoBlockEntry } from "../util/videoBlockEntry";
import { getAlbums } from "./album";

/** Builds the portable JSON payload consumed by the interactive map. */
export const loadMapSearchIndexEntries = async (): Promise<MapSearchIndexEntry[]> => {
  const albums = await getAlbums();
  const entries = albums.flatMap((album): MapSearchIndexEntry[] => [
    // A geotagged clip is a pin like any other, so map search has to be able to
    // find it. Its filename is all the searchable text a local clip has.
    ...album.blocks.flatMap((block): MapSearchIndexEntry[] => {
      const video = toVideoBlockEntry(block);
      if (!video || video.decLat === null || video.decLng === null) return [];
      return [
        [
          `/album/${album._build.slug}#${encodeURIComponent(video.anchor)}`,
          video.anchor,
        ] satisfies MapSearchIndexEntry,
      ];
    }),
    ...album.blocks.filter(hasMapCoordinates).flatMap((photo) => {
      const searchText = buildMapPhotoSearchText(photo);
      return searchText
        ? [[getMapPhotoHref(album._build.slug, photo), searchText] satisfies MapSearchIndexEntry]
        : [];
    }),
  ]);
  return entries;
};
