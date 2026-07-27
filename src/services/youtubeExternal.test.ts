/**
 * @jest-environment node
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  YOUTUBE_MEDIA_EXTENSION,
  buildYoutubeSidecar,
  ensureYoutubePoster,
  fetchYoutubeOembed,
  normaliseExternalDate,
  parseYoutubeVideoId,
  youtubeMediaFilename,
} from "./youtubeExternal";
import { posterPathsFor } from "./videoPoster";

describe("parseYoutubeVideoId", () => {
  it("reads the id from the embed URLs the manifests actually use", () => {
    expect(
      parseYoutubeVideoId(
        "https://www.youtube.com/embed/ycyUWULJxdU?playlist=ycyUWULJxdU&mute=1&loop=1&autoplay=1",
      ),
    ).toBe("ycyUWULJxdU");
    expect(parseYoutubeVideoId("https://www.youtube.com/embed/9bw3IL444Uo")).toBe("9bw3IL444Uo");
  });

  it("also reads watch and short-link forms", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=BtNblQcjnng")).toBe("BtNblQcjnng");
    expect(parseYoutubeVideoId("https://youtu.be/HOpplc-sZAA?t=30")).toBe("HOpplc-sZAA");
  });

  it("returns undefined for anything that is not a YouTube video", () => {
    expect(parseYoutubeVideoId("https://vimeo.com/12345")).toBeUndefined();
    expect(parseYoutubeVideoId("not a url")).toBeUndefined();
    expect(parseYoutubeVideoId("https://www.youtube.com/embed/")).toBeUndefined();
  });
});

describe("youtubeMediaFilename", () => {
  // Externals have no file on disk, so they borrow the local-video naming: one
  // synthetic filename that the poster cache, the search index path and the
  // page anchor all agree on.
  it("names an external after its video id", () => {
    expect(youtubeMediaFilename("ycyUWULJxdU")).toBe(`ycyUWULJxdU${YOUTUBE_MEDIA_EXTENSION}`);
  });
});

describe("normaliseExternalDate", () => {
  // Manifest dates carry the offset of the place they were shot; that offset
  // names the zone the wall clock is already in, so the reading is kept as
  // written — the same rule EXIF and QuickTime timestamps follow.
  it("keeps the local reading of an offset timestamp", () => {
    expect(normaliseExternalDate("2025-12-01T22:00:00+09:00")).toBe("2025-12-01T22:00:00");
    expect(normaliseExternalDate("2025-04-12T18:21:00.000+08:00")).toBe("2025-04-12T18:21:00");
  });

  it("expands a date-only value to the start of that day", () => {
    expect(normaliseExternalDate("2019-11-07")).toBe("2019-11-07T00:00:00");
  });

  it("returns undefined when there is no usable date", () => {
    expect(normaliseExternalDate(undefined)).toBeUndefined();
    expect(normaliseExternalDate("sometime last year")).toBeUndefined();
  });
});

describe("buildYoutubeSidecar", () => {
  it("records what the indexer needs to describe the clip", () => {
    const sidecar = buildYoutubeSidecar({
      videoId: "ycyUWULJxdU",
      href: "https://www.youtube.com/embed/ycyUWULJxdU",
      date: "2025-12-01T22:00:00+09:00",
      oembed: {
        title: "Kyoto, in the rain",
        author_name: "gyng",
        thumbnail_url: "https://x/y.jpg",
      },
    });

    expect(sidecar).toEqual({
      mediaKind: "video",
      provider: "youtube",
      videoId: "ycyUWULJxdU",
      href: "https://www.youtube.com/embed/ycyUWULJxdU",
      title: "Kyoto, in the rain",
      authorName: "gyng",
      capturedAtLocal: "2025-12-01T22:00:00",
    });
  });

  it("omits fields the oEmbed response did not carry", () => {
    const sidecar = buildYoutubeSidecar({
      videoId: "abcdefghijk",
      href: "https://youtu.be/abcdefghijk",
      oembed: {},
    });

    expect(sidecar.title).toBeUndefined();
    expect("title" in sidecar).toBe(false);
    expect("capturedAtLocal" in sidecar).toBe(false);
  });
});

describe("fetchYoutubeOembed", () => {
  it("asks YouTube for the video's metadata", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        title: "A clip",
        thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hq.jpg",
      }),
    }));

    const result = await fetchYoutubeOembed("abcdefghijk", { fetchImpl: fetchImpl as never });

    expect(result?.title).toBe("A clip");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("youtube.com/oembed");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("abcdefghijk");
  });

  // A build must not depend on YouTube being reachable: an unavailable lookup
  // is reported as absent so the caller can fall back to its cache.
  it("returns null when the lookup fails", async () => {
    const rejecting = jest.fn(async () => {
      throw new Error("offline");
    });
    expect(await fetchYoutubeOembed("abcdefghijk", { fetchImpl: rejecting as never })).toBeNull();

    const notFound = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await fetchYoutubeOembed("abcdefghijk", { fetchImpl: notFound as never })).toBeNull();
  });
});

describe("ensureYoutubePoster", () => {
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-youtube-"));
    return { root, publicAlbumsDir: path.join(root, "public", "data", "albums") };
  };

  const jpeg = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "albums", "test-simple", "DSCF0593.jpg"),
  );

  const options = (publicAlbumsDir: string, overrides: Record<string, unknown> = {}) => ({
    albumName: "trip",
    publicAlbumsDir,
    resolvePaths: posterPathsFor,
    sizes: [800],
    avif: { quality: 60, effort: 0 },
    fetchImpl: (async (url: string) => {
      if (String(url).includes("oembed")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            title: "A clip",
            thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hq.jpg",
          }),
        };
      }
      return { ok: true, status: 200, arrayBuffer: async () => jpeg.buffer };
    }) as never,
    ...overrides,
  });

  it("downloads the thumbnail, encodes variants, and writes a sidecar", async () => {
    const { publicAlbumsDir } = setup();

    const result = await ensureYoutubePoster(
      { type: "youtube", href: "https://www.youtube.com/embed/abcdefghijk", date: "2019-11-07" },
      options(publicAlbumsDir),
    );

    expect(result.extracted).toBe(true);
    expect(result.variantsEncoded).toBe(1);
    expect(fs.existsSync(result.paths.posterSource)).toBe(true);
    expect(fs.existsSync(result.paths.variantFor(800))).toBe(true);
    expect(result.sidecar.title).toBe("A clip");
    expect(result.sidecar.capturedAtLocal).toBe("2019-11-07T00:00:00");
    expect(result.paths.filename).toBe(`abcdefghijk${YOUTUBE_MEDIA_EXTENSION}`);
  });

  // oEmbed advertises the 480x360 thumbnail; the 1280x720 still is available at
  // a predictable URL and is what a poster deserves. It does not exist for every
  // video, hence the fallback.
  it("prefers the maximum-resolution still and falls back to the advertised one", async () => {
    const { publicAlbumsDir } = setup();
    const requested: string[] = [];

    const result = await ensureYoutubePoster(
      { type: "youtube", href: "https://www.youtube.com/embed/abcdefghijk" },
      options(publicAlbumsDir, {
        fetchImpl: (async (url: string) => {
          requested.push(String(url));
          if (String(url).includes("oembed")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                title: "A clip",
                thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
              }),
            };
          }
          if (String(url).includes("maxresdefault")) {
            return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
          }
          return { ok: true, status: 200, arrayBuffer: async () => jpeg.buffer };
        }) as never,
      }),
    );

    expect(requested.some((url) => url.includes("maxresdefault"))).toBe(true);
    expect(requested.at(-1)).toContain("hqdefault");
    expect(result.extracted).toBe(true);
  });

  it("reuses the cached poster instead of fetching again", async () => {
    const { publicAlbumsDir } = setup();
    const external = {
      type: "youtube" as const,
      href: "https://www.youtube.com/embed/abcdefghijk",
    };

    await ensureYoutubePoster(external, options(publicAlbumsDir));

    const fetchImpl = jest.fn();
    const second = await ensureYoutubePoster(
      external,
      options(publicAlbumsDir, { fetchImpl: fetchImpl as never }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(second.extracted).toBe(false);
  });

  // Being offline degrades to "no new metadata", never to a failed build.
  it("throws a described error when the thumbnail cannot be fetched at all", async () => {
    const { publicAlbumsDir } = setup();

    await expect(
      ensureYoutubePoster(
        { type: "youtube", href: "https://www.youtube.com/embed/abcdefghijk" },
        options(publicAlbumsDir, {
          fetchImpl: (async () => {
            throw new Error("offline");
          }) as never,
        }),
      ),
    ).rejects.toThrow(/offline|thumbnail/i);
  });

  it("rejects an external that is not a YouTube video", async () => {
    const { publicAlbumsDir } = setup();

    await expect(
      ensureYoutubePoster(
        { type: "youtube", href: "https://vimeo.com/12345" },
        options(publicAlbumsDir),
      ),
    ).rejects.toThrow(/video id/i);
  });
});
