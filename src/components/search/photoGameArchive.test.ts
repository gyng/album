import { fetchPhotoGameArchive } from "./api";

const createDatabase = (models: string[]) => ({
  exec: ({
    sql,
    bind,
    callback,
  }: {
    sql: string;
    bind: unknown[];
    callback: (row: unknown[]) => void;
  }) => {
    if (sql.includes("FROM embeddings") && models.includes(String(bind[0]))) {
      callback(["../albums/test-simple/a.jpg", bind[0], 2, "[1,0]"]);
    }
    if (sql.includes("FROM images"))
      callback([
        "../albums/test-simple/a.jpg",
        "/album/test-simple#a.jpg",
        "a.jpg",
        "",
        "",
        "street",
        "",
        "A <b>quiet</b> city street.",
        "",
      ]);
  },
});

it("never silently uses v2 vectors for drawings from the v1 encoder", async () => {
  const database = createDatabase(["google/siglip2-base-patch16-224"]);
  expect(await fetchPhotoGameArchive({ database: database as never, game: "blind-frame" })).toEqual(
    [],
  );
  expect(await fetchPhotoGameArchive({ database: database as never, game: "relay" })).toHaveLength(
    1,
  );
});

it("uses the separate embeddings database and removes markup from hidden prompts", async () => {
  const photos = await fetchPhotoGameArchive({
    database: createDatabase([]) as never,
    embeddingsDatabase: createDatabase(["google/siglip-base-patch16-224"]) as never,
    game: "blind-frame",
  });
  expect(photos[0]).toMatchObject({ caption: "A quiet city street.", vector: [1, 0] });
});

it("loads oracle photographs without requiring embeddings", async () => {
  expect(
    await fetchPhotoGameArchive({ database: createDatabase([]) as never, game: "oracle" }),
  ).toHaveLength(1);
});
