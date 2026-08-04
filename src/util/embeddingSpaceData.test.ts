import { EMBEDDING_SPACE_URL, fetchEmbeddingSpace } from "./embeddingSpaceData";

const point = { src: "/a.avif", href: "/album/a#1", label: "A", x: 0.1, y: 0.2, z: 0.3 };

const respond = (payload: unknown, ok = true, status = 200) =>
  jest.fn(async () => ({ ok, status, json: async () => payload }));

describe("fetchEmbeddingSpace", () => {
  it("asks for the payload fresh, because a deploy replaces it", async () => {
    const fetcher = respond({ points: [point] });

    await fetchEmbeddingSpace(fetcher);

    expect(fetcher).toHaveBeenCalledWith(EMBEDDING_SPACE_URL, { cache: "no-store" });
  });

  it("returns the points it was given", async () => {
    await expect(fetchEmbeddingSpace(respond({ points: [point] }))).resolves.toEqual({
      points: [point],
      clusters: [],
      atlas: null,
    });
  });

  it("takes the cluster labels, and drops any that are not labels", () => {
    const cluster = { x: 0.1, y: 0, z: 0, label: "waterfall", count: 40 };

    return expect(
      fetchEmbeddingSpace(respond({ points: [point], clusters: [cluster, { x: 1 }, null] })),
    ).resolves.toMatchObject({ clusters: [cluster] });
  });

  // Without a sheet the cloud still draws — in dominant colours — so a payload
  // that has none is not an error.
  it("takes the contact sheet when there is one, and copes when there is not", async () => {
    const atlas = { cell: 48, sheet: 2048, perSheet: 1764, files: ["/data/a-0.avif"] };

    await expect(fetchEmbeddingSpace(respond({ points: [point], atlas }))).resolves.toMatchObject({
      atlas,
    });
    await expect(
      fetchEmbeddingSpace(respond({ points: [point], atlas: { cell: 48 } })),
    ).resolves.toMatchObject({ atlas: null });
  });

  // A build with no embeddings database publishes an empty cloud rather than
  // failing, so the reader gets a section that says so rather than a crash.
  it("reads an empty or malformed payload as an empty cloud", async () => {
    await expect(fetchEmbeddingSpace(respond({ points: [] }))).resolves.toEqual({
      points: [],
      clusters: [],
      atlas: null,
    });
    await expect(fetchEmbeddingSpace(respond({}))).resolves.toMatchObject({ points: [] });
    await expect(
      fetchEmbeddingSpace(respond({ points: [{ src: "/a.avif" }, null, 4] })),
    ).resolves.toMatchObject({ points: [] });
  });

  it("reports a response that never arrived", async () => {
    await expect(fetchEmbeddingSpace(respond(null, false, 404))).rejects.toThrow(/404/);
  });
});
