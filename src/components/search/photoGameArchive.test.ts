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

it("joins stored local dates and coordinates to double-take photographs", async () => {
  const base = createDatabase(["google/siglip2-base-patch16-224"]);
  const database = {
    exec: (args: Parameters<typeof base.exec>[0]) => {
      if (args.sql.startsWith("SELECT path, lat_deg"))
        args.callback(["../albums/test-simple/a.jpg", 35, 139, "2024-03-22T16:55:00"]);
      else base.exec(args);
    },
  };
  const photos = await fetchPhotoGameArchive({ database: database as never, game: "double-take" });
  expect(photos[0]).toMatchObject({
    vector: [1, 0],
    location: { lat: 35, lng: 139, date: "2024-03-22T16:55:00" },
  });
});

it("loads crossword photographs from the core archive without embeddings", async () => {
  expect(
    await fetchPhotoGameArchive({ database: createDatabase([]) as never, game: "cross-exposure" }),
  ).toHaveLength(1);
});

it("joins camera-local wall clocks to hindsight photographs without embeddings", async () => {
  const base = createDatabase([]);
  const database = {
    exec: (args: Parameters<typeof base.exec>[0]) => {
      if (args.sql.startsWith("SELECT path, lat_deg"))
        args.callback(["../albums/test-simple/a.jpg", null, null, "2024-03-22T16:55:00"]);
      else base.exec(args);
    },
  };
  const photos = await fetchPhotoGameArchive({ database: database as never, game: "hindsight" });
  expect(photos).toEqual([
    expect.objectContaining({
      href: "/album/test-simple#a.jpg",
      takenAt: "2024-03-22T16:55:00",
      vector: [],
    }),
  ]);
});

it("gives every game the coordinates that let a result offer Guess Where", async () => {
  const base = createDatabase([]);
  const database = {
    exec: (args: Parameters<typeof base.exec>[0]) => {
      if (args.sql.startsWith("SELECT path, lat_deg"))
        args.callback(["../albums/test-simple/a.jpg", 35, 139, "2024-03-22T16:55:00"]);
      else base.exec(args);
    },
  };
  const [photo] = await fetchPhotoGameArchive({ database: database as never, game: "connections" });
  expect(photo).toMatchObject({ location: { lat: 35, lng: 139 } });
  expect(photo).not.toHaveProperty("takenAt");
});
