/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SearchNavState } from "../../components/search/Search";

let mockSetNavState: ((state: SearchNavState) => void) | null = null;

jest.mock("../../components/search/DynamicSearchWithCoi", () => ({
  __esModule: true,
  default: ({ onNavStateChange }: { onNavStateChange: (state: SearchNavState) => void }) => {
    mockSetNavState = onNavStateChange;
    return <div data-testid="search-client" />;
  },
}));

jest.mock("../../components/search/searchUtils", () => ({
  forceDocumentNavigation: jest.fn(),
}));

jest.mock("../../components/GlobalNav", () => ({
  GlobalNav: ({
    onMapClick,
    slideshowAction,
  }: {
    onMapClick: (event: Event) => void;
    slideshowAction?: React.ReactNode;
  }) => (
    <nav>
      <button type="button" onClick={(event) => onMapClick(event.nativeEvent)}>
        Map
      </button>
      {slideshowAction}
    </nav>
  ),
}));

jest.mock("../../components/ProgressBar", () => ({
  ProgressBar: ({
    progress,
    details,
    activity,
  }: {
    progress: number;
    details?: string;
    activity?: string;
  }) => <output>{[progress, details, activity].filter(Boolean).join("|")}</output>,
}));

jest.mock("../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../components/ui", () => ({
  Footer: () => <footer />,
  Heading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

import SearchPage from "../../pages/search";

const { forceDocumentNavigation: mockForceDocumentNavigation } = jest.requireMock(
  "../../components/search/searchUtils",
) as { forceDocumentNavigation: jest.Mock };

describe("search page shell", () => {
  beforeEach(() => {
    mockSetNavState = null;
    mockForceDocumentNavigation.mockClear();
  });

  it("connects search loading and slideshow state to the global navigation", () => {
    const startSlideshow = jest.fn();
    render(<SearchPage />);

    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByTestId("search-client")).toBeInTheDocument();

    act(() => {
      mockSetNavState?.({
        databaseReady: true,
        isRandomSimilarLoading: false,
        onStartRandomSimilarSlideshow: startSlideshow,
        loading: { progress: 45, details: "4 MB", activity: "Loading index" },
        randomExploreError: "No suitable random photo",
      });
    });

    expect(screen.getByText("45|4 MB|Loading index")).toBeInTheDocument();
    expect(screen.getByText("No suitable random photo")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Start a similar-photo slideshow from a random photo" }),
    );
    expect(startSlideshow).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(mockForceDocumentNavigation).toHaveBeenCalledWith(expect.any(Event), "/map");

    act(() => {
      mockSetNavState?.({
        databaseReady: true,
        isRandomSimilarLoading: true,
      });
    });

    const loadingButton = screen.getByRole("button", {
      name: "Start a similar-photo slideshow from a random photo",
    });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("title", "Starting similarity slideshow…");
    expect(screen.queryByText("No suitable random photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("allows a ready adapter with no optional slideshow callback", () => {
    render(<SearchPage />);

    act(() => {
      mockSetNavState?.({ databaseReady: true, isRandomSimilarLoading: false });
    });

    expect(() =>
      fireEvent.click(
        screen.getByRole("button", {
          name: "Start a similar-photo slideshow from a random photo",
        }),
      ),
    ).not.toThrow();
  });
});
