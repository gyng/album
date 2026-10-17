import {
  buildMapPhotoSearchText,
  getMapPhotoHref,
  hasMapCoordinates,
  type MapSearchIndexEntry,
} from "../util/mapSearchIndex";
import { toVideoBlockEntry } from "../util/videoBlockEntry";
import { videoBlockAsPhotoBlock } from "../util/videoBlockMedia";
import { getAlbums } from "./album";

/** Builds the portable JSON payload consumed by the interactive map. */
export const loadMapSearchIndexEntries = async (): Promise<MapSearchIndexEntry[]> => {
  const albums = await getAlbums();
  const entries = albums.flatMap((album): MapSearchIndexEntry[] => [
    // A geotagged clip is a pin like any other, so map search has to be able to
    // find it — by its filename, and by everything its indexed row and its
    // camera say, read exactly as a photograph's are.
    ...album.blocks.flatMap((block): MapSearchIndexEntry[] => {
      const video = toVideoBlockEntry(block);
      if (!video || video.decLat === null || video.decLng === null) return [];
      const asPhoto = videoBlockAsPhotoBlock(block);
      return [
        [
          `/album/${album._build.slug}#${encodeURIComponent(video.anchor)}`,
          [video.anchor, asPhoto ? buildMapPhotoSearchText(asPhoto) : ""].filter(Boolean).join(" "),
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
