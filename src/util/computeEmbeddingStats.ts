import fs from "node:fs";
import path from "node:path";
import { Content, PhotoBlock } from "../services/types";
import { measureBuild } from "../services/buildTiming";

const sqlite3 = require("sqlite3");

const MIN_EMBEDDING_SAMPLE = 24;
const HIGH_SIMILARITY_THRESHOLD = 0.9;
const LOW_SIMILARITY_THRESHOLD = 0.75;
const IDENTICAL_SIMILARITY_THRESHOLD = 0.9999;
const MAX_VISUAL_EXAMPLES = 24;
const MAX_AVERAGE_EXAMPLES = 12;
const MAX_OUTLIER_EXAMPLES = 12;
const MAX_VISUAL_ERAS = 6;
const DEFAULT_EMBEDDINGS_DB_PATH = path.join(
  process.cwd(),
  "public",
  "search-embeddings.sqlite",
);
const FALLBACK_EMBEDDINGS_DB_PATH = path.join(
  process.cwd(),
  "public",
  "search.sqlite",
);

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
};

type EmbeddingRow = {
  path: string;
  embedding_json: string;
};

type PhotoLookup = Map<string, VisualSamenessPhoto>;
type PhotoDateLookup = Map<string, Date>;

const normalizeVector = (vector: number[]): number[] => {
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    norm += vector[index] * vector[index];
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
    total += left[index] * right[index];
  }
  return total;
};

const isTestAlbum = (album: Content): boolean =>
  album.name.startsWith("test-") || album._build.slug.startsWith("test-");

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

      const score = dotProduct(vector, vectors[targetIndex]);
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
    nearestScores.filter((score) => score < LOW_SIMILARITY_THRESHOLD).length /
    nearestScores.length;

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
      const indexedPath = photo._build?.tags?.path;
      const thumbSrc = photo._build?.srcset?.[0]?.src ?? photo.data.src;
      if (!indexedPath || !thumbSrc) {
        return;
      }

      lookup.set(indexedPath, {
        path: indexedPath,
        src: thumbSrc,
        href: `/album/${album._build.slug}#${photo.id ?? photo.data.src}`,
        label: photo.data.title ?? path.basename(photo.data.src),
      });
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
      const indexedPath = photo._build?.tags?.path;
      const raw = photo._build?.exif?.DateTimeOriginal;
      if (!indexedPath || !raw) {
        return;
      }

      const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
      const date = new Date(normalized);
      if (!Number.isNaN(date.getTime())) {
        lookup.set(indexedPath, date);
      }
    });
  });

  return lookup;
};

const openReadonlyDatabase = (dbPath: string) =>
  new Promise<any>((resolve, reject) => {
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READONLY,
      (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(db);
      },
    );
  });

const closeDatabase = (db: any) =>
  new Promise<void>((resolve) => {
    db.close(() => resolve());
  });

const getRows = (db: any, sql: string, bind: unknown[]) =>
  new Promise<EmbeddingRow[]>((resolve, reject) => {
    db.all(sql, bind, (err: Error | null, rows: EmbeddingRow[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });

export const computeVisualSamenessStats = async (
  albums: Content[],
  dbPath = DEFAULT_EMBEDDINGS_DB_PATH,
): Promise<VisualSamenessStats | null> => {
  return measureBuild("stats.visualSameness", async () => {
    const resolvedDbPath =
      fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0
        ? dbPath
        : fs.existsSync(FALLBACK_EMBEDDINGS_DB_PATH) &&
            fs.statSync(FALLBACK_EMBEDDINGS_DB_PATH).size > 0
          ? FALLBACK_EMBEDDINGS_DB_PATH
          : null;

    if (!resolvedDbPath) {
      return null;
    }

    const photoLookup = buildPhotoLookup(albums);
    const photoDateLookup = buildPhotoDateLookup(albums);
    const candidatePaths = albums
      .filter((album) => !isTestAlbum(album))
      .flatMap((album) => album.blocks)
      .filter((block): block is PhotoBlock => block.kind === "photo")
      .map((photo) => photo._build?.tags?.path)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const selectedPaths = Array.from(new Set(candidatePaths));
    if (selectedPaths.length < MIN_EMBEDDING_SAMPLE) {
      return null;
    }

    const db = await openReadonlyDatabase(resolvedDbPath);

    try {
      const tables = await getRows(
        db,
        "SELECT name as path, '' as embedding_json FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
        [],
      );
      if (tables.length === 0) {
        return null;
      }

      const placeholders = selectedPaths.map(() => "?").join(", ");
      const rows = await getRows(
        db,
        `SELECT path, embedding_json FROM embeddings WHERE path IN (${placeholders})`,
        selectedPaths,
      );

      const parsedRows = rows.flatMap((row) => {
        try {
          const parsed = JSON.parse(row.embedding_json);
          return Array.isArray(parsed)
            ? [{ path: row.path, vector: parsed as number[] }]
            : [];
        } catch {
          return [];
        }
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

          const score = dotProduct(source.vector, parsedRows[targetIndex].vector);
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
        validNearest.reduce((sum, item) => sum + item.nearestScore, 0) /
        validNearest.length;
      const repeatedMotifPercent =
        validNearest.filter((item) => item.nearestScore >= HIGH_SIMILARITY_THRESHOLD)
          .length / validNearest.length;
      const distinctPercent =
        validNearest.filter((item) => item.nearestScore < LOW_SIMILARITY_THRESHOLD)
          .length / validNearest.length;

      const repeatedExamples = Array.from(
        nearest.reduce((pairs, item) => {
          if (item.nearestIndex < 0) {
            return pairs;
          }

          const leftPath = item.path;
          const rightPath = parsedRows[item.nearestIndex]?.path;
          if (!rightPath) {
            return pairs;
          }

          const dedupeKey = [leftPath, rightPath].sort().join("::");
          const existing = pairs.get(dedupeKey);
          if (!existing || item.nearestScore > existing.similarityPercent / 100) {
            const left = photoLookup.get(leftPath);
            const right = photoLookup.get(rightPath);
            if (!left || !right) {
              return pairs;
            }

            pairs.set(dedupeKey, {
              left,
              right,
              similarityPercent: Math.round(item.nearestScore * 100),
            });
          }

          return pairs;
        }, new Map<string, {
          left: VisualSamenessPhoto;
          right: VisualSamenessPhoto;
          similarityPercent: number;
        }>()).values(),
      )
        .sort((left, right) => right.similarityPercent - left.similarityPercent)
        .slice(0, MAX_VISUAL_EXAMPLES);

      const distinctExamples = nearest
        .map((item) => {
          const photo = photoLookup.get(item.path);
          if (!photo) {
            return null;
          }

          return {
            photo,
            nearestSimilarityPercent: Math.round(item.nearestScore * 100),
          };
        })
        .filter((value): value is {
          photo: VisualSamenessPhoto;
          nearestSimilarityPercent: number;
        } => value !== null)
        .sort(
          (left, right) =>
            left.nearestSimilarityPercent - right.nearestSimilarityPercent,
        )
        .slice(0, MAX_VISUAL_EXAMPLES);

      const centroidCandidates = parsedRows.filter((row) => photoLookup.has(row.path));
      let averageExamples: VisualSamenessStats["averageExamples"] = [];
      let outlierExamples: VisualSamenessStats["outlierExamples"] = [];
      let visualEras: VisualSamenessStats["visualEras"] = [];
      let lookTimeline: VisualSamenessStats["lookTimeline"] = [];
      let lookDrift: VisualSamenessStats["lookDrift"] = null;
      if (centroidCandidates.length > 0) {
        const dimension = centroidCandidates[0]?.vector.length ?? 0;
        const centroid = new Array<number>(dimension).fill(0);

        centroidCandidates.forEach((candidate) => {
          for (let index = 0; index < dimension; index += 1) {
            centroid[index] += candidate.vector[index];
          }
        });

        const normalizedCentroid = normalizeVector(centroid);
        const centroidScores = centroidCandidates
          .map((candidate) => ({
            path: candidate.path,
            score: dotProduct(candidate.vector, normalizedCentroid),
          }));
        averageExamples = centroidScores
          .slice()
          .sort((left, right) => right.score - left.score)
          .flatMap((candidate) => {
            const photo = photoLookup.get(candidate.path);
            if (!photo) {
              return [];
            }
            return [
              {
                photo,
                centroidSimilarityPercent: Math.round(candidate.score * 100),
              },
            ];
          })
          .slice(0, MAX_AVERAGE_EXAMPLES);
        outlierExamples = centroidScores
          .slice()
          .sort((left, right) => left.score - right.score)
          .flatMap((candidate) => {
            const photo = photoLookup.get(candidate.path);
            if (!photo) {
              return [];
            }
            return [
              {
                photo,
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
          const seeds = [centroidCandidates[0]];
          while (seeds.length < Math.min(visualEraCount, centroidCandidates.length)) {
            let bestCandidate = centroidCandidates[0];
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
              nextGroups[bestIndex].push(candidate);
            });

            centroids = nextGroups.map((group, index) => {
              if (group.length === 0) {
                return centroids[index];
              }

              const nextCentroid = new Array<number>(dimension).fill(0);
              group.forEach((candidate) => {
                for (let valueIndex = 0; valueIndex < dimension; valueIndex += 1) {
                  nextCentroid[valueIndex] += candidate.vector[valueIndex];
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
            finalGroups[bestIndex].push(candidate);
          });

          visualEras = finalGroups
            .map((group, index) => {
              const clusterCentroid = centroids[index];
              const photos = group
                .map((candidate) => ({
                  candidate,
                  score: dotProduct(candidate.vector, clusterCentroid),
                }))
                .sort((left, right) => right.score - left.score)
                .flatMap((match) => {
                  const photo = photoLookup.get(match.candidate.path);
                  return photo ? [photo] : [];
                })
                .slice(0, 5);
              if (photos.length === 0) {
                return null;
              }

              return {
                label: `Era ${index + 1}`,
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
          .filter((candidate): candidate is typeof candidate & { date: Date } => candidate.date !== null)
          .sort((left, right) => left.date.getTime() - right.date.getTime());

        if (datedCandidates.length >= 24) {
          const byYear = new Map<number, typeof datedCandidates>();
          datedCandidates.forEach((candidate) => {
            const year = candidate.date.getFullYear();
            const current = byYear.get(year) ?? [];
            current.push(candidate);
            byYear.set(year, current);
          });

          lookTimeline = Array.from(byYear.entries())
            .sort((left, right) => left[0] - right[0])
            .flatMap(([year, group]) => {
              const yearCentroid = new Array<number>(dimension).fill(0);
              group.forEach((candidate) => {
                for (let index = 0; index < dimension; index += 1) {
                  yearCentroid[index] += candidate.vector[index];
                }
              });
              const normalizedYearCentroid = normalizeVector(yearCentroid);
              const photos = group
                .map((candidate) => ({
                  candidate,
                  score: dotProduct(candidate.vector, normalizedYearCentroid),
                }))
                .sort((left, right) => right.score - left.score)
                .flatMap((match) => {
                  const photo = photoLookup.get(match.candidate.path);
                  return photo ? [photo] : [];
                })
                .slice(0, 3);
              if (photos.length === 0) {
                return [];
              }

              return [
                {
                  year,
                  photos,
                  count: group.length,
                },
              ];
            });

          const bucketSize = Math.max(12, Math.floor(datedCandidates.length * 0.2));
          const early = datedCandidates.slice(0, bucketSize);
          const recent = datedCandidates.slice(-bucketSize);
          const buildCentroid = (group: typeof datedCandidates) => {
            const nextCentroid = new Array<number>(dimension).fill(0);
            group.forEach((candidate) => {
              for (let index = 0; index < dimension; index += 1) {
                nextCentroid[index] += candidate.vector[index];
              }
            });
            return normalizeVector(nextCentroid);
          };
          const earlyCentroid = buildCentroid(early);
          const recentCentroid = buildCentroid(recent);
          const earlyBest = early
            .map((candidate) => ({
              candidate,
              score: dotProduct(candidate.vector, earlyCentroid),
            }))
            .sort((left, right) => right.score - left.score)[0];
          const recentBest = recent
            .map((candidate) => ({
              candidate,
              score: dotProduct(candidate.vector, recentCentroid),
            }))
            .sort((left, right) => right.score - left.score)[0];
          if (earlyBest && recentBest) {
            lookDrift = {
              similarityPercent: Math.round(dotProduct(earlyCentroid, recentCentroid) * 100),
              firstYear: early[0]?.date.getFullYear() ?? recent[0]?.date.getFullYear(),
              lastYear:
                recent[recent.length - 1]?.date.getFullYear() ??
                early[early.length - 1]?.date.getFullYear(),
            };
          }
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
