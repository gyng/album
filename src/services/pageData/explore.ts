import {
  computeVisualSamenessStats,
  type VisualSamenessStats,
} from "../../util/computeEmbeddingStats";
import { computePhotoStats, type PhotoStats } from "../../util/computeStats";
import { getAlbums } from "../album";

export type ExplorePageData = {
  stats: PhotoStats;
  visualSameness: VisualSamenessStats | null;
};

export const loadExplorePageData = async (): Promise<ExplorePageData> => {
  const albums = await getAlbums();
  const stats = computePhotoStats(albums);
  // A corrupt or missing embeddings DB should remove this optional section,
  // not fail the complete static build.
  let visualSameness: VisualSamenessStats | null = null;
  try {
    visualSameness = await computeVisualSamenessStats(albums);
  } catch (error) {
    console.error("Failed to compute visual sameness stats", error);
  }
  return { stats, visualSameness };
};
