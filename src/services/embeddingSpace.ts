import { loadEmbeddingSpacePoints, type EmbeddingSpacePoint } from "../util/computeEmbeddingStats";
import { getAlbums } from "./album";

/**
 * The portable payload behind the explore page's embedding cloud.
 *
 * A stable URL rather than page props: the cloud is a few hundred kilobytes of
 * coordinates and thumbnails that only matter once a reader scrolls to it, and
 * every other explore section would otherwise carry it in their HTML.
 */
export const loadEmbeddingSpace = async (): Promise<EmbeddingSpacePoint[]> =>
  loadEmbeddingSpacePoints(await getAlbums());
