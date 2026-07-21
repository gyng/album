/**
 * @jest-environment node
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

jest.mock("sharp", () => jest.fn());

const sharp = require("sharp");
const imageOptimisationConfig = require("../services/imageOptimisationConfig.json");
const { prepareOptimisedImages } = require("./prepare-optimised-images.cjs");

describe("prepareOptimisedImages", () => {
  afterEach(() => {
    sharp.mockReset();
  });

  it("preserves cached variants and generates only missing sizes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-image-prepare-"));
    const albumsDir = path.join(root, "albums");
    const publicAlbumsDir = path.join(root, "public", "data", "albums");
    const albumDir = path.join(albumsDir, "trip");
    const hiddenAlbumDir = path.join(albumsDir, "test-fixture");
    const cacheDir = path.join(publicAlbumsDir, "trip", ".resized_images");
    const source = path.join(albumDir, "photo.jpg");
    const cached = path.join(cacheDir, "photo.jpg@800.avif");

    fs.mkdirSync(albumDir, { recursive: true });
    fs.mkdirSync(hiddenAlbumDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(source, "source");
    fs.writeFileSync(path.join(hiddenAlbumDir, "hidden.jpg"), "source");
    fs.writeFileSync(cached, "keep me");

    const toFile = jest.fn(async (output) => {
      fs.writeFileSync(output, "generated");
      return { width: 800, height: 600 };
    });
    const avif = jest.fn(() => ({ toFile }));
    const resize = jest.fn(() => ({ avif }));
    const clone = jest.fn(() => ({ resize }));
    const rotate = jest.fn(() => ({ clone }));
    sharp.mockReturnValue({ rotate });

    const summary = await prepareOptimisedImages({
      albumsDir,
      publicAlbumsDir,
      jobs: 1,
      includeTestAlbums: false,
    });

    expect(summary).toMatchObject({
      photosDiscovered: 1,
      photosEncoded: 1,
      variantsEncoded: 2,
      variantsCached: 1,
    });
    expect(fs.readFileSync(cached, "utf8")).toBe("keep me");
    expect(sharp).toHaveBeenCalledTimes(1);
    expect(sharp).toHaveBeenCalledWith(source);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(clone).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(avif).toHaveBeenCalledTimes(2);
    expect(avif).toHaveBeenCalledWith(imageOptimisationConfig.avif);
  });
});
