import { computeVisualSamenessFromVectors } from "./computeEmbeddingStats";

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
