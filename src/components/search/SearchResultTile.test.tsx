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
  critique: "",
  suggested_title: "",
  composition_critique: "",
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

  it("shows a visible percentage match when similarity is present", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.7128,
        })}
      />,
    );

    expect(screen.getByText("71% match")).toBeTruthy();
  });
});
