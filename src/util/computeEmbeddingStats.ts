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
      };
    } finally {
      await closeDatabase(db);
    }
  });
};
