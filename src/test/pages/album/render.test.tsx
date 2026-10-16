/**
 * @jest-environment jsdom
 */

import { screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../renderWithNextPlatform";
import type { Content, PhotoBlock, VideoBlock } from "../../../services/types";

const mockOn = jest.fn();
const mockOff = jest.fn();
const mockSeo = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbumFromName: jest.fn(),
  getAlbumNames: jest.fn(),
}));
jest.mock("next/router", () => ({
  useRouter: () => ({ events: { on: mockOn, off: mockOff } }),
}));
jest.mock("../../../components/Seo", () => ({
  Seo: (props: Record<string, unknown>) => {
    mockSeo(props);
    return null;
  },
}));
jest.mock("../../../components/GlobalNav", () => ({
  GlobalNav: ({ themeAdjacentItem }: { themeAdjacentItem: React.ReactNode }) => (
    <nav>{themeAdjacentItem}</nav>
  ),
}));
jest.mock("../../../components/PhotoAlbum", () => ({
  PhotoAlbum: ({ album }: { album: Content }) => <div data-testid="album">{album._build.slug}</div>,
}));
jest.mock("../../../components/ui", () => ({
  Footer: () => <footer />,
  buttonStyles: { base: "button" },
}));

import AlbumPage from "../../../screens/album/AlbumScreen";
import { getStaticProps } from "../../../pages/album/[[...slug]]";

const photo = (cover = false): PhotoBlock => ({
  kind: "photo",
  id: "night market.jpg",
  data: { src: "night market.jpg" },
  ...(cover ? { formatting: { cover: true } } : {}),
  _build: {
    width: 1200,
    height: 800,
    exif: {},
    tags: {},
    srcset: [{ src: "/night-market.avif", width: 1200, height: 800 }],
  },
});

const album = (overrides: Partial<Content> = {}): Content => ({
  name: "trip",
  title: "Trip",
  blocks: [],
  formatting: {},
  _build: { slug: "trip", srcdir: "../albums/trip" },
  ...overrides,
});

const video = (): VideoBlock => ({
  kind: "video",
  id: "clip.mov",
  data: { type: "local", href: "clip.mov" },
  _build: {
    src: "/clip.mov@1920.mp4",
    mimeType: "video/mp4",
    poster: { srcset: [{ src: "/clip-poster.avif", width: 1600, height: 900 }] },
    capturedAtLocal: "2024-05-01T09:00:00",
  },
});

describe("album page shell", () => {
  it("preserves reserved characters in album view filters", () => {
    const name = "A&B + #summer";
    render(<AlbumPage album={album({ _build: { slug: name, srcdir: `../albums/${name}` } })} />);
    for (const [label, parameter] of [
      ["Album map", "filter_album"],
      ["Album timeline", "filter_album"],
      ["Album slideshow", "filter"],
    ] as const) {
      const href = screen.getByRole("link", { name: label }).getAttribute("href")!;
      expect(new URL(href, "https://example.test").searchParams.get(parameter)).toBe(name);
    }
  });
  beforeEach(() => {
    mockOn.mockClear();
    mockOff.mockClear();
    mockSeo.mockClear();
    window.history.replaceState(null, "", "/album/trip");
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders album navigation and restores encoded hash positions after route changes", () => {
    const { unmount } = render(
      <AlbumPage album={album({ title: undefined as never, blocks: [photo()] })} />,
    );

    expect(screen.getByTestId("album")).toHaveTextContent("trip");
    expect(screen.getByRole("link", { name: "Album map" })).toHaveAttribute(
      "href",
      "/map?filter_album=trip",
    );
    const routeChangeHandler = mockOn.mock.calls[0]?.[1] as () => void;
    expect(routeChangeHandler).toEqual(expect.any(Function));

    routeChangeHandler();

    const target = document.createElement("div");
    target.id = "night market.jpg";
    const scrollIntoView = jest.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);
    window.history.replaceState(null, "", "/album/trip#night%20market.jpg");
    routeChangeHandler();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, "", "/album/trip#missing.jpg");
    routeChangeHandler();

    unmount();
    expect(mockOff).toHaveBeenCalledWith("routeChangeComplete", routeChangeHandler);
  });

  it("falls back to a malformed raw hash instead of crashing", () => {
    render(
      <AlbumPage
        album={album({ name: undefined as never, title: undefined as never, blocks: [] })}
      />,
    );
    const target = document.createElement("div");
    target.id = "%";
    const scrollIntoView = jest.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);
    window.history.replaceState(null, "", "/album/trip#%");

    const routeChangeHandler = mockOn.mock.calls[0]?.[1] as () => void;
    expect(() => routeChangeHandler()).not.toThrow();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls to an encoded hash on first load, not only after a route change", () => {
    // The framework's own mount-time hash scroll looks the element up by the
    // raw hash, so "#sunset%20harbour.jpg" never matched "sunset harbour.jpg"
    // and a shared link to that photo opened at the top of the album.
    const target = document.createElement("div");
    target.id = "sunset harbour.jpg";
    const scrollIntoView = jest.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.append(target);
    window.history.replaceState(null, "", "/album/trip#sunset%20harbour.jpg");

    render(<AlbumPage album={album({ blocks: [photo()] })} />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // A clip is media too: the album's own description counts it, and its poster
  // frame stands as the cover a card or a share preview draws.
  it("counts a clip as album media and takes its poster as the cover", () => {
    render(<AlbumPage album={album({ blocks: [video()] })} />);

    expect(mockSeo).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Trip photo album: 1 clip",
        image: "/clip-poster.avif",
      }),
    );
  });

  it("returns not-found when a build request has no album slug", async () => {
    await expect(getStaticProps({ params: {} } as never)).resolves.toEqual({ notFound: true });
  });
});
