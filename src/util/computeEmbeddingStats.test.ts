import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import {
  computeVisualSamenessFromVectors,
  computeVisualSamenessStats,
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

const makeAlbum = (paths: string[]) =>
  ({
    name: "real-album",
    _build: { slug: "real-album" },
    blocks: paths.map((photoPath, index) => ({
      kind: "photo",
      id: `photo-${index}`,
      data: { src: photoPath, title: `Photo ${index}` },
      _build: { tags: { path: photoPath }, srcset: [{ src: photoPath }] },
    })),
  }) as any;

const createEmbeddingsDb = (
  rows: Array<{ path: string; model_id: string; json: string }>,
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
          const dim = (JSON.parse(row.json) as number[]).length;
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

describe("selectEmbeddingModelId", () => {
  it("prefers the v2 model when both spaces are present", () => {
    expect(selectEmbeddingModelId([V1_MODEL_ID, V2_MODEL_ID])).toBe(V2_MODEL_ID);
  });

  it("falls back to v1 when v2 is absent", () => {
    expect(selectEmbeddingModelId([V1_MODEL_ID])).toBe(V1_MODEL_ID);
  });

  it("uses any single available model when neither known id is present", () => {
    expect(selectEmbeddingModelId(["some/other-model"])).toBe(
      "some/other-model",
    );
  });

  it("returns null when no models are available", () => {
    expect(selectEmbeddingModelId([])).toBeNull();
  });
});

describe("computeVisualSamenessStats with a mixed v1/v2 database", () => {
  it("counts each photo once by filtering to a single embedding space", async () => {
    const paths = Array.from(
      { length: 30 },
      (_, index) => `../albums/real/img-${index}.jpg`,
    );
    const v2Random = makePseudoRandom(7);
    const v1Random = makePseudoRandom(99);
    const randomVector = (rng: () => number) =>
      JSON.stringify(
        normalize([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]),
      );

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
