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

describe("SearchResultTile", () => {
  it("calls onFindSimilar when the similar button is clicked", () => {
    const onFindSimilar = jest.fn();

    render(
      <SearchResultTile
        result={{
          path: "../albums/test-simple/DSCF0593.jpg",
          album_relative_path: "/album/test-simple#DSCF0593.jpg",
          colors: "[(12, 34, 56)]",
          tags: "harbor, skyline",
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          snippet: "Harbor skyline",
          bm25: -3.5,
        }}
        onFindSimilar={onFindSimilar}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /find similar photos/i }),
    );

    expect(onFindSimilar).toHaveBeenCalledWith(
      "../albums/test-simple/DSCF0593.jpg",
    );
  });

  it("shows a visible percentage match when similarity is present", () => {
    render(
      <SearchResultTile
        result={{
          path: "../albums/test-simple/DSCF0593.jpg",
          album_relative_path: "/album/test-simple#DSCF0593.jpg",
          colors: "[(12, 34, 56)]",
          tags: "harbor, skyline",
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          snippet: "Harbor skyline",
          similarity: 0.7128,
        }}
      />,
    );

    expect(screen.getByText("71% match")).toBeTruthy();
  });
});
