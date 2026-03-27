import { act, render, screen, waitFor } from "@testing-library/react";
import SlideshowPage from "../../../pages/slideshow/index";

const mockDatabase = {} as never;
const mockFetchSlideshowPhotos = jest.fn();
const mockFetchSimilarResults = jest.fn();
let unmountSlideshow: (() => void) | null = null;
const originalFetch = global.fetch;

jest.mock("../../../components/database/useDatabase", () => ({
  useDatabase: () => [mockDatabase, 100],
}));

jest.mock("../../../components/search/api", () => ({
  fetchSlideshowPhotos: (...args: unknown[]) =>
    mockFetchSlideshowPhotos(...args),
  fetchSimilarResults: (...args: unknown[]) => mockFetchSimilarResults(...args),
}));

jest.mock("../../../components/ProgressBar", () => ({
  ProgressBar: () => <div>Loading...</div>,
}));

jest.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <div>Theme Toggle</div>,
}));

jest.mock("../../../components/Map", () => () => <div>Map</div>);

jest.mock("next/link", () => {
  return ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

jest.mock("next/head", () => {
  return ({ children }: any) => <>{children}</>;
});

jest.mock("usehooks-ts", () => {
  const React = require("react");

  return {
    useLocalStorage: (key: string, initialValue: unknown) => {
      const resolvedInitialValue =
        key === "slideshow-timedelay" ? 10000 : initialValue;
      const [value, setValue] = React.useState(resolvedInitialValue);
      return [value, setValue, jest.fn()] as const;
    },
  };
});

describe("Slideshow autoplay timing", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(global.Math, "random").mockReturnValue(0.99);
    unmountSlideshow = null;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);
    mockFetchSimilarResults.mockReset();
    mockFetchSimilarResults.mockResolvedValue({ data: [] });
    mockFetchSlideshowPhotos.mockReset();
    mockFetchSlideshowPhotos.mockResolvedValue([
      {
        path: "../albums/snapshots/one.jpg",
        exif: "",
        geocode: "",
      },
      {
        path: "../albums/snapshots/two.jpg",
        exif: "",
        geocode: "",
      },
    ]);
  });

  afterEach(async () => {
    await act(async () => {
      unmountSlideshow?.();
      jest.clearAllTimers();
    });

    unmountSlideshow = null;
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("waits for the configured delay before advancing through the shuffled queue", async () => {
    const rendered = render(<SlideshowPage />);
    unmountSlideshow = rendered.unmount;

    await screen.findByAltText("Slideshow image");
    await waitFor(() => {
      expect(mockFetchSlideshowPhotos).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/data/albums/snapshots/.resized_images/one.jpg@3200.avif",
    );

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/data/albums/snapshots/.resized_images/one.jpg@3200.avif",
    );

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        "/data/albums/snapshots/.resized_images/two.jpg@3200.avif",
      );
    });
  });

  it("reshuffles after exhausting the current pass without repeating the boundary image", async () => {
    const randomValues = [0, 0.99, 0, 0];
    jest.restoreAllMocks();
    jest.spyOn(global.Math, "random").mockImplementation(() => {
      return randomValues.shift() ?? 0;
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const rendered = render(<SlideshowPage />);
    unmountSlideshow = rendered.unmount;

    await screen.findByAltText("Slideshow image");
    expect(screen.getByRole("img").getAttribute("src")).toBe(
      "/data/albums/snapshots/.resized_images/two.jpg@3200.avif",
    );

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    await waitFor(() => {
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        "/data/albums/snapshots/.resized_images/one.jpg@3200.avif",
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    await waitFor(() => {
      expect(screen.getByRole("img").getAttribute("src")).toBe(
        "/data/albums/snapshots/.resized_images/two.jpg@3200.avif",
      );
    });
  });
});