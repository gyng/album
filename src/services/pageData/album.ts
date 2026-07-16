import { getAlbumFromName, getAlbumNames } from "../album";
import type { AlbumPageData } from "../../util/pageDataTypes";

export const loadAlbumPageData = async (slug: string): Promise<AlbumPageData> => ({
  album: await getAlbumFromName(slug),
});

export const loadAlbumPagePaths = async (): Promise<string[]> =>
  (await getAlbumNames()).map((name) => `/album/${name}`);
