/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PhotoSimilarPhotos } from "./PhotoSimilarPhotos";
import { useDatabase, useEmbeddingsDatabase } from "./database/useDatabase";
import { fetchSimilarResults } from "./search/api";

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
  useEmbeddingsDatabase: jest.fn(),
}));

jest.mock("./search/api", () => ({
  fetchSimilarResults: jest.fn(),
}));

describe("PhotoSimilarPhotos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("shows loading progress while the search index is still opening", () => {
    (useDatabase as jest.Mock).mockReturnValue([null, 42]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([null, 0]);

    render(<PhotoSimilarPhotos path="../albums/test-simple/DSCF0506-2.jpg" />);

    expect(screen.getByText(/Loading search index \(42%\)/i)).toBeTruthy();
    expect(fetchSimilarResults).not.toHaveBeenCalled();
  });

  it("omits the progress suffix until either database reports progress", () => {
    (useDatabase as jest.Mock).mockReturnValue([null, 0]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([null, 0]);
    const view = render(<PhotoSimilarPhotos path="photo.jpg" />);
    expect(screen.getByText("Loading search index…")).toBeInTheDocument();

    (useDatabase as jest.Mock).mockReturnValue([{ name: "db" }, 100]);
    view.rerender(<PhotoSimilarPhotos path="photo.jpg" />);
    expect(screen.getByText("Loading similarity index…")).toBeInTheDocument();
  });

  it("does not load databases when no source path is available", () => {
    (useDatabase as jest.Mock).mockReturnValue([null, 0]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([null, 0]);

    const { container } = render(<PhotoSimilarPhotos path={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(useEmbeddingsDatabase).toHaveBeenCalledWith(false);
    expect(fetchSimilarResults).not.toHaveBeenCalled();
  });

  it("reports similarity-index progress after the search index opens", () => {
    (useDatabase as jest.Mock).mockReturnValue([{ name: "db" }, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([null, 51.6]);

    render(<PhotoSimilarPhotos path="photo.jpg" />);

    expect(screen.getByText(/Loading similarity index \(52%\)/)).toBeInTheDocument();
    expect(fetchSimilarResults).not.toHaveBeenCalled();
  });

  it("shows a search state while the first similarity query is pending", () => {
    (useDatabase as jest.Mock).mockReturnValue([{ name: "db" }, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([{ name: "embeddings" }, 100]);
    (fetchSimilarResults as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(<PhotoSimilarPhotos path="photo.jpg" />);

    expect(screen.getByText("Finding similar photos…")).toBeInTheDocument();
  });

  it("distinguishes an empty index from a failed query", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    (useDatabase as jest.Mock).mockReturnValue([{ name: "db" }, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([{ name: "embeddings" }, 100]);
    (fetchSimilarResults as jest.Mock).mockResolvedValueOnce({ data: [], next: null });

    const view = render(<PhotoSimilarPhotos path="empty.jpg" />);
    expect(
      await screen.findByText("No similar photos indexed for this image yet."),
    ).toBeInTheDocument();

    (fetchSimilarResults as jest.Mock).mockRejectedValueOnce(new Error("database unavailable"));
    view.rerender(<PhotoSimilarPhotos path="broken.jpg" />);
    expect(await screen.findByText("Could not load similar photos.")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith("Failed to load similar photos", expect.any(Error));
    consoleError.mockRestore();
  });

  it.each(["resolve", "reject"])("ignores a late %s after unmount", async (outcome) => {
    (useDatabase as jest.Mock).mockReturnValue([{ name: "db" }, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([{ name: "embeddings" }, 100]);
    let settle!: (value?: unknown) => void;
    const pending = new Promise((resolve, reject) => {
      settle = outcome === "resolve" ? resolve : reject;
    });
    (fetchSimilarResults as jest.Mock).mockReturnValue(pending);

    const view = render(<PhotoSimilarPhotos path="photo.jpg" />);
    view.unmount();
    await act(async () => {
      settle(outcome === "resolve" ? { data: [], next: null } : new Error("late failure"));
      try {
        await pending;
      } catch {
        // The component deliberately ignores rejected work after cancellation.
      }
      await Promise.resolve();
    });
  });

  it("renders linked thumbnail results once similarity data is available", async () => {
    const database = { name: "db" };
    const embeddingsDatabase = { name: "embeddings" };
    (useDatabase as jest.Mock).mockReturnValue([database, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([embeddingsDatabase, 100]);
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
        embeddingsDatabase,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 7,
        offset: 0,
      });
    });

    const link = await screen.findByRole("link", { name: /Harbor skyline/i });
    expect(link.getAttribute("href")).toBe("/album/test-simple#DSCF0593.jpg");
    expect(screen.getByRole("img", { name: /Harbor skyline/i }).getAttribute("src")).toBe(
      "/data/albums/test-simple/.resized_images/DSCF0593.jpg@800.avif",
    );
    expect(screen.getByText(/test-simple/)).toBeTruthy();
    expect(screen.getByText("82%")).toBeTruthy();
  });

  it("loads another 3x3 page when load more is clicked", async () => {
    const database = { name: "db" };
    const embeddingsDatabase = { name: "embeddings" };
    (useDatabase as jest.Mock).mockReturnValue([database, 100]);
    (useEmbeddingsDatabase as jest.Mock).mockReturnValue([embeddingsDatabase, 100]);
    (fetchSimilarResults as jest.Mock)
      .mockResolvedValueOnce({
        data: Array.from({ length: 8 }, (_value, idx) => ({
          path: `../albums/test-simple/first-${idx}.jpg`,
          album_relative_path: `/album/test-simple#first-${idx}.jpg`,
          filename: `first-${idx}.jpg`,
          alt_text: `First ${idx}`,
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          subject: `First ${idx}`,
          tags: `First ${idx}`,
          similarity: 0.9,
        })),
        next: 8,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 9 }, (_value, idx) => ({
          path:
            idx === 0
              ? "../albums/test-simple/first-0.jpg"
              : `../albums/test-simple/second-${idx}.jpg`,
          album_relative_path: `/album/test-simple#second-${idx}.jpg`,
          filename: `second-${idx}.jpg`,
          alt_text: `Second ${idx}`,
          exif: "EXIF DateTimeOriginal:2024:02:03 10:20:30",
          subject: `Second ${idx}`,
          tags: `Second ${idx}`,
          similarity: 0.7,
        })),
      });

    render(<PhotoSimilarPhotos path="../albums/test-simple/DSCF0506-2.jpg" />);

    expect(await screen.findByRole("img", { name: /First 0/i })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(fetchSimilarResults).toHaveBeenNthCalledWith(2, {
        database,
        embeddingsDatabase,
        path: "../albums/test-simple/DSCF0506-2.jpg",
        page: 0,
        pageSize: 8,
        offset: 8,
      });
    });

    expect(await screen.findByRole("img", { name: /Second 8/i })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(16);
    expect(screen.getAllByRole("img", { name: /First 0/i })).toHaveLength(1);
  });
});
