/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";

jest.mock("../util/embeddingSpaceData", () => ({
  fetchEmbeddingSpace: jest.fn(),
}));

import { ContactSheet } from "./ContactSheet";
import { fetchEmbeddingSpace } from "../util/embeddingSpaceData";

const fetchSpace = fetchEmbeddingSpace as jest.MockedFunction<typeof fetchEmbeddingSpace>;

const point = (label: string, taken?: number) => ({
  src: `/${label}.avif`,
  href: `/album/kyoto#${label}`,
  label,
  ...(taken === undefined ? {} : { taken, year: 2024 }),
  x: 0,
  y: 0,
  z: 0,
});

describe("ContactSheet", () => {
  // A canvas has no children, so the photographs in it are offered again as an
  // ordinary list — the only way in for a keyboard or a screen reader.
  it("offers every photograph as a link, in the order they were taken", async () => {
    fetchSpace.mockResolvedValue({
      points: [point("late", 3), point("early", 1), point("middle", 2)],
      clusters: [],
      axisScale: { x: 1, y: 1, z: 1 },
      atlas: null,
    });

    render(<ContactSheet />);

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(3));
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  // Undated frames go last rather than to the front: a sort that reads a
  // missing date as zero opens the sheet on whatever has no date at all.
  it("leaves the undated at the end", async () => {
    fetchSpace.mockResolvedValue({
      points: [point("undated"), point("dated", 5)],
      clusters: [],
      axisScale: { x: 1, y: 1, z: 1 },
      atlas: null,
    });

    render(<ContactSheet />);

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "dated",
      "undated",
    ]);
  });

  it("takes the section away when the payload cannot be read", async () => {
    fetchSpace.mockRejectedValue(new Error("no payload"));

    const { container } = render(<ContactSheet />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
