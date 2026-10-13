import { indexedPathFromSrc, type EmbeddingSpaceEntry } from "./embeddingSpaceData";

export const selectCloudIndices = (
  entries: readonly EmbeddingSpaceEntry[],
  year: string,
  lens: string,
  rankedPaths: readonly string[] | null,
  limit = 40,
): Set<number> => {
  const eligible = entries.flatMap((entry, index) =>
    (!year || String(entry.year) === year) && (!lens || entry.lens === lens) ? [index] : [],
  );
  if (rankedPaths === null) return new Set(eligible);
  const byPath = new Map(eligible.map((index) => [indexedPathFromSrc(entries[index]!.src), index]));
  return new Set(
    rankedPaths
      .flatMap((path) => {
        const index = byPath.get(path);
        return index === undefined ? [] : [index];
      })
      .slice(0, limit),
  );
};
