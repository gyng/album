/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { AlbumNeighbours } from "./AlbumNeighbours";
import type { AlbumPreview } from "../util/pageDataTypes";

const album = (slug: string): AlbumPreview => ({
  name: slug,
  title: `Title of ${slug}`,
  blocks: [],
  formatting: {},
  _build: { slug, srcdir: `../albums/${slug}` },
});

beforeEach(() => {
  // jsdom has no Response; the component only reads ok and json().
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ albums: ["newest", "middle", "oldest"].map(album) }),
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
