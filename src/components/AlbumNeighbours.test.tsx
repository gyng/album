/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AlbumNeighbours } from "./AlbumNeighbours";
import type { AlbumPreview } from "../util/pageDataTypes";
import type { Block } from "../services/types";

const album = (slug: string, blocks: Block[] = []): AlbumPreview => ({
  name: slug,
  title: `Title of ${slug}`,
  blocks,
  formatting: {},
  _build: { slug, srcdir: `../albums/${slug}` },
});

const video = (id: string, type: "local" | "youtube" = "local"): Block => ({
  kind: "video",
  id,
  data: type === "local" ? { type: "local", href: id } : { type: "youtube", href: id },
  _build: {
    src: `${id}@1920.mp4`,
    mimeType: "video/mp4",
    poster: { srcset: [{ src: `/posters/${id}@800.avif`, width: 800, height: 450 }] },
    capturedAtLocal: "2024-05-01T09:00:00",
    // The clip's own search-index row, read through the same keys a photo's is.
    tags: { colors: [[1, 2, 3]] },
  },
});

const photo = (id: string): Block => ({
  kind: "photo",
  id,
  data: { src: id },
  _build: {
    width: 800,
    height: 450,
    exif: {},
    tags: {},
    srcset: [{ src: `/posters/${id}@800.avif`, width: 800, height: 450 }],
  },
});

let playSpy: jest.SpyInstance;
let pauseSpy: jest.SpyInstance;

beforeEach(() => {
  // jsdom has no media pipeline; a preview's play() would otherwise throw
  // "Not implemented".
  playSpy = jest
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementation(() => Promise.resolve());
  pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // jsdom has no Response; the component only reads ok and json().
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ albums: ["newest", "middle", "oldest"].map((slug) => album(slug)) }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  playSpy.mockRestore();
  pauseSpy.mockRestore();
});

it("ends an album with the albums either side of it", async () => {
  render(<AlbumNeighbours slug="middle" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });
  expect(within(nav).getByText("Previous album")).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: /Previous album Title of newest/ })).toHaveAttribute(
    "href",
    "/album/newest",
  );
  expect(within(nav).getByRole("link", { name: /Next album Title of oldest/ })).toHaveAttribute(
    "href",
    "/album/oldest",
  );
});

it("shows only the next album at the start of the collection", async () => {
  render(<AlbumNeighbours slug="newest" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });
  expect(within(nav).queryByText("Previous album")).toBeNull();
  expect(within(nav).getByText("Next album")).toBeInTheDocument();
});

// A neighbouring album of clips alone still has a frame to show: the poster
// prepass addressed it by the same URLs a photograph's thumbnail uses.
it("draws a clip's poster as a neighbouring album's thumbnail", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      albums: [album("newest", [video("clip.mov")]), album("middle"), album("oldest")],
    }),
  })) as unknown as typeof fetch;

  render(<AlbumNeighbours slug="middle" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });
  const thumbnail = nav.querySelector("img");
  expect(thumbnail).toHaveAttribute("src", "/posters/clip.mov@800.avif");
  // The clip's indexed palette fills the tile before the poster loads, through
  // the same `_build.tags.colors` key a photograph's would.
  expect(thumbnail).toHaveStyle("background-color: rgb(1, 2, 3)");
});

// The poster stands for a clip, so pointing at the tile plays the clip itself —
// the file the transcoder wrote into that album's own cache.
it("plays a clip over a neighbouring album's poster on hover", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      albums: [album("newest", [video("clip.mov")]), album("middle"), album("oldest")],
    }),
  })) as unknown as typeof fetch;

  const { container } = render(<AlbumNeighbours slug="middle" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });

  // Nothing is fetched or decoded before a pointer arrives.
  expect(container.querySelector("video")).toBeNull();

  const thumbnail = nav.querySelector("img");
  if (!thumbnail) throw new Error("poster not rendered");
  // React derives onPointerEnter from the bubbling pointerover event; a native
  // pointerenter never reaches its listeners.
  fireEvent.pointerOver(thumbnail.parentElement!);

  expect(container.querySelectorAll("video")).toHaveLength(1);
  const preview = container.querySelector<HTMLVideoElement>("video");
  if (!preview) throw new Error("video element not rendered");
  expect(preview).toHaveAttribute(
    "src",
    "/data/albums/newest/.resized_videos/clip.mov%401920.mp4",
  );
  expect(preview).toHaveAttribute("preload", "none");
  expect(preview).toHaveAttribute("aria-hidden", "true");
  expect(preview.muted).toBe(true);
  expect(playSpy).toHaveBeenCalled();

  // The poster is still the element it was, in the same link, and the tile
  // still says which album it leads to.
  expect(nav.querySelector("img")).toBe(thumbnail);
  expect(thumbnail.closest("a")).toHaveAttribute("href", "/album/newest");
  expect(within(nav).getByText("Previous album")).toBeInTheDocument();

  // Leaving pauses; the element stays mounted for the next hover.
  fireEvent.pointerOut(thumbnail.parentElement!);
  expect(pauseSpy).toHaveBeenCalled();
});

// A photograph's poster is not a clip: there is nothing to play.
it("mounts no preview over a photograph's poster", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      albums: [album("newest", [photo("still.jpg")]), album("middle"), album("oldest")],
    }),
  })) as unknown as typeof fetch;

  const { container } = render(<AlbumNeighbours slug="middle" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });
  const thumbnail = nav.querySelector("img");
  if (!thumbnail) throw new Error("poster not rendered");
  fireEvent.pointerOver(thumbnail.parentElement!);

  expect(container.querySelector("video")).toBeNull();
  // Nothing was wrapped: the tile's own link is still the poster's parent.
  expect(thumbnail.parentElement?.tagName).toBe("A");
});

// A YouTube external has a poster frame but no transcoded file behind it, so it
// must stay a poster however it is pointed at.
it("mounts no preview over a YouTube external's poster", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      albums: [
        album("newest", [video("ycyUWULJxdU.youtube", "youtube")]),
        album("middle"),
        album("oldest"),
      ],
    }),
  })) as unknown as typeof fetch;

  const { container } = render(<AlbumNeighbours slug="middle" />);
  const nav = await screen.findByRole("navigation", { name: "More albums" });
  const thumbnail = nav.querySelector("img");
  if (!thumbnail) throw new Error("poster not rendered");
  fireEvent.pointerOver(thumbnail.parentElement!);

  expect(container.querySelector("video")).toBeNull();
  expect(thumbnail.parentElement?.tagName).toBe("A");
});
