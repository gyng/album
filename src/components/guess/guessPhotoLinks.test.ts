import { GUESS_PHOTO_LIMIT, guessPhotosFromParams, guessWherePath } from "./guessPhotoLinks";

const paths = Array.from({ length: 14 }, (_, i) => `../albums/test-simple/${i} ü.jpg`);

describe("guessWherePath", () => {
  it("round-trips archive paths through the URL", () => {
    const url = new URL(guessWherePath(paths.slice(0, 3)), "https://example.org");
    expect(url.pathname).toBe("/fun/guess");
    expect(guessPhotosFromParams(url.searchParams)).toEqual(paths.slice(0, 3));
  });

  it("deals at most ten distinct photographs", () => {
    const url = new URL(guessWherePath([paths[0]!, ...paths]), "https://example.org");
    expect(url.searchParams.getAll("photos")).toEqual(paths.slice(0, GUESS_PHOTO_LIMIT));
  });
});

describe("guessPhotosFromParams", () => {
  it("ignores anything that is not an archive photograph path", () => {
    const params = new URLSearchParams();
    for (const value of [
      "../albums/a/one.jpg",
      "",
      "https://example.org/x.jpg",
      "../albums/../secret.jpg",
      "../albums/a",
      "../albums/a/one.jpg",
      "../albums/b/two.jpg",
    ])
      params.append("photos", value);
    expect(guessPhotosFromParams(params)).toEqual(["../albums/a/one.jpg", "../albums/b/two.jpg"]);
  });

  it("caps a hand-written link at ten photographs", () => {
    const params = new URLSearchParams(paths.map((path) => ["photos", path]));
    expect(guessPhotosFromParams(params)).toHaveLength(GUESS_PHOTO_LIMIT);
  });

  it("is empty when there is no photos parameter", () => {
    expect(guessPhotosFromParams(new URLSearchParams("seed=abc"))).toEqual([]);
  });
});
