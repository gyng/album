/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { prepareVideoPosters, VIDEO_EXTENSIONS } = require("./prepare-video-posters.cjs");
const { posterPathsFor } = require("../services/videoPoster.ts");

const makeAlbums = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-poster-prep-"));
  const albumsDir = path.join(root, "albums");
  Object.entries(files).forEach(([relative, contents]) => {
    const target = path.join(albumsDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  });
  return { root, albumsDir, publicAlbumsDir: path.join(root, "public", "data", "albums") };
};

describe("prepareVideoPosters", () => {
  it("extracts a poster for every video and leaves photos alone", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/clip.mov": "video",
      "trip/still.jpg": "image",
      "other/reel.mp4": "video",
    });

    const generatePoster = jest.fn(async () => ({ extracted: true, variantsEncoded: 3 }));
    const summary = await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster });

    expect(summary.videosDiscovered).toBe(2);
    expect(summary.postersExtracted).toBe(2);
    expect(summary.failures).toEqual([]);
    expect(generatePoster.mock.calls.map(([videoPath]) => path.basename(videoPath)).sort()).toEqual(
      ["clip.mov", "reel.mp4"],
    );
  });

  it("counts an already-cached poster without re-extracting it", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({ "trip/clip.mov": "video" });

    const generatePoster = jest.fn(async () => ({ extracted: false, variantsEncoded: 0 }));
    const summary = await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster });

    expect(summary.postersExtracted).toBe(0);
    expect(summary.postersCached).toBe(1);
  });

  // A clip whose frame cannot be extracted must not take the build down with
  // it: the album page still plays the video, and the indexer reports the
  // missing poster itself.
  it("reports a failed extraction without aborting the remaining videos", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/broken.mov": "video",
      "trip/fine.mov": "video",
    });

    const generatePoster = jest.fn(async (videoPath) => {
      if (videoPath.includes("broken")) {
        throw new Error("no readable frame");
      }
      return { extracted: true, variantsEncoded: 3 };
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const summary = await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster });

    expect(summary.postersExtracted).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].message).toContain("no readable frame");
    warn.mockRestore();
  });

  it("skips test albums unless they are explicitly included", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "test-simple/clip.mov": "video",
      "trip/clip.mov": "video",
    });

    const generatePoster = jest.fn(async () => ({ extracted: true, variantsEncoded: 3 }));

    const excluded = await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster });
    expect(excluded.videosDiscovered).toBe(1);

    const included = await prepareVideoPosters({
      albumsDir,
      publicAlbumsDir,
      generatePoster,
      includeTestAlbums: true,
    });
    expect(included.videosDiscovered).toBe(2);
  });

  it("recognises video extensions case-insensitively", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/CLIP.MOV": "video",
      "trip/notes.txt": "text",
    });

    const generatePoster = jest.fn(async () => ({ extracted: true, variantsEncoded: 3 }));
    const summary = await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster });

    expect(summary.videosDiscovered).toBe(1);
    expect(VIDEO_EXTENSIONS.has(".mov")).toBe(true);
  });

  it("fetches a poster for each YouTube external declared in a v2 manifest", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/album.json": JSON.stringify({
        externals: [
          {
            type: "youtube",
            href: "https://www.youtube.com/embed/ycyUWULJxdU",
            date: "2025-12-01",
          },
          { type: "local", href: "clip.mov" },
        ],
      }),
      "trip/clip.mov": "video",
    });

    const generatePoster = jest.fn(async () => ({ extracted: true, variantsEncoded: 3 }));
    const generateExternalPoster = jest.fn(async () => ({ extracted: true, variantsEncoded: 3 }));

    const summary = await prepareVideoPosters({
      albumsDir,
      publicAlbumsDir,
      generatePoster,
      generateExternalPoster,
    });

    // The local external is the file already discovered on disk; declaring it
    // in the manifest must not queue it a second time.
    expect(summary.videosDiscovered).toBe(1);
    expect(summary.externalsDiscovered).toBe(1);
    expect(summary.externalPostersFetched).toBe(1);
    expect(generateExternalPoster).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://www.youtube.com/embed/ycyUWULJxdU" }),
      "trip",
    );
  });

  // Being offline, or YouTube being unreachable, must not stop a build.
  it("reports an external that could not be fetched and continues", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/album.json": JSON.stringify({
        externals: [{ type: "youtube", href: "https://www.youtube.com/embed/ycyUWULJxdU" }],
      }),
    });

    const generateExternalPoster = jest.fn(async () => {
      throw new Error("offline");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const summary = await prepareVideoPosters({
      albumsDir,
      publicAlbumsDir,
      generatePoster: jest.fn(),
      generateExternalPoster,
    });

    expect(summary.externalPostersFetched).toBe(0);
    expect(summary.failures).toHaveLength(1);
    warn.mockRestore();
  });

  it("ignores a malformed manifest rather than failing the pass", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/album.json": "{not json",
      "trip/clip.mov": "video",
    });

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const summary = await prepareVideoPosters({
      albumsDir,
      publicAlbumsDir,
      generatePoster: jest.fn(async () => ({ extracted: true, variantsEncoded: 3 })),
      generateExternalPoster: jest.fn(),
    });

    expect(summary.externalsDiscovered).toBe(0);
    expect(summary.postersExtracted).toBe(1);
    warn.mockRestore();
  });

  // A clip with no fix of its own borrows the place of the geotagged
  // photograph nearest to it in time — written into its sidecar, so the
  // indexer and the site both read it, and labelled as inferred.
  it("infers a clip's place from the album's nearest geotagged photograph", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/clip.mov": "video",
      "trip/near.jpg": "image",
      "trip/far.jpg": "image",
    });
    const writeSidecar = (contents) => {
      const { sidecar } = posterPathsFor(path.join(albumsDir, "trip", "clip.mov"), publicAlbumsDir);
      fs.mkdirSync(path.dirname(sidecar), { recursive: true });
      fs.writeFileSync(sidecar, JSON.stringify(contents));
      return sidecar;
    };
    let sidecar;
    const generatePoster = jest.fn(async () => {
      sidecar = writeSidecar({ mediaKind: "video", capturedAtLocal: "2025-12-01T20:15:51" });
      return { extracted: true, variantsEncoded: 0 };
    });
    const places = {
      "near.jpg": { capturedAtLocal: "2025:12:01 20:18:00", latDeg: 1.28, lngDeg: 103.85 },
      "far.jpg": { capturedAtLocal: "2025:12:01 23:00:00", latDeg: 35.6, lngDeg: 139.7 },
    };
    const readPhotoPlace = jest.fn(async (photoPath) => places[path.basename(photoPath)] ?? null);

    const summary = await prepareVideoPosters({
      albumsDir,
      publicAlbumsDir,
      generatePoster,
      readPhotoPlace,
    });

    expect(JSON.parse(fs.readFileSync(sidecar, "utf-8"))).toMatchObject({
      latDeg: 1.28,
      lngDeg: 103.85,
      locationSource: "nearby-photo",
      locationInferredFrom: { photo: "near.jpg", minutesApart: 2 },
    });
    expect(summary.locationsInferred).toBe(1);
  });

  // Reading every photograph's EXIF costs a pass over the album; a clip that
  // recorded its own place has no use for it.
  it("reads no photographs for a clip that recorded its own place", async () => {
    const { albumsDir, publicAlbumsDir } = makeAlbums({
      "trip/clip.mov": "video",
      "trip/near.jpg": "image",
    });
    const generatePoster = jest.fn(async () => {
      const { sidecar } = posterPathsFor(path.join(albumsDir, "trip", "clip.mov"), publicAlbumsDir);
      fs.mkdirSync(path.dirname(sidecar), { recursive: true });
      fs.writeFileSync(
        sidecar,
        JSON.stringify({
          mediaKind: "video",
          capturedAtLocal: "2025-12-01T20:15:51",
          latDeg: 35,
          lngDeg: 139,
          locationSource: "camera",
        }),
      );
      return { extracted: true, variantsEncoded: 0 };
    });
    const readPhotoPlace = jest.fn(async () => null);

    await prepareVideoPosters({ albumsDir, publicAlbumsDir, generatePoster, readPhotoPlace });

    expect(readPhotoPlace).not.toHaveBeenCalled();
  });

  it("returns an empty summary when there is no albums directory", async () => {
    const summary = await prepareVideoPosters({
      albumsDir: path.join(os.tmpdir(), "album-poster-prep-absent"),
      publicAlbumsDir: path.join(os.tmpdir(), "album-poster-prep-absent-public"),
      generatePoster: jest.fn(),
    });

    expect(summary.videosDiscovered).toBe(0);
    expect(summary.failures).toEqual([]);
  });
});
