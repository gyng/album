/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

const push = jest.fn();
const replace = jest.fn();
let mockQuery: Record<string, string> = {};

jest.mock("../../../services/album", () => ({
  getAlbums: jest.fn(),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
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

const mapWorldDeferredMock = jest.fn(() => <div data-testid="map-world" />);
jest.mock("../../../components/MapWorldDeferred", () => ({
  MapWorldDeferred: (props: any) => {
    mapWorldDeferredMock(props);
    return <div data-testid="map-world" />;
  },
}));

const { default: WorldMap } = require("../../../pages/map/index");

describe("WorldMap route controls", () => {
  beforeEach(() => {
    mockQuery = {};
    push.mockClear();
    replace.mockClear();
    mapWorldDeferredMock.mockClear();
  });

  it("uses hover-driven route previews for album maps", () => {
    mockQuery = { filter_album: "trip" };

    render(
      <WorldMap
        photos={[
          {
            album: "trip",
            src: { src: "/1.jpg", width: 100, height: 100 },
            decLat: 35,
            decLng: 139,
            date: "2024-01-01T00:00:00.000Z",
            href: "/album/trip#1.jpg",
          },
          {
            album: "trip",
            src: { src: "/2.jpg", width: 100, height: 100 },
            decLat: 35.1,
            decLng: 139.1,
            date: "2024-01-02T00:00:00.000Z",
            href: "/album/trip#2.jpg",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/Hover or select a photo to trace the journey/i),
    ).toBeTruthy();
    expect(mapWorldDeferredMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        showRoute: false,
        routeMode: "full",
        routeDisplayMode: "active-only",
      }),
    );
  });
});
