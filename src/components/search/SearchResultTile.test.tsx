/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchResultTile } from "./SearchResultTile";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const makeResult = (overrides: Record<string, unknown> = {}) => ({
  path: "../albums/test-simple/DSCF0593.jpg",
  album_relative_path: "/album/test-simple#DSCF0593.jpg",
  filename: "DSCF0593.jpg",
  geocode: "",
  exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
  tags: "harbor, skyline",
  colors: "[(12, 34, 56)]",
  alt_text: "",
  subject: "",
  ...overrides,
});

describe("SearchResultTile", () => {
  it("uses the snippet as image alt text without rendering a visible caption", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: 'Harbor <i class="snippet">skyline</i>',
          bm25: -3.5,
        })}
      />,
    );

    expect(screen.getByAltText("Harbor skyline")).toBeTruthy();
    expect(screen.queryByText("Harbor skyline")).toBeNull();
  });

  it("calls onFindSimilar when the similar button is clicked", () => {
    const onFindSimilar = jest.fn();

    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.7128,
          bm25: -3.5,
        })}
        onFindSimilar={onFindSimilar}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /find similar photos/i }),
    );

    expect(onFindSimilar).toHaveBeenCalledWith(
      "../albums/test-simple/DSCF0593.jpg",
      0.7128,
    );
  });

  it("calls onSearchByColor when the photo color button is clicked", () => {
    const onSearchByColor = jest.fn();

    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          matchingColor: [12, 34, 56],
        })}
        onSearchByColor={onSearchByColor}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /use this photo's colour/i }),
    );

    expect(onSearchByColor).toHaveBeenCalledWith([12, 34, 56]);
  });

  it("keeps the color action visibly marked when requested", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          matchingColor: [12, 34, 56],
        })}
        onSearchByColor={jest.fn()}
        persistColorAction
      />,
    );

    expect(
      screen.getByRole("button", { name: /use this photo's colour/i }).className,
    ).toContain("actionButtonPersistent");
  });

  it("shows a visible percentage match when similarity is present", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.7128,
        })}
      />,
    );

    expect(screen.getByText("71%")).toBeTruthy();
  });

  it("shows a colour match percentage without multiplying it again", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 86.25,
          matchingColor: [12, 34, 56],
        })}
      />,
    );

    expect(screen.getByText("86%").getAttribute("title")).toBe(
      "Colour match score 86%",
    );
  });

  it("shows a hybrid tooltip breakdown when semantic and keyword scores are both present", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.7128,
          bm25: -3.5,
          rrfScore: 0.0312,
        })}
      />,
    );

    expect(screen.getByText("31").getAttribute("title")).toBe(
      "Hybrid search: semantic 71%, keyword 3.5, fused score 0.031 (31)",
    );
  });

  it("shows a hybrid title breakdown even when one fused source is missing", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.7128,
          rrfScore: 0.0312,
        })}
      />,
    );

    expect(screen.getByText("31").getAttribute("title")).toBe(
      "Hybrid search: semantic 71%, keyword n/a, fused score 0.031 (31)",
    );
  });
});
