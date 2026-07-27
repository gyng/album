/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchResultTile } from "./SearchResultTile";

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

  // A video result looks exactly like a photo — its thumbnail is the frame
  // extracted from it — so without a marker there is nothing to tell a viewer
  // that clicking through gets them something that plays.
  it("marks a video result as playable and gives its length", () => {
    render(
      <SearchResultTile
        result={makeResult({
          path: "../albums/test-simple/DSCF0159.MOV",
          album_relative_path: "/album/test-simple#DSCF0159.MOV",
          filename: "DSCF0159.MOV",
          mediaKind: "video",
          durationSeconds: 73.4,
        })}
      />,
    );

    expect(screen.getByLabelText("Video, 1:13")).toBeTruthy();
    expect(screen.getByText("1:13")).toBeTruthy();
  });

  it("still marks a video whose length is unknown", () => {
    render(
      <SearchResultTile
        result={makeResult({
          path: "../albums/test-simple/clip.mov",
          mediaKind: "video",
        })}
      />,
    );

    expect(screen.getByLabelText("Video")).toBeTruthy();
  });

  // A hit on a moment inside a clip has to say which moment, or the viewer has
  // no idea why this frame came back or where to find it.
  it("names the moment a scene result came from", () => {
    render(
      <SearchResultTile
        result={makeResult({
          path: "../albums/test-simple/clip.mov@t180",
          album_relative_path: "/album/test-simple?t=180#clip.mov",
          filename: "clip.mov@t180",
          mediaKind: "video",
          durationSeconds: 600,
        })}
      />,
    );

    // The moment, not the clip's full length.
    expect(screen.getByLabelText("Video at 3:00")).toBeTruthy();
    expect(screen.getByText("3:00")).toBeTruthy();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/album/test-simple?t=180#clip.mov");
  });

  it("leaves a photo result unmarked", () => {
    render(<SearchResultTile result={makeResult()} />);

    expect(screen.queryByLabelText(/^Video/)).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: /find similar photos/i }));

    expect(onFindSimilar).toHaveBeenCalledWith("../albums/test-simple/DSCF0593.jpg", 0.7128);
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

    fireEvent.click(screen.getByRole("button", { name: /use this photo's colour/i }));

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
      screen.getByRole("button", { name: /use this photo's colour/i }).parentElement!.className,
    ).toContain("actionButtonsPersistent");
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
          colorMatchScore: 86.25,
          matchingColor: [12, 34, 56],
        })}
      />,
    );

    expect(screen.getByText("86%").getAttribute("title")).toBe("Colour match score 86%");
  });

  it("shows the semantic percentage (not a colour percentage) when both a cosine score and a colour swatch are present", () => {
    render(
      <SearchResultTile
        result={makeResult({
          snippet: "Harbor skyline",
          similarity: 0.31,
          matchingColor: [12, 34, 56],
        })}
      />,
    );

    // Semantic+colour: the badge must show 31% (0.31 cosine), never "0%".
    expect(screen.getByText("31%")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
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

  it("uses metadata fallbacks and tolerates a result with no descriptive fields", () => {
    const alt = render(
      <SearchResultTile
        result={makeResult({ exif: "", colors: "", alt_text: "Harbor <b>view</b>", tags: "" })}
      />,
    );
    expect(screen.getByAltText("Harbor view")).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
    alt.unmount();

    const subject = render(
      <SearchResultTile
        result={makeResult({ exif: "", colors: "[]", subject: "Night market", tags: "" })}
      />,
    );
    expect(screen.getByAltText("Night market")).toBeInTheDocument();
    subject.unmount();

    const tags = render(
      <SearchResultTile
        result={makeResult({ exif: "", colors: undefined, tags: "street, travel" })}
      />,
    );
    expect(screen.getByAltText("street, travel")).toBeInTheDocument();
    tags.unmount();

    render(<SearchResultTile result={makeResult({ exif: "", colors: undefined, tags: "" })} />);
    expect(screen.getByTestId("result-picture")).toHaveAttribute("alt", "");
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("uses the palette for a colour action when no matched swatch is supplied", () => {
    const onSearchByColor = jest.fn();
    render(<SearchResultTile result={makeResult()} onSearchByColor={onSearchByColor} />);
    fireEvent.click(screen.getByRole("button", { name: /use this photo's colour/i }));
    expect(onSearchByColor).toHaveBeenCalledWith([12, 34, 56]);
  });

  it("labels a hybrid result with missing semantic input", () => {
    render(
      <SearchResultTile result={makeResult({ similarity: undefined, bm25: -2, rrfScore: 0.02 })} />,
    );
    expect(screen.getByText("20")).toHaveAttribute(
      "title",
      "Hybrid search: semantic n/a, keyword 2.0, fused score 0.020 (20)",
    );
  });
});
