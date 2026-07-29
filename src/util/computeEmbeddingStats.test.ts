import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  computeVisualSamenessFromVectors,
  computeVisualSamenessStats,
  deriveEraLabel,
  selectEmbeddingModelId,
} from "./computeEmbeddingStats";

const sqlite3 = require("sqlite3");

const V1_MODEL_ID = "google/siglip-base-patch16-224";
const V2_MODEL_ID = "google/siglip2-base-patch16-224";

const normalize = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
};

// Deterministic LCG so the generated vectors (and hence the stats) are stable.
const makePseudoRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
};

const makeAlbum = (
  paths: string[],
  tagsForPath?: (index: number) => string[],
  dateForPath?: (index: number) => string | undefined,
) =>
  ({
    name: "real-album",
    _build: { slug: "real-album" },
    blocks: paths.map((photoPath, index) => ({
      kind: "photo",
      id: `photo-${index}`,
      data: { src: photoPath, title: `Photo ${index}` },
      _build: {
        tags: {
          path: photoPath,
          tags: tagsForPath?.(index),
          ...(index === 0 ? {} : { colors: [[40, 80, 120]] }),
        },
        srcset: [{ src: photoPath }],
        exif: dateForPath?.(index) ? { DateTimeOriginal: dateForPath(index) } : {},
      },
    })),
  }) as any;

const createEmbeddingsDb = (
  rows: Array<{ path: string; model_id: string; json: string | null }>,
): Promise<string> => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-"));
  const dbPath = nodePath.join(dir, "search-embeddings.sqlite");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }
      db.serialize(() => {
        db.run(
          "CREATE TABLE embeddings (path TEXT, model_id TEXT, embedding_dim INTEGER, embedding_json TEXT)",
        );
        const stmt = db.prepare(
          "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?)",
        );
        rows.forEach((row) => {
          let parsed: unknown;
          try {
            parsed = typeof row.json === "string" ? JSON.parse(row.json) : null;
          } catch {
            parsed = null;
          }
          const dim = Array.isArray(parsed) ? parsed.length : 0;
          stmt.run(row.path, row.model_id, dim, row.json);
        });
        stmt.finalize((finalizeErr: Error | null) => {
          if (finalizeErr) {
            reject(finalizeErr);
            return;
          }
          db.close((closeErr: Error | null) => {
            if (closeErr) {
              reject(closeErr);
              return;
            }
            resolve(dbPath);
          });
        });
      });
    });
  });
};

const quantiseToInt8 = (vector: number[]): { blob: Buffer; scale: number } => {
  const scale = Math.max(...vector.map(Math.abs)) / 127 || 1;
  const bytes = Int8Array.from(
    vector.map((value) => Math.max(-127, Math.min(127, Math.round(value / scale)))),
  );
  return { blob: Buffer.from(bytes.buffer), scale };
};

const createBlobEmbeddingsDb = (
  rows: Array<{ path: string; model_id: string; json: string; scale?: number | null }>,
): Promise<string> => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-blob-"));
  const dbPath = nodePath.join(dir, "search-embeddings.sqlite");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }
      db.serialize(() => {
        db.run(
          "CREATE TABLE embeddings (path TEXT, model_id TEXT, embedding_dim INTEGER, embedding_blob BLOB, embedding_scale REAL)",
        );
        const stmt = db.prepare(
          "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) VALUES (?, ?, ?, ?, ?)",
        );
        rows.forEach((row) => {
          const vector = JSON.parse(row.json) as number[];
          const { blob, scale } = quantiseToInt8(vector);
          stmt.run(
            row.path,
            row.model_id,
            vector.length,
            blob,
            row.scale === undefined ? scale : row.scale,
          );
        });
        stmt.finalize((finalizeErr: Error | null) => {
          if (finalizeErr) {
            reject(finalizeErr);
            return;
          }
          db.close((closeErr: Error | null) => {
            if (closeErr) {
              reject(closeErr);
              return;
            }
            resolve(dbPath);
          });
        });
      });
    });
  });
};

const createDatabaseWithStatements = (statements: string[]): Promise<string> => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-schema-"));
  const dbPath = nodePath.join(dir, "search-embeddings.sqlite");
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }
      db.serialize(() => {
        statements.forEach((statement) => db.run(statement));
        db.close((closeErr: Error | null) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(dbPath);
        });
      });
    });
  });
};

describe("selectEmbeddingModelId", () => {
  it("prefers the v2 model when both spaces are present", () => {
    expect(selectEmbeddingModelId([V1_MODEL_ID, V2_MODEL_ID])).toBe(V2_MODEL_ID);
  });

  it("falls back to v1 when v2 is absent", () => {
    expect(selectEmbeddingModelId([V1_MODEL_ID])).toBe(V1_MODEL_ID);
  });

  it("uses any single available model when neither known id is present", () => {
    expect(selectEmbeddingModelId(["some/other-model"])).toBe("some/other-model");
  });

  it("returns null when no models are available", () => {
    expect(selectEmbeddingModelId([])).toBeNull();
  });
});

describe("computeVisualSamenessStats with a mixed v1/v2 database", () => {
  it("counts each photo once by filtering to a single embedding space", async () => {
    const paths = Array.from({ length: 30 }, (_, index) => `../albums/real/img-${index}.jpg`);
    const v2Random = makePseudoRandom(7);
    const v1Random = makePseudoRandom(99);
    const randomVector = (rng: () => number) =>
      JSON.stringify(normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]));

    const rows = [
      ...paths.map((photoPath) => ({
        path: photoPath,
        model_id: V1_MODEL_ID,
        json: randomVector(v1Random),
      })),
      ...paths.map((photoPath) => ({
        path: photoPath,
        model_id: V2_MODEL_ID,
        json: randomVector(v2Random),
      })),
    ];

    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats).not.toBeNull();
    // 30 photos, one row each — NOT 60 (which is what the un-filtered query
    // over both model spaces would have produced).
    expect(stats?.sampleSize).toBe(30);
  });

  it("reads int8 blob embeddings (current DB format)", async () => {
    const paths = Array.from({ length: 30 }, (_, index) => `../albums/real/img-${index}.jpg`);
    const rng = makePseudoRandom(7);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1])),
    }));

    const dbPath = await createBlobEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats).not.toBeNull();
    expect(stats?.sampleSize).toBe(30);
  });

  it("reads blob embeddings that omit the legacy scale", async () => {
    const paths = Array.from({ length: 30 }, (_, index) => `../albums/real/blob-${index}.jpg`);
    const rows = paths.map((photoPath, index) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(
        Array.from({ length: 30 }, (_, valueIndex) => (valueIndex === index ? 1 : 0)),
      ),
      scale: null,
    }));

    const dbPath = await createBlobEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats?.sampleSize).toBe(30);
  });
});

describe("deriveEraLabel", () => {
  it("labels a cluster with its most distinctive tags, not the most common", () => {
    // "japan" is on nearly every photo overall, so despite topping the raw
    // count inside the cluster it must lose to the cluster-specific tags.
    const clusterTags = [
      ["japan", "night", "street"],
      ["japan", "night", "street"],
      ["japan", "night", "neon"],
    ];
    const overallCounts = new Map([
      ["japan", 900],
      ["night", 4],
      ["street", 3],
      ["neon", 1],
    ]);

    expect(deriveEraLabel(clusterTags, overallCounts, "Era 1")).toBe("night · street");
  });

  it("formats underscore tags for display", () => {
    const clusterTags = [["plant_stand"], ["plant_stand"]];
    const overallCounts = new Map([["plant_stand", 2]]);

    expect(deriveEraLabel(clusterTags, overallCounts, "Era 1")).toBe("plant stand");
  });

  it("falls back when the cluster has no tags", () => {
    expect(deriveEraLabel([[], []], new Map(), "Era 3")).toBe("Era 3");
  });

  it("uses the cluster count when an overall tag count is unavailable", () => {
    expect(deriveEraLabel([["night"], ["night"]], new Map(), "Era 1")).toBe("night");
  });
});

describe("computeVisualSamenessStats boundaries", () => {
  const paths = Array.from({ length: 30 }, (_, index) => `../albums/real/boundary-${index}.jpg`);

  it("uses the default DB, the canonical fallback, and reports no available DB", async () => {
    await expect(computeVisualSamenessStats([])).resolves.toBeNull();
    await expect(
      computeVisualSamenessStats([], nodePath.join(os.tmpdir(), "does-not-exist.sqlite")),
    ).resolves.toBeNull();

    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-empty-file-"));
    const emptyPath = nodePath.join(dir, "empty.sqlite");
    fs.writeFileSync(emptyPath, "");
    await expect(computeVisualSamenessStats([], emptyPath)).resolves.toBeNull();

    const exists = jest.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      await expect(computeVisualSamenessStats([], emptyPath)).resolves.toBeNull();
    } finally {
      exists.mockRestore();
    }
  });

  it("returns null before opening SQLite when fewer than 24 paths are selected", async () => {
    const dbPath = await createEmbeddingsDb([]);
    await expect(
      computeVisualSamenessStats([makeAlbum(paths.slice(0, 23))], dbPath),
    ).resolves.toBeNull();
  });

  it("returns null when the database lacks the embeddings table", async () => {
    const dbPath = await createDatabaseWithStatements(["CREATE TABLE other (value TEXT)"]);
    await expect(computeVisualSamenessStats([makeAlbum(paths)], dbPath)).resolves.toBeNull();
  });

  it("returns null when the embeddings table has no model rows", async () => {
    const dbPath = await createEmbeddingsDb([]);
    await expect(computeVisualSamenessStats([makeAlbum(paths)], dbPath)).resolves.toBeNull();
  });

  it("ignores missing, malformed, and non-array legacy JSON vectors", async () => {
    const rows = paths.map((photoPath, index) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: index % 3 === 0 ? null : index % 3 === 1 ? "not json" : "{}",
    }));
    const dbPath = await createEmbeddingsDb(rows);
    await expect(computeVisualSamenessStats([makeAlbum(paths)], dbPath)).resolves.toBeNull();
  });

  it("rejects a path SQLite cannot open", async () => {
    const directory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-directory-"));
    await expect(computeVisualSamenessStats([makeAlbum(paths)], directory)).rejects.toBeDefined();
  });

  it("closes and rejects when a non-database file fails its first query", async () => {
    const directory = fs.mkdtempSync(nodePath.join(os.tmpdir(), "embstats-corrupt-"));
    const corruptPath = nodePath.join(directory, "corrupt.sqlite");
    fs.writeFileSync(corruptPath, "this is not sqlite");
    await expect(computeVisualSamenessStats([makeAlbum(paths)], corruptPath)).rejects.toBeDefined();
  });
});

describe("computeVisualSamenessStats derived views", () => {
  it("builds a camera-local timeline and drift comparison from dated photos", async () => {
    const paths = Array.from({ length: 60 }, (_, index) => `../albums/real/dated-${index}.jpg`);
    const rng = makePseudoRandom(41);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1])),
    }));
    const album = makeAlbum(
      paths,
      (index) => (index % 2 === 0 ? ["street"] : ["landscape"]),
      (index) =>
        index === 0
          ? "not-a-date"
          : index < 30
            ? `2020:01:${String((index % 28) + 1).padStart(2, "0")} 23:30:00`
            : `2024:12:${String((index % 28) + 1).padStart(2, "0")} 00:30:00`,
    );
    const firstPhoto = album.blocks[0] as any;
    firstPhoto.data = { src: paths[0] };
    firstPhoto._build.srcset = [];
    album.blocks.push({ kind: "text", id: "caption", data: { title: "Caption" } } as any);
    album.blocks.push({
      kind: "photo",
      id: "missing-path",
      data: { src: "/missing-path.jpg" },
      _build: { tags: {}, srcset: [], exif: {} },
    } as any);

    const nameTestAlbum = makeAlbum(paths);
    nameTestAlbum.name = "test-hidden";
    const slugTestAlbum = makeAlbum(paths);
    slugTestAlbum._build.slug = "test-hidden";
    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([album, nameTestAlbum, slugTestAlbum], dbPath);

    expect(stats?.lookTimeline.map(({ year, count }) => ({ year, count }))).toEqual([
      { year: 2020, count: 29 },
      { year: 2024, count: 30 },
    ]);
    expect(stats?.lookDrift).toEqual(expect.objectContaining({ firstYear: 2020, lastYear: 2024 }));
    expect(stats?.averageExamples).toHaveLength(12);
    expect(stats?.outlierExamples).toHaveLength(12);
    // Dominant colours ride along as swatches; photos without a palette omit
    // the field entirely.
    expect(
      stats?.averageExamples.every(
        (example) =>
          example.photo.swatch === "rgb(40, 80, 120)" || example.photo.swatch === undefined,
      ),
    ).toBe(true);
    expect(
      stats?.averageExamples.some((example) => example.photo.swatch === "rgb(40, 80, 120)"),
    ).toBe(true);
  });

  it("keeps one populated era when degenerate vectors leave other clusters empty", async () => {
    const paths = Array.from({ length: 60 }, (_, index) => `../albums/real/flat-${index}.jpg`);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify([0.5, 0]),
    }));
    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats?.visualEras).toHaveLength(1);
    expect(stats?.visualEras[0]).toEqual(expect.objectContaining({ count: 60, label: "Era 1" }));
  });

  it("normalises an exactly balanced zero centroid", async () => {
    const vectors = Array.from({ length: 12 }, (_, index) => {
      const angle = (index * Math.PI) / 12;
      const vector = [Math.cos(angle), Math.sin(angle)];
      return [vector, vector.map((value) => -value)];
    }).flat();
    const paths = vectors.map((_, index) => `../albums/real/balanced-${index}.jpg`);
    const rows = paths.map((photoPath, index) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(vectors[index]),
    }));
    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats?.sampleSize).toBe(24);
    expect(stats?.averageExamples.every((example) => example.centroidSimilarityPercent === 0)).toBe(
      true,
    );
  });

  it("skips exact duplicates while still finding the next-nearest photo", async () => {
    const base = Array.from({ length: 15 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 15;
      return normalize([Math.cos(angle), Math.sin(angle), 0.1]);
    });
    const vectors = base.flatMap((vector) => [vector, vector]);
    const paths = vectors.map((_, index) => `../albums/real/duplicate-${index}.jpg`);
    const rows = paths.map((photoPath, index) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(vectors[index]),
    }));
    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats?.sampleSize).toBe(30);
    expect(stats?.repeatedExamples.length).toBeGreaterThan(0);
  });

  it("omits an item with no usable neighbour while retaining a valid 24-photo sample", async () => {
    const vectors = [
      ...Array.from({ length: 24 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 24;
        return [Math.cos(angle), Math.sin(angle), -1];
      }),
      [0, 0, 1],
    ];
    const paths = vectors.map((_, index) => `../albums/real/mixed-${index}.jpg`);
    const rows = paths.map((photoPath, index) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(vectors[index]),
    }));
    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([makeAlbum(paths)], dbPath);

    expect(stats?.sampleSize).toBe(24);
  });

  it("returns null when exact duplicates leave fewer than 24 usable neighbours", async () => {
    const paths = Array.from({ length: 24 }, (_, index) => `../albums/real/identical-${index}.jpg`);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify([1, 0]),
    }));
    const dbPath = await createEmbeddingsDb(rows);

    await expect(computeVisualSamenessStats([makeAlbum(paths)], dbPath)).resolves.toBeNull();
  });
});

describe("visual era labels from real-build tag strings", () => {
  it("splits the comma-separated tags the search index row carries", async () => {
    // In a real build _build.tags is the raw images row, whose `tags` column
    // is a comma-separated string — not the string[] the fixture-style shape
    // suggests. Both must work.
    const paths = Array.from({ length: 60 }, (_, index) => `../albums/real/img-${index}.jpg`);
    const rng = makePseudoRandom(23);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1])),
    }));

    const album = makeAlbum(paths);
    album.blocks.forEach((block: any, index: number) => {
      block._build.tags.tags = index % 2 === 0 ? "night, street" : "beach, sea";
    });

    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats([album], dbPath);

    expect(stats?.visualEras.length).toBeGreaterThan(0);
    stats?.visualEras.forEach((era) => {
      expect(era.label).not.toMatch(/^Era \d+$/);
    });
  });
});

describe("visual era labels from cluster tags", () => {
  it("names eras from member tags instead of Era N", async () => {
    const paths = Array.from({ length: 60 }, (_, index) => `../albums/real/img-${index}.jpg`);
    const rng = makePseudoRandom(11);
    const rows = paths.map((photoPath) => ({
      path: photoPath,
      model_id: V2_MODEL_ID,
      json: JSON.stringify(normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1])),
    }));

    const dbPath = await createEmbeddingsDb(rows);
    const stats = await computeVisualSamenessStats(
      [makeAlbum(paths, (index) => (index % 2 === 0 ? ["night", "street"] : ["beach", "sea"]))],
      dbPath,
    );

    expect(stats?.visualEras.length).toBeGreaterThan(0);
    stats?.visualEras.forEach((era) => {
      expect(era.label).not.toMatch(/^Era \d+$/);
    });
  });
});

describe("computeVisualSamenessFromVectors", () => {
  it("returns null for too-small samples", () => {
    const vectors = Array.from({ length: 10 }, () => [1, 0, 0]);
    expect(computeVisualSamenessFromVectors(vectors)).toBeNull();
  });

  it("computes sameness metrics from normalized vectors", () => {
    const vectors = [
      [1, 0, 0],
      [0.99, 0.1, 0],
      [0, 1, 0],
      [0, 0.98, 0.12],
      [0, 0, 1],
      [0.1, 0, 0.99],
    ];
    const padded = [
      ...vectors,
      ...Array.from({ length: 18 }, (_, index) =>
        index % 3 === 0 ? [1, 0, 0] : index % 3 === 1 ? [0, 1, 0] : [0, 0, 1],
      ),
    ];

    const stats = computeVisualSamenessFromVectors(padded);

    expect(stats).toEqual(
      expect.objectContaining({
        sampleSize: 24,
        samenessPercent: expect.any(Number),
        repeatedMotifPercent: expect.any(Number),
        distinctPercent: expect.any(Number),
      }),
    );
    expect(stats?.samenessPercent).toBeGreaterThan(90);
    expect(stats?.repeatedMotifPercent).toBeGreaterThan(80);
    expect(stats?.distinctPercent).toBe(0);
  });
});
