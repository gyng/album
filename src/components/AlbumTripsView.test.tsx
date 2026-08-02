/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { Content, PhotoBlock } from "../services/types";
import { AlbumTripsView } from "./AlbumTripsView";

const photo = (id: string, date: string, over: Record<string, unknown> = {}): PhotoBlock =>
  ({
    kind: "photo",
    id,
    data: { src: `/albums/trip/${id}` },
    formatting: {},
    _build: {
      width: 100,
      height: 100,
      exif: { DateTimeOriginal: date },
      tags: { geocode: "JP\nTakayama\nGifu\nGifu\nJapan" },
      srcset: [{ src: `/r/${id}.avif`, width: 100, height: 100 }],
      ...over,
    },
  }) as unknown as PhotoBlock;

const album = (blocks: PhotoBlock[]): Content =>
  ({
    name: "trip",
    title: "trip",
    blocks,
    formatting: {},
    _build: { slug: "trip", srcdir: "../albums/trip" },
  }) as unknown as Content;

describe("AlbumTripsView", () => {
  it("splits an album into the journeys it actually contains", () => {
    render(
      <AlbumTripsView
        album={album([
          photo("a.jpg", "2016:11:13 10:00:00"),
          photo("b.jpg", "2016:11:14 10:00:00"),
          photo("c.jpg", "2024:05:01 10:00:00"),
        ])}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getByText(/2 days/)).toBeInTheDocument();
  });

  it("lists each day with its own photographs", () => {
    render(
      <AlbumTripsView
        album={album([
          photo("a.jpg", "2016:11:13 10:00:00"),
          photo("b.jpg", "2016:11:13 18:00:00"),
          photo("c.jpg", "2016:11:14 10:00:00"),
        ])}
      />,
    );

    expect(screen.getByText("13 November 2016")).toBeInTheDocument();
    expect(screen.getByText("14 November 2016")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  // The whole point of the view: every photo stays reachable, so the toggle
  // never hides anything the grid would have shown.
  it("keeps every dated photograph in the album", () => {
    const blocks = Array.from({ length: 7 }, (_, i) =>
      photo(`p${i}.jpg`, `2016:11:1${i} 10:00:00`),
    );
    render(<AlbumTripsView album={album(blocks)} />);

    expect(screen.getAllByRole("img")).toHaveLength(7);
  });

  it("says so when nothing in the album carries a date", () => {
    render(<AlbumTripsView album={album([photo("a.jpg", "")])} />);

    expect(screen.getByText(/no dated photographs/i)).toBeInTheDocument();
  });
});
