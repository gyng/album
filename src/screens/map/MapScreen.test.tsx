/**
 * @jest-environment jsdom
 */

import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../test/renderWithNextPlatform";
import type { MapWorldEntry } from "../../util/pageDataTypes";

const push = jest.fn();
const replace = jest.fn();
let mockQuery: Record<string, string> = {};

jest.mock("../../services/album", () => ({
  getAlbums: jest.fn(),
}));

// Keep the progressive search index load out of scope for this test: it
// only exercises the tour lifecycle, not the semantic search corpus.
jest.mock("../../util/mapSearchIndex", () => ({
  fetchMapSearchIndex: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    isReady: true,
    push,
    replace,
  }),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      {...props}
      href={href}
      data-next-link="true"
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          event.preventDefault();
          push(href);
        }
      }}
    >
      {children}
    </a>
  ),
}));

const mapWorldDeferredMock = jest.fn<React.ReactElement, [Record<string, unknown>]>(() => (
  <div data-testid="map-world" />
));
jest.mock("../../components/MapWorldDeferred", () => ({
  MapWorldDeferred: (props: Record<string, unknown>) => {
    mapWorldDeferredMock(props);
    return <div data-testid="map-world" />;
  },
}));

const { default: MapScreen } = require("./MapScreen");

describe("MapScreen tour lifecycle", () => {
  const photos: MapWorldEntry[] = [
    {
      album: "kansai",
      src: { src: "/1.jpg", width: 100, height: 100 },
      decLat: 35,
      decLng: 139,
      date: "2024-01-01T00:00:00.000Z",
      href: "/album/kansai#1.jpg",
    },
    {
      album: "kansai",
      src: { src: "/2.jpg", width: 100, height: 100 },
      decLat: 35.1,
      decLng: 139.1,
      date: "2024-01-02T00:00:00.000Z",
      href: "/album/kansai#2.jpg",
    },
  ];

  beforeEach(() => {
    mockQuery = {};
    push.mockClear();
    replace.mockClear();
    mapWorldDeferredMock.mockClear();
  });

  const lastMapWorldProps = () =>
    mapWorldDeferredMock.mock.calls.at(-1)![0] as { directorEnabled: boolean };

  it("stops a running tour when the search query that scoped it is cleared", async () => {
    render(<MapScreen photos={photos} />);

    const searchInput = screen.getByRole("searchbox", { name: "Search photos on the map" });
    fireEvent.change(searchInput, { target: { value: "kansai" } });
    // Flush the progressive search-index load the query change kicks off.
    await act(async () => {});

    // The map itself reports how many stops a tour of the current results
    // would have; simulate it finding enough to make the Tour control appear.
    act(() => {
      const props = mapWorldDeferredMock.mock.calls.at(-1)![0] as {
        onDirectorSequenceLengthChange: (length: number) => void;
      };
      props.onDirectorSequenceLengthChange(2);
    });

    const tourButton = screen.getByRole("button", { name: /Tour/ });
    fireEvent.click(tourButton);
    expect(tourButton).toHaveAttribute("aria-pressed", "true");
    expect(lastMapWorldProps().directorEnabled).toBe(true);

    fireEvent.change(searchInput, { target: { value: "" } });

    expect(lastMapWorldProps().directorEnabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Tour/ })).not.toBeInTheDocument();
  });
});
