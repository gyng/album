/**
 * Scene rows: one extracted minute of a clip, indexed under the clip's own name
 * plus the offset it came from (`clip.mov@t120`). The convention is shared by
 * the database path, the cached frame and the site's `@<size>.avif` URLs, so
 * this is the one place that has to know how to read it apart again.
 */

const SCENE_SUFFIX_PATTERN = /@t(\d+(?:\.\d+)?)$/;

export const sceneSecondsOf = (path: string): number | undefined => {
  const match = SCENE_SUFFIX_PATTERN.exec(path);
  return match ? Number(match[1]) : undefined;
};

/** The clip a row belongs to; anything that is not a scene is its own clip. */
export const clipPathOf = (path: string): string => path.replace(SCENE_SUFFIX_PATTERN, "");

/**
 * Reduce a ranking to one entry per clip, keeping whichever moment ranked
 * highest. A twenty-minute video has twenty scenes, and without this a single
 * clip would fill a page of results with near-identical frames of itself.
 * Ranking order is preserved, so this is only ever a removal.
 */
export const collapseSceneRanking = <T extends { path: string }>(ranked: T[]): T[] => {
  const seen = new Set<string>();
  const collapsed: T[] = [];
  for (const entry of ranked) {
    const clip = clipPathOf(entry.path);
    if (seen.has(clip)) {
      continue;
    }
    seen.add(clip);
    collapsed.push(entry);
  }
  return collapsed;
};
