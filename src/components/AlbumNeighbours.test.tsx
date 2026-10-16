/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
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

const video = (id: string): Block => ({
  kind: "video",
  id,
  data: { type: "local", href: id },
  _build: {
    src: `${id}@1920.mp4`,
    mimeType: "video/mp4",
    poster: { srcset: [{ src: `/posters/${id}@800.avif`, width: 800, height: 450 }] },
    capturedAtLocal: "2024-05-01T09:00:00",
    // The clip's own search-index row, read through the same keys a photo's is.
    tags: { colors: [[1, 2, 3]] },
  },
});

beforeEach(() => {
  // jsdom has no Response; the component only reads ok and json().
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ albums: ["newest", "middle", "oldest"].map((slug) => album(slug)) }),
  })) as unknown as typeof fetch;
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
