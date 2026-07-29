/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import {
  ExploreFunStatsSection,
  ExploreRecentTrendsSection,
  ExploreRevisitedPlacesSection,
} from "./ExploreStorySections";

const histogramProps = jest.fn();
jest.mock("../YearSplitHistogram", () => ({
  YearSplitHistogram: (props: {
    title: string;
    data: unknown[];
    getHref: (label: string) => string;
  }) => {
    histogramProps(props);
    return <a href={props.getHref("2024")}>{props.title}</a>;
  },
}));

describe("Explore story sections", () => {
  it("renders fun-stat copy and its optional search action", () => {
    render(
      <ExploreFunStatsSection
        cards={[
          {
            label: "Colour mood",
            value: "Blue",
            detail: "Six photos lean into this family.",
            actionHref: "/search?color=blue",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: /fun stats/i })).toBeTruthy();
    expect(screen.getByText("Blue")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open in search/i }).getAttribute("href")).toBe(
      "/search?color=blue",
    );
  });

  it("renders representative fun-stat photos while omitting absent actions", () => {
    render(
      <ExploreFunStatsSection
        cards={[
          {
            label: "Longest revisit",
            value: "12 years",
            detail: "A return to the same city.",
            examples: [
              {
                year: 2012,
                src: "/old.jpg",
                href: "/album/test-simple#old.jpg",
                label: "Old harbour",
              },
              {
                year: 2024,
                src: "/new.jpg",
                href: "/album/test-simple#new.jpg",
                label: "New harbour",
              },
            ],
          },
          { label: "Plain stat", value: "4", detail: "No examples.", examples: [] },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Old harbour (2012)" })).toHaveAttribute(
      "src",
      "/old.jpg",
    );
    expect(screen.getByRole("link", { name: /Old harbour/ })).toHaveAttribute(
      "href",
      "/album/test-simple#old.jpg",
    );
    expect(screen.queryByRole("link", { name: "Open in Search" })).toBeNull();
  });

  it("shows recent-year trends with a timeline escape hatch", () => {
    histogramProps.mockClear();
    render(
      <ExploreRecentTrendsSection data={[{ label: "2024", data: [{ label: "Jan", count: 3 }] }]} />,
    );
    expect(screen.getByRole("link", { name: /Open Timeline/ })).toHaveAttribute(
      "href",
      "/timeline",
    );
    expect(screen.getByRole("link", { name: "Last 5 years" })).toHaveAttribute(
      "href",
      "/search?facet=year%3A2024",
    );
    expect(histogramProps).toHaveBeenCalledWith(expect.objectContaining({ title: "Last 5 years" }));
  });

  it("omits empty recent and revisited sections", () => {
    const trends = render(<ExploreRecentTrendsSection data={[]} />);
    expect(trends.container).toBeEmptyDOMElement();
    trends.unmount();
    const places = render(<ExploreRevisitedPlacesSection places={[]} />);
    expect(places.container).toBeEmptyDOMElement();
  });

  it("renders revisit gaps, yearly photos, and facet search links", () => {
    render(
      <ExploreRevisitedPlacesSection
        places={[
          {
            label: "Singapore",
            facetId: "location",
            facetValue: "Singapore",
            firstYear: 2020,
            lastYear: 2024,
            spanYears: 4,
            photoCount: 1_234,
            timeline: [
              {
                year: 2020,
                count: 1,
                photos: [{ src: "/2020.jpg", label: "Marina", swatch: "rgb(20, 40, 60)" }],
              },
              { year: 2023, count: 2, photos: [{ src: "/2023.jpg", label: "Gardens" }] },
              {
                year: 2024,
                count: 3,
                photos: [
                  { src: "/2024-a.jpg", label: "River" },
                  { src: "/2024-b.jpg", label: "Skyline" },
                ],
              },
            ],
            examples: [],
          },
        ]}
      />,
    );
    expect(screen.getByText(/Seen from 2020 to 2024 across 1,234 photos/)).toBeInTheDocument();
    expect(screen.getByText("1 year")).toBeInTheDocument();
    expect(screen.getByText("3 years")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "River (2024)" })).toHaveAttribute("src", "/2024-a.jpg");
    // The dominant-colour swatch backs the thumbnail while it loads.
    expect(screen.getByRole("img", { name: "Marina (2020)" })).toHaveStyle({
      backgroundColor: "rgb(20, 40, 60)",
    });
    expect(screen.getByRole("img", { name: "River (2024)" })).not.toHaveStyle({
      backgroundColor: "rgb(20, 40, 60)",
    });
    expect(screen.getByRole("link", { name: "River (2024)" })).toHaveAttribute(
      "href",
      "/search?facet=location%3ASingapore&facet=year%3A2024",
    );
    expect(screen.getByRole("link", { name: /Open in Search/ })).toHaveAttribute(
      "href",
      "/search?facet=location%3ASingapore",
    );
  });
});
