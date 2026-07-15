/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { PhotoStats } from "../../util/computeStats";
import { ExploreColourSection } from "./ExploreColourSection";

describe("ExploreColourSection", () => {
  it("renders colour-family totals and preserves the search link", () => {
    const stats = {
      colorCoverage: 1,
      colorStats: [{ label: "Blue", count: 6 }],
      colorFamilyExamples: [],
      colorYearRibbons: [],
    } as PhotoStats;

    render(<ExploreColourSection stats={stats} />);

    expect(screen.getByRole("heading", { name: "Colour" })).toBeTruthy();
    expect(screen.getByText("Dominant colour families")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /find photos with similar blue tones/i })
        .getAttribute("href"),
    ).toBe("/search?color=93%2C132%2C214");
  });

  it("renders representative looks, caps examples, and omits unknown-family search", () => {
    const photos = Array.from({ length: 7 }, (_value, index) => ({
      src: `/blue-${index}.jpg`,
      href: `/album/test#blue-${index}.jpg`,
      label: `Blue example ${index}`,
    }));
    const stats = {
      colorCoverage: 0.5,
      colorStats: [
        { label: "Blue", count: 6 },
        { label: "Unknown", count: 2 },
      ],
      colorFamilyExamples: [
        { label: "Blue", count: 6, sharePercent: 75, photos },
        {
          label: "Unknown",
          count: 2,
          sharePercent: 25,
          photos: [{ src: "/unknown.jpg", href: "/album/test#unknown.jpg", label: "Unknown look" }],
        },
      ],
      colorYearRibbons: [],
    } as PhotoStats;

    render(<ExploreColourSection stats={stats} />);
    expect(screen.getByText("Available for 50% of archive")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Representative colour looks" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Blue example/ })).toHaveLength(6);
    expect(screen.getByRole("img", { name: "Blue example 0" })).toHaveAttribute("loading", "lazy");
    expect(screen.queryByRole("img", { name: "Blue example 6" })).toBeNull();
    expect(screen.getByRole("img", { name: "Unknown look" })).toBeInTheDocument();
    const searchLinks = screen.getAllByRole("link", { name: "Search" });
    expect(searchLinks).toHaveLength(1);
    expect(searchLinks[0]).toHaveAttribute("href", "/search?color=93%2C132%2C214");
  });

  it("renders colour history for populated and empty years", () => {
    const stats = {
      colorCoverage: 0,
      colorStats: [],
      colorFamilyExamples: [],
      colorYearRibbons: [
        {
          label: "2024",
          total: 10,
          dominantFamily: "Blue",
          slices: [
            {
              rgb: "rgb(1, 2, 3)",
              family: "Blue",
              count: 4,
              position: 0.2,
              dateLabel: "March 2024",
              thumbSrc: "/blue.jpg",
              photoLabel: "Blue harbour",
            },
            {
              rgb: "rgb(9, 9, 9)",
              family: "Unknown",
              count: 1,
              position: 0.8,
              dateLabel: "October 2024",
              thumbSrc: "/unknown.jpg",
              photoLabel: "Unknown colour",
            },
          ],
        },
        {
          label: "2023",
          total: 0,
          dominantFamily: null,
          slices: [
            {
              rgb: "rgb(4, 5, 6)",
              family: "Red",
              count: 0,
              position: 0,
              dateLabel: "2023",
              thumbSrc: "/red.jpg",
              photoLabel: "Red scene",
            },
          ],
        },
        {
          label: "2022",
          total: 1,
          dominantFamily: "Unknown",
          slices: [],
        },
      ],
    } as PhotoStats;

    render(<ExploreColourSection stats={stats} />);
    expect(screen.getByRole("heading", { name: "Colour over time" })).toBeInTheDocument();
    expect(screen.getByTitle("Blue around 2024: 4 photos (40%)")).toHaveAttribute(
      "href",
      "/search?color=93%2C132%2C214&facet=year%3A2024",
    );
    expect(document.querySelector('img[alt="Blue harbour"]')).toHaveAttribute("loading", "lazy");
    expect(screen.getByTitle("Unknown around 2024: 1 photos (10%)")).toHaveAttribute(
      "href",
      "/search",
    );
    expect(screen.getByTitle("Red around 2023: 0 photos (0%)")).toHaveStyle({
      inlineSize: "max(3px, 100%)",
    });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("Blue", { selector: ".colorTimeSummary span:last-child" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unknown", { selector: ".colorTimeSummary span:last-child" })
        .previousElementSibling,
    ).toHaveStyle({
      backgroundColor: "var(--c-bg-contrast-light)",
    });
  });
});
