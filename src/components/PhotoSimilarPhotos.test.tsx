import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PhotoSimilarPhotos } from "./PhotoSimilarPhotos";
import { useDatabase } from "./database/useDatabase";
import { fetchSimilarResults } from "./search/api";
import { getRelativeTimeString } from "../util/time";

jest.mock("../util/time", () => ({
  getRelativeTimeString: jest.fn(),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, className, title }: any) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

jest.mock("./database/useDatabase", () => ({
  useDatabase: jest.fn(),
}));

jest.mock("./search/api", () => ({
  fetchSimilarResults: jest.fn(),
}));

describe("PhotoSimilarPhotos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getRelativeTimeString as jest.Mock).mockReturnValue("2y ago");
  });

  it("shows loading progress while the search index is still opening", () => {
    (useDatabase as jest.Mock).mockReturnValue([null, 42]);

    render(<PhotoSimilarPhotos path="../albums/test-simple/DSCF0506-2.jpg" />);

    expect(screen.getByText(/Loading search index \(42%\)/i)).toBeTruthy();
    expect(fetchSimilarResults).not.toHaveBeenCalled();
  });

  it("renders linked thumbnail results once similarity data is available", async () => {
    const database = { name: "db" };
    (useDatabase as jest.Mock).mockReturnValue([database, 100]);
    (fetchSimilarResults as jest.Mock).mockResolvedValue({
      data: [
        {
          path: "../albums/test-simple/DSCF0593.jpg",
          album_relative_path: "/album/test-simple#DSCF0593.jpg",
          filename: "DSCF0593.jpg",
          alt_text: "Harbor skyline",
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          subject: "Harbor skyline",
          tags: "harbor, skyline",
          similarity: 0.82,
        },
      ],
    });

    render(<PhotoSimilarPhotos path="../albums/test-simple/DSCF0506-2.jpg" />);

    await waitFor(() => {
      expect(fetchSimilarResults).toHaveBeenCalledWith({
        database,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 9,
      });
    });

    const link = await screen.findByRole("link", { name: /Harbor skyline/i });
    expect(link.getAttribute("href")).toBe("/album/test-simple#DSCF0593.jpg");
    expect(
      screen.getByRole("img", { name: /Harbor skyline/i }).getAttribute("src"),
    ).toBe("/data/albums/test-simple/.resized_images/DSCF0593.jpg@800.avif");
    expect(screen.getByText("test-simple")).toBeTruthy();
    expect(screen.getByText(", 2y")).toBeTruthy();
    expect(screen.getByText("DSCF0593.jpg")).toBeTruthy();
    expect(screen.getByText("82% match")).toBeTruthy();
  });

  it("loads another 3x3 page when load more is clicked", async () => {
    const database = { name: "db" };
    (useDatabase as jest.Mock).mockReturnValue([database, 100]);
    (fetchSimilarResults as jest.Mock)
      .mockResolvedValueOnce({
        data: Array.from({ length: 9 }, (_value, idx) => ({
          path: `../albums/test-simple/first-${idx}.jpg`,
          album_relative_path: `/album/test-simple#first-${idx}.jpg`,
          filename: `first-${idx}.jpg`,
          alt_text: `First ${idx}`,
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          subject: `First ${idx}`,
          tags: `First ${idx}`,
          similarity: 0.9,
        })),
        next: 1,
      })
      .mockResolvedValueOnce({
        data: [
          {
            path: "../albums/test-simple/second-page.jpg",
            album_relative_path: "/album/test-simple#second-page.jpg",
            filename: "second-page.jpg",
            alt_text: "Second page",
            exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
            subject: "Second page",
            tags: "Second page",
            similarity: 0.7,
          },
        ],
      });

    render(<PhotoSimilarPhotos path="../albums/test-simple/DSCF0506-2.jpg" />);

    expect(await screen.findByText("first-0.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(fetchSimilarResults).toHaveBeenNthCalledWith(2, {
        database,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 1,
        pageSize: 9,
      });
    });

    expect(await screen.findByText("second-page.jpg")).toBeTruthy();
  });
});
