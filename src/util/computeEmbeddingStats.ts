import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Content, PhotoBlock } from "../services/types";
import { measureBuild } from "../services/buildTiming";
import { rgbToString } from "./colorDistance";
import { parseExifLocalDateTime } from "./exifTime";
import { projectToThreeDimensions } from "./embeddingSpace";

// The shipped search-embeddings DB holds two embedding spaces (SigLIP v1 and
// v2), one row per photo per model. These stats must run against a single space
// or the maths averages two near-orthogonal populations (and double-counts every
// photo). Prefer v2 for image-to-image quality, fall back to v1.
const PREFERRED_EMBEDDING_MODEL_ID = "google/siglip2-base-patch16-224";
const FALLBACK_EMBEDDING_MODEL_ID = "google/siglip-base-patch16-224";

/**
 * Chooses which embedding model to use for the visual-sameness stats given the
 * model_ids actually present in the DB. Prefers v2, then v1, then any other
 * single model (deterministic first entry) so a DB with only one space still
 * works.
 */
export const selectEmbeddingModelId = (availableModelIds: string[]): string | null => {
  if (availableModelIds.includes(PREFERRED_EMBEDDING_MODEL_ID)) {
    return PREFERRED_EMBEDDING_MODEL_ID;
  }
  if (availableModelIds.includes(FALLBACK_EMBEDDING_MODEL_ID)) {
    return FALLBACK_EMBEDDING_MODEL_ID;
  }
  return availableModelIds[0] ?? null;
};

const MIN_EMBEDDING_SAMPLE = 24;
const HIGH_SIMILARITY_THRESHOLD = 0.9;
const LOW_SIMILARITY_THRESHOLD = 0.75;
const IDENTICAL_SIMILARITY_THRESHOLD = 0.9999;
const MAX_VISUAL_EXAMPLES = 24;
const MAX_AVERAGE_EXAMPLES = 12;
const MAX_OUTLIER_EXAMPLES = 12;
const MAX_VISUAL_ERAS = 6;
const DEFAULT_EMBEDDINGS_DB_PATH = path.join(process.cwd(), "public", "search-embeddings.sqlite");
const FALLBACK_EMBEDDINGS_DB_PATH = path.join(process.cwd(), "public", "search.sqlite");

export type VisualSamenessStats = {
  sampleSize: number;
  samenessPercent: number;
  repeatedMotifPercent: number;
  distinctPercent: number;
  averageNearestSimilarity: number;
  averageExamples: Array<{
    photo: VisualSamenessPhoto;
    centroidSimilarityPercent: number;
  }>;
  outlierExamples: Array<{
    photo: VisualSamenessPhoto;
    centroidSimilarityPercent: number;
  }>;
  highSimilarityThreshold: number;
  lowSimilarityThreshold: number;
  repeatedExamples: Array<{
    left: VisualSamenessPhoto;
    right: VisualSamenessPhoto;
    similarityPercent: number;
  }>;
  distinctExamples: Array<{
    photo: VisualSamenessPhoto;
    nearestSimilarityPercent: number;
  }>;
  visualEras: Array<{
    label: string;
    photos: VisualSamenessPhoto[];
    sharePercent: number;
    count: number;
  }>;
  lookTimeline: Array<{
    year: number;
    photos: VisualSamenessPhoto[];
    count: number;
  }>;
  lookDrift: {
    similarityPercent: number;
    firstYear: number;
    lastYear: number;
  } | null;
};

export type VisualSamenessPhoto = {
  path: string;
  src: string;
  href: string;
  label: string;
  /** Dominant palette colour as a CSS rgb() string, for tile backdrops. */
  swatch?: string;
};

type EmbeddingRow = {
  path: string;
  embedding_json?: string | null;
  embedding_blob?: Uint8Array;
  embedding_scale?: number;
};

type PhotoLookup = Map<string, VisualSamenessPhoto>;
type PhotoDate = {
  year: number;
  sortKey: number;
};
type PhotoDateLookup = Map<string, PhotoDate>;

const normalizeVector = (vector: number[]): number[] => {
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    // invariant: index < vector.length, so the component is defined
    const component = vector[index]!;
    norm += component * component;
  }

  if (norm === 0) {
    return vector;
  }

  const scale = 1 / Math.sqrt(norm);
  return vector.map((value) => value * scale);
};

const dotProduct = (left: number[], right: number[]): number => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    // invariant: callers pass equal-length vectors, so both are defined
    total += left[index]! * right[index]!;
  }
  return total;
};

const isTestAlbum = (album: Content): boolean =>
  album.name.startsWith("test-") || album._build.slug.startsWith("test-");

const MAX_ERA_LABEL_TAGS = 2;

/**
 * Names a visual-era cluster from its members' most DISTINCTIVE tags. Raw
 * frequency would label every cluster with gallery-wide tags (a travel
 * gallery's country tag sits on most photos), so each tag's cluster count is
 * weighted by its precision: count × (count / overall count). Ties break
 * alphabetically for determinism; underscores render as spaces.
 */
export const deriveEraLabel = (
  clusterTagLists: string[][],
  overallTagCounts: Map<string, number>,
  fallback: string,
): string => {
  const clusterCounts = new Map<string, number>();
  clusterTagLists.flat().forEach((tag) => {
    clusterCounts.set(tag, (clusterCounts.get(tag) ?? 0) + 1);
  });

  const top = Array.from(clusterCounts.entries())
    .map(([tag, count]) => ({
      tag,
      score: count * (count / (overallTagCounts.get(tag) ?? count)),
    }))
    .sort((left, right) => right.score - left.score || left.tag.localeCompare(right.tag))
    .slice(0, MAX_ERA_LABEL_TAGS)
    .map((entry) => entry.tag.replace(/_/g, " "));

  return top.length > 0 ? top.join(" · ") : fallback;
};

export const computeVisualSamenessFromVectors = (
  vectors: number[][],
): VisualSamenessStats | null => {
  if (vectors.length < MIN_EMBEDDING_SAMPLE) {
    return null;
  }

  const nearestScores = vectors.map((vector, sourceIndex) => {
    let best = -1;

    for (let targetIndex = 0; targetIndex < vectors.length; targetIndex += 1) {
      if (targetIndex === sourceIndex) {
        continue;
      }

      // invariant: targetIndex < vectors.length, so the vector is defined
      const score = dotProduct(vector, vectors[targetIndex]!);
      if (score > best) {
        best = score;
      }
    }

    return Math.max(0, best);
  });

  const averageNearestSimilarity =
    nearestScores.reduce((sum, score) => sum + score, 0) / nearestScores.length;
  const repeatedMotifPercent =
    nearestScores.filter((score) => score >= HIGH_SIMILARITY_THRESHOLD).length /
    nearestScores.length;
  const distinctPercent =
    nearestScores.filter((score) => score < LOW_SIMILARITY_THRESHOLD).length / nearestScores.length;

  return {
    sampleSize: vectors.length,
    samenessPercent: Math.round(averageNearestSimilarity * 100),
    repeatedMotifPercent: Math.round(repeatedMotifPercent * 100),
    distinctPercent: Math.round(distinctPercent * 100),
    averageNearestSimilarity,
    averageExamples: [],
    outlierExamples: [],
    highSimilarityThreshold: HIGH_SIMILARITY_THRESHOLD,
    lowSimilarityThreshold: LOW_SIMILARITY_THRESHOLD,
    repeatedExamples: [],
    distinctExamples: [],
    visualEras: [],
    lookTimeline: [],
    lookDrift: null,
  };
};

const buildPhotoLookup = (albums: Content[]): PhotoLookup => {
  const lookup: PhotoLookup = new Map();

  albums.forEach((album) => {
    if (isTestAlbum(album)) {
      return;
    }

    album.blocks.forEach((block) => {
      if (block.kind !== "photo") {
        return;
      }

      const photo = block as PhotoBlock;
      const indexedPath = photo._build.tags?.path;
      const thumbSrc = photo._build.srcset[0]?.src ?? photo.data.src;
      if (!indexedPath) {
        return;
      }

      const dominant = photo._build.tags?.colors?.[0] as [number, number, number] | undefined;
      lookup.set(indexedPath, {
        path: indexedPath,
        src: thumbSrc,
        href: `/album/${album._build.slug}#${photo.id}`,
        label: photo.data.title ?? path.basename(photo.data.src),
        ...(dominant ? { swatch: rgbToString(dominant) } : {}),
      });
    });
  });

  return lookup;
};

const buildPhotoTagLookup = (albums: Content[]): Map<string, string[]> => {
  const lookup = new Map<string, string[]>();

  albums.forEach((album) => {
    if (isTestAlbum(album)) {
      return;
    }

    album.blocks.forEach((block) => {
      if (block.kind !== "photo") {
        return;
      }

      const photo = block as PhotoBlock;
      const indexedPath = photo._build.tags?.path;
      // In a real build `_build.tags` is the raw search-index row, whose
      // `tags` column is a comma-separated string; the declared string[]
      // shape only occurs in fixtures. Accept both.
      const rawTags = photo._build.tags?.tags as string[] | string | undefined;
      const tags = Array.isArray(rawTags)
        ? rawTags
        : typeof rawTags === "string"
          ? rawTags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [];
      if (indexedPath && tags.length > 0) {
        lookup.set(indexedPath, tags);
      }
    });
  });

  return lookup;
};

const buildPhotoDateLookup = (albums: Content[]): PhotoDateLookup => {
  const lookup: PhotoDateLookup = new Map();

  albums.forEach((album) => {
    if (isTestAlbum(album)) {
      return;
    }

    album.blocks.forEach((block) => {
      if (block.kind !== "photo") {
        return;
      }

      const photo = block as PhotoBlock;
      const indexedPath = photo._build.tags?.path;
      const raw = photo._build.exif?.DateTimeOriginal;
      if (!indexedPath || !raw) {
        return;
      }

      const parsed = parseExifLocalDateTime(raw);
      if (parsed) {
        lookup.set(indexedPath, {
          year: parsed.year,
          sortKey:
            parsed.year * 100000000 +
            parsed.month * 1000000 +
            parsed.day * 10000 +
            parsed.hour * 100 +
            parsed.minute,
        });
      }
    });
  });

  return lookup;
};

// Node's built-in SQLite is synchronous; these keep their promise shape so the
// call sites read unchanged.
const openReadonlyDatabase = async (dbPath: string): Promise<DatabaseSync> =>
  new DatabaseSync(dbPath, { readOnly: true });

const closeDatabase = async (db: DatabaseSync): Promise<void> => {
  db.close();
};

const getRows = async <Row>(db: DatabaseSync, sql: string, bind: unknown[]): Promise<Row[]> =>
  db.prepare(sql).all(...(bind as any[])) as Row[];

// The embeddings table exists in two on-disk formats: int8 blobs with a
// per-vector scale (current) and JSON text (DBs written before the format
// change). Both must stay readable — the stats can run against an older
// canonical DB that has not been re-indexed yet.
const embeddingsTableHasBlobColumn = async (db: DatabaseSync): Promise<boolean> => {
  const columns = await getRows<{ name: string }>(db, "PRAGMA table_info(embeddings)", []);
  return columns.some((column) => column.name === "embedding_blob");
};

const decodeEmbeddingRow = (row: EmbeddingRow): number[] | null => {
  if (row.embedding_blob !== undefined) {
    const scale = row.embedding_scale ?? 1;
    // The blob is int8; the driver hands back an unsigned view of those bytes,
    // so reinterpret rather than reading each byte through a Buffer method.
    const signed = new Int8Array(
      row.embedding_blob.buffer,
      row.embedding_blob.byteOffset,
      row.embedding_blob.length,
    );
    return Array.from(signed, (value) => value * scale);
  }
  try {
    const parsed = JSON.parse(row.embedding_json ?? "");
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
};

/** Which album each indexed photograph came from, by its indexed path. */
const buildPhotoAlbumLookup = (albums: Content[]): Map<string, string> => {
  const lookup = new Map<string, string>();

  albums.forEach((album) => {
    if (isTestAlbum(album)) return;
    const name = album.title ?? album._build.slug;
    album.blocks.forEach((block) => {
      if (block.kind !== "photo") return;
      const indexedPath = (block as PhotoBlock)._build.tags?.path;
      if (indexedPath) lookup.set(indexedPath, name);
    });
  });

  return lookup;
};

/** The embeddings database, or the canonical one it was split out of, or neither. */
const resolveEmbeddingsDbPath = (dbPath: string): string | null => {
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) return dbPath;
  if (
    fs.existsSync(FALLBACK_EMBEDDINGS_DB_PATH) &&
    fs.statSync(FALLBACK_EMBEDDINGS_DB_PATH).size > 0
  ) {
    return FALLBACK_EMBEDDINGS_DB_PATH;
  }
  return null;
};

export const computeVisualSamenessStats = async (
  albums: Content[],
  dbPath = DEFAULT_EMBEDDINGS_DB_PATH,
): Promise<VisualSamenessStats | null> => {
  return measureBuild("stats.visualSameness", async () => {
    const resolvedDbPath = resolveEmbeddingsDbPath(dbPath);

    if (!resolvedDbPath) {
      return null;
    }

    const photoLookup = buildPhotoLookup(albums);
    const photoDateLookup = buildPhotoDateLookup(albums);
    const photoTagLookup = buildPhotoTagLookup(albums);
    const candidatePaths = albums
      .filter((album) => !isTestAlbum(album))
      .flatMap((album) => album.blocks)
      .filter((block): block is PhotoBlock => block.kind === "photo")
      .map((photo) => photo._build.tags?.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const selectedPaths = Array.from(new Set(candidatePaths));
    if (selectedPaths.length < MIN_EMBEDDING_SAMPLE) {
      return null;
    }

    const db = await openReadonlyDatabase(resolvedDbPath);

    try {
      const tables = await getRows<EmbeddingRow>(
        db,
        "SELECT name as path, '' as embedding_json FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
        [],
      );
      if (tables.length === 0) {
        return null;
      }

      // The DB may hold multiple embedding spaces (v1 + v2). Pick exactly one so
      // downstream maths runs over a single, coherent population (H7).
      const modelRows = await getRows<EmbeddingRow>(
        db,
        "SELECT DISTINCT model_id AS path, '' AS embedding_json FROM embeddings",
        [],
      );
      const selectedModelId = selectEmbeddingModelId(modelRows.map((row) => row.path));
      if (!selectedModelId) {
        return null;
      }

      const hasBlobColumn = await embeddingsTableHasBlobColumn(db);
      const embeddingColumns = hasBlobColumn ? "embedding_blob, embedding_scale" : "embedding_json";
      const placeholders = selectedPaths.map(() => "?").join(", ");
      const rows = await getRows<EmbeddingRow>(
        db,
        `SELECT path, ${embeddingColumns} FROM embeddings WHERE model_id = ? AND path IN (${placeholders})`,
        [selectedModelId, ...selectedPaths],
      );

      const parsedRows = rows.flatMap((row) => {
        const vector = decodeEmbeddingRow(row);
        return vector ? [{ path: row.path, vector }] : [];
      });

      const vectors = parsedRows.map((row) => row.vector);
      if (!computeVisualSamenessFromVectors(vectors)) {
        return null;
      }

      const nearest = parsedRows.map((source, sourceIndex) => {
        let bestScore = -1;
        let bestIndex = -1;

        for (let targetIndex = 0; targetIndex < parsedRows.length; targetIndex += 1) {
          if (targetIndex === sourceIndex) {
            continue;
          }

          // invariant: targetIndex < parsedRows.length, so the row is defined
          const score = dotProduct(source.vector, parsedRows[targetIndex]!.vector);
          if (score >= IDENTICAL_SIMILARITY_THRESHOLD) {
            continue;
          }

          if (score > bestScore) {
            bestScore = score;
            bestIndex = targetIndex;
          }
        }

        return {
          path: source.path,
          nearestIndex: bestIndex,
          nearestScore: Math.max(0, bestScore),
        };
      });

      const validNearest = nearest.filter((item) => item.nearestIndex >= 0);
      if (validNearest.length < MIN_EMBEDDING_SAMPLE) {
        return null;
      }

      const averageNearestSimilarity =
        validNearest.reduce((sum, item) => sum + item.nearestScore, 0) / validNearest.length;
      const repeatedMotifPercent =
        validNearest.filter((item) => item.nearestScore >= HIGH_SIMILARITY_THRESHOLD).length /
        validNearest.length;
      const distinctPercent =
        validNearest.filter((item) => item.nearestScore < LOW_SIMILARITY_THRESHOLD).length /
        validNearest.length;

      const repeatedExamples = Array.from(
        nearest
          .reduce(
            (pairs, item) => {
              if (item.nearestIndex < 0) {
                return pairs;
              }

              const leftPath = item.path;
              // invariant: nearestIndex >= 0 guarded above, indexing a valid row
              const rightPath = parsedRows[item.nearestIndex]!.path;

              const dedupeKey = [leftPath, rightPath].sort().join("::");
              const existing = pairs.get(dedupeKey);
              if (!existing || item.nearestScore > existing.similarityPercent / 100) {
                const left = photoLookup.get(leftPath)!;
                const right = photoLookup.get(rightPath)!;

                pairs.set(dedupeKey, {
                  left,
                  right,
                  similarityPercent: Math.round(item.nearestScore * 100),
                });
              }

              return pairs;
            },
            new Map<
              string,
              {
                left: VisualSamenessPhoto;
                right: VisualSamenessPhoto;
                similarityPercent: number;
              }
            >(),
          )
          .values(),
      )
        .sort((left, right) => right.similarityPercent - left.similarityPercent)
        .slice(0, MAX_VISUAL_EXAMPLES);

      const distinctExamples = nearest
        .map((item) => ({
          photo: photoLookup.get(item.path)!,
          nearestSimilarityPercent: Math.round(item.nearestScore * 100),
        }))
        .sort((left, right) => left.nearestSimilarityPercent - right.nearestSimilarityPercent)
        .slice(0, MAX_VISUAL_EXAMPLES);

      const centroidCandidates = parsedRows;
      let averageExamples: VisualSamenessStats["averageExamples"] = [];
      let outlierExamples: VisualSamenessStats["outlierExamples"] = [];
      let visualEras: VisualSamenessStats["visualEras"] = [];
      let lookTimeline: VisualSamenessStats["lookTimeline"] = [];
      let lookDrift: VisualSamenessStats["lookDrift"] = null;
      {
        // invariant: the sample-size guard above ensures at least one candidate
        const dimension = centroidCandidates[0]!.vector.length;
        const centroid = Array.from({ length: dimension }, () => 0);

        centroidCandidates.forEach((candidate) => {
          for (let index = 0; index < dimension; index += 1) {
            centroid[index] = (centroid[index] ?? 0) + (candidate.vector[index] ?? 0);
          }
        });

        const normalizedCentroid = normalizeVector(centroid);
        const centroidScores = centroidCandidates.map((candidate) => ({
          path: candidate.path,
          score: dotProduct(candidate.vector, normalizedCentroid),
        }));
        averageExamples = centroidScores
          .slice()
          .sort((left, right) => right.score - left.score)
          .flatMap((candidate) => {
            return [
              {
                photo: photoLookup.get(candidate.path)!,
                centroidSimilarityPercent: Math.round(candidate.score * 100),
              },
            ];
          })
          .slice(0, MAX_AVERAGE_EXAMPLES);
        outlierExamples = centroidScores
          .slice()
          .sort((left, right) => left.score - right.score)
          .flatMap((candidate) => {
            return [
              {
                photo: photoLookup.get(candidate.path)!,
                centroidSimilarityPercent: Math.round(candidate.score * 100),
              },
            ];
          })
          .slice(0, MAX_OUTLIER_EXAMPLES);

        if (centroidCandidates.length >= 48) {
          const visualEraCount = Math.min(
            MAX_VISUAL_ERAS,
            Math.max(4, Math.floor(centroidCandidates.length / 250)),
          );
          // invariant: length >= 48 guard above ensures index 0 is present
          const seeds = [centroidCandidates[0]!];
          while (seeds.length < Math.min(visualEraCount, centroidCandidates.length)) {
            let bestCandidate = centroidCandidates[0]!;
            let bestDistance = -1;
            centroidCandidates.forEach((candidate) => {
              const nearestSeed = Math.max(
                ...seeds.map((seed) => dotProduct(candidate.vector, seed.vector)),
              );
              const distance = 1 - nearestSeed;
              if (distance > bestDistance) {
                bestDistance = distance;
                bestCandidate = candidate;
              }
            });
            seeds.push(bestCandidate);
          }

          let centroids = seeds.map((seed) => seed.vector);
          for (let iteration = 0; iteration < 3; iteration += 1) {
            const nextGroups = centroids.map(() => [] as typeof centroidCandidates);
            centroidCandidates.forEach((candidate) => {
              let bestIndex = 0;
              let bestScore = -Infinity;
              centroids.forEach((clusterCentroid, index) => {
                const score = dotProduct(candidate.vector, clusterCentroid);
                if (score > bestScore) {
                  bestScore = score;
                  bestIndex = index;
                }
              });
              // invariant: bestIndex indexes a group created per centroid
              nextGroups[bestIndex]!.push(candidate);
            });

            centroids = nextGroups.map((group, index) => {
              if (group.length === 0) {
                // invariant: index aligns with the centroids array
                return centroids[index]!;
              }

              const nextCentroid = Array.from({ length: dimension }, () => 0);
              group.forEach((candidate) => {
                for (let valueIndex = 0; valueIndex < dimension; valueIndex += 1) {
                  nextCentroid[valueIndex] =
                    (nextCentroid[valueIndex] ?? 0) + (candidate.vector[valueIndex] ?? 0);
                }
              });
              return normalizeVector(nextCentroid);
            });
          }

          const finalGroups = centroids.map(() => [] as typeof centroidCandidates);
          centroidCandidates.forEach((candidate) => {
            let bestIndex = 0;
            let bestScore = -Infinity;
            centroids.forEach((clusterCentroid, index) => {
              const score = dotProduct(candidate.vector, clusterCentroid);
              if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
              }
            });
            // invariant: bestIndex indexes a group created per centroid
            finalGroups[bestIndex]!.push(candidate);
          });

          // Distinctiveness weighting in deriveEraLabel needs gallery-wide tag
          // counts, computed once over every clustered photo.
          const overallTagCounts = new Map<string, number>();
          centroidCandidates.forEach((candidate) => {
            (photoTagLookup.get(candidate.path) ?? []).forEach((tag) => {
              overallTagCounts.set(tag, (overallTagCounts.get(tag) ?? 0) + 1);
            });
          });

          visualEras = finalGroups
            .map((group, index) => {
              // invariant: finalGroups and centroids share the same length
              const clusterCentroid = centroids[index]!;
              const photos = group
                .map((candidate) => ({
                  candidate,
                  score: dotProduct(candidate.vector, clusterCentroid),
                }))
                .sort((left, right) => right.score - left.score)
                .flatMap((match) => {
                  return [photoLookup.get(match.candidate.path)!];
                })
                .slice(0, 5);
              if (photos.length === 0) {
                return null;
              }

              return {
                label: deriveEraLabel(
                  group.map((candidate) => photoTagLookup.get(candidate.path) ?? []),
                  overallTagCounts,
                  `Era ${index + 1}`,
                ),
                photos,
                count: group.length,
                sharePercent: Math.round((group.length / centroidCandidates.length) * 100),
              };
            })
            .filter((value): value is NonNullable<typeof value> => value !== null)
            .sort((left, right) => right.count - left.count)
            .slice(0, MAX_VISUAL_ERAS);
        }

        const datedCandidates = centroidCandidates
          .map((candidate) => ({
            ...candidate,
            date: photoDateLookup.get(candidate.path) ?? null,
          }))
          .filter(
            (candidate): candidate is typeof candidate & { date: Date } => candidate.date !== null,
          )
          .sort((left, right) => left.date.sortKey - right.date.sortKey);

        if (datedCandidates.length >= 24) {
          const byYear = new Map<number, typeof datedCandidates>();
          datedCandidates.forEach((candidate) => {
            const year = candidate.date.year;
            const current = byYear.get(year) ?? [];
            current.push(candidate);
            byYear.set(year, current);
          });

          lookTimeline = Array.from(byYear.entries())
            .sort((left, right) => left[0] - right[0])
            .map(([year, group]) => {
              const yearCentroid = Array.from({ length: dimension }, () => 0);
              group.forEach((candidate) => {
                for (let index = 0; index < dimension; index += 1) {
                  yearCentroid[index] = (yearCentroid[index] ?? 0) + (candidate.vector[index] ?? 0);
                }
              });
              const normalizedYearCentroid = normalizeVector(yearCentroid);
              const photos = group
                .map((candidate) => ({
                  candidate,
                  score: dotProduct(candidate.vector, normalizedYearCentroid),
                }))
                .sort((left, right) => right.score - left.score)
                .map((match) => photoLookup.get(match.candidate.path)!)
                .slice(0, 3);
              return {
                year,
                photos,
                count: group.length,
              };
            });

          const bucketSize = Math.max(12, Math.floor(datedCandidates.length * 0.2));
          const early = datedCandidates.slice(0, bucketSize);
          const recent = datedCandidates.slice(-bucketSize);
          const buildCentroid = (group: typeof datedCandidates) => {
            const nextCentroid = Array.from({ length: dimension }, () => 0);
            group.forEach((candidate) => {
              for (let index = 0; index < dimension; index += 1) {
                nextCentroid[index] = (nextCentroid[index] ?? 0) + (candidate.vector[index] ?? 0);
              }
            });
            return normalizeVector(nextCentroid);
          };
          const earlyCentroid = buildCentroid(early);
          const recentCentroid = buildCentroid(recent);
          lookDrift = {
            similarityPercent: Math.round(dotProduct(earlyCentroid, recentCentroid) * 100),
            // invariant: bucketSize >= 12 and datedCandidates.length >= 24, so
            // both buckets are non-empty
            firstYear: early[0]!.date.year,
            lastYear: recent[recent.length - 1]!.date.year,
          };
        }
      }

      return {
        sampleSize: validNearest.length,
        samenessPercent: Math.round(averageNearestSimilarity * 100),
        repeatedMotifPercent: Math.round(repeatedMotifPercent * 100),
        distinctPercent: Math.round(distinctPercent * 100),
        averageNearestSimilarity,
        averageExamples,
        outlierExamples,
        highSimilarityThreshold: HIGH_SIMILARITY_THRESHOLD,
        lowSimilarityThreshold: LOW_SIMILARITY_THRESHOLD,
        repeatedExamples,
        distinctExamples,
        visualEras,
        lookTimeline,
        lookDrift,
      };
    } finally {
      await closeDatabase(db);
    }
  });
};

/* -------------------------------------------------------------------------- */
/* The cloud                                                                   */
/* -------------------------------------------------------------------------- */

/** One photograph as a position in the collection's own embedding space. */
export type EmbeddingSpacePoint = {
  src: string;
  href: string;
  label: string;
  /** Which album it came from: a filename says nothing, and most labels are filenames. */
  album?: string;
  /** Its dominant colour, so the cloud is coloured by the photographs themselves. */
  swatch?: string;
  /** The photograph's most distinctive tag, for naming what a cluster turned out to be. */
  tag?: string;
  /** Its cell on the contact sheet, when one was built. */
  slot?: number;
  x: number;
  y: number;
  z: number;
};

/**
 * The whole collection projected into three dimensions, at build time.
 *
 * Done here rather than in the browser because the vectors are the expensive
 * part: 1,500 × 768 numbers is several megabytes of database and a second of
 * arithmetic, and the answer is the same for every reader. What ships is the
 * cloud — three numbers and a thumbnail per photograph.
 */
export const loadEmbeddingSpacePoints = async (
  albums: Content[],
  dbPath = DEFAULT_EMBEDDINGS_DB_PATH,
  slots: Record<string, number> = {},
): Promise<EmbeddingSpacePoint[]> =>
  measureBuild("stats.embeddingSpace", async () => {
    const resolvedDbPath = resolveEmbeddingsDbPath(dbPath);
    if (!resolvedDbPath) {
      return [];
    }

    const photoLookup = buildPhotoLookup(albums);
    const tagLookup = buildPhotoTagLookup(albums);
    const albumLookup = buildPhotoAlbumLookup(albums);
    const selectedPaths = [...photoLookup.keys()];
    if (selectedPaths.length < MIN_EMBEDDING_SAMPLE) {
      return [];
    }

    const db = await openReadonlyDatabase(resolvedDbPath);
    try {
      const tables = await getRows<{ path: string }>(
        db,
        "SELECT name as path FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
        [],
      );
      if (tables.length === 0) {
        return [];
      }

      const modelRows = await getRows<{ path: string }>(
        db,
        "SELECT DISTINCT model_id AS path FROM embeddings",
        [],
      );
      const selectedModelId = selectEmbeddingModelId(modelRows.map((row) => row.path));
      if (!selectedModelId) {
        return [];
      }

      const hasBlobColumn = await embeddingsTableHasBlobColumn(db);
      const embeddingColumns = hasBlobColumn ? "embedding_blob, embedding_scale" : "embedding_json";
      const placeholders = selectedPaths.map(() => "?").join(", ");
      const rows = await getRows<EmbeddingRow>(
        db,
        `SELECT path, ${embeddingColumns} FROM embeddings WHERE model_id = ? AND path IN (${placeholders})`,
        [selectedModelId, ...selectedPaths],
      );

      const decoded = rows.flatMap((row) => {
        const vector = decodeEmbeddingRow(row);
        const photo = photoLookup.get(row.path);
        return vector && photo ? [{ photo, path: row.path, vector }] : [];
      });
      if (decoded.length < MIN_EMBEDDING_SAMPLE) {
        return [];
      }

      const positions = projectToThreeDimensions(decoded.map((entry) => entry.vector));

      return decoded.map((entry, index) => {
        const position = positions[index] ?? { x: 0, y: 0, z: 0 };
        const tag = tagLookup.get(entry.path)?.[0];
        const album = albumLookup.get(entry.path);
        const slot = slots[entry.path];
        return {
          src: entry.photo.src,
          href: entry.photo.href,
          label: entry.photo.label,
          ...(album ? { album } : {}),
          ...(entry.photo.swatch ? { swatch: entry.photo.swatch } : {}),
          ...(tag ? { tag } : {}),
          ...(slot === undefined ? {} : { slot }),
          x: Number(position.x.toFixed(4)),
          y: Number(position.y.toFixed(4)),
          z: Number(position.z.toFixed(4)),
        };
      });
    } finally {
      await closeDatabase(db);
    }
  });
