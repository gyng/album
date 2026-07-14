/**
 * @jest-environment jsdom
 */

/* oxlint-disable typescript/unbound-method -- Jest assertions inspect mocked DOM methods without calling them. */

import { render, screen } from "@testing-library/react";
import type { Content, PhotoBlock } from "../../../services/types";

const mockOn = jest.fn();
const mockOff = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbumFromName: jest.fn(),
  getAlbumNames: jest.fn(),
}));
jest.mock("next/router", () => ({
  useRouter: () => ({ events: { on: mockOn, off: mockOff } }),
}));
jest.mock("../../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../../components/GlobalNav", () => ({
  GlobalNav: ({ extraItems }: { extraItems: React.ReactNode }) => (
    <nav>
      <ul>{extraItems}</ul>
    </nav>
  ),
}));
jest.mock("../../../components/PhotoAlbum", () => ({
  PhotoAlbum: ({ album }: { album: Content }) => <div data-testid="album">{album._build.slug}</div>,
}));
jest.mock("../../../components/ui", () => ({ Footer: () => <footer /> }));

import AlbumPage, { getStaticProps } from "../../../pages/album/[[...slug]]";

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

describe("album page shell", () => {
  beforeEach(() => {
    mockOn.mockClear();
    mockOff.mockClear();
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
    target.scrollIntoView = jest.fn();
    document.body.append(target);
    window.history.replaceState(null, "", "/album/trip#night%20market.jpg");
    routeChangeHandler();
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);

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
    target.scrollIntoView = jest.fn();
    document.body.append(target);
    window.history.replaceState(null, "", "/album/trip#%");

    const routeChangeHandler = mockOn.mock.calls[0]?.[1] as () => void;
    expect(() => routeChangeHandler()).not.toThrow();
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("returns not-found when a build request has no album slug", async () => {
    await expect(getStaticProps({ params: {} } as never)).resolves.toEqual({ notFound: true });
  });
});
