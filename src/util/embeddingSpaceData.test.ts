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
    await expect(fetchEmbeddingSpace(respond({ points: [point] }))).resolves.toEqual([point]);
  });

  // A build with no embeddings database publishes an empty cloud rather than
  // failing, so the reader gets a section that says so rather than a crash.
  it("reads an empty or malformed payload as an empty cloud", async () => {
    await expect(fetchEmbeddingSpace(respond({ points: [] }))).resolves.toEqual([]);
    await expect(fetchEmbeddingSpace(respond({}))).resolves.toEqual([]);
    await expect(
      fetchEmbeddingSpace(respond({ points: [{ src: "/a.avif" }, null, 4] })),
    ).resolves.toEqual([]);
  });

  it("reports a response that never arrived", async () => {
    await expect(fetchEmbeddingSpace(respond(null, false, 404))).rejects.toThrow(/404/);
  });
});
