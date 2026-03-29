/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";

const push = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbums: jest.fn(),
}));

jest.mock("../../../services/journeys", () => ({
  getJourneys: jest.fn(),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push,
    replace: jest.fn(),
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

jest.mock("../../../components/Nav", () => ({
  Nav: () => <nav data-testid="nav" />,
}));

const { default: JourneysPage } = require("../../../pages/journeys/index");

describe("Journeys page", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("renders journey cards with story structure and links", () => {
    render(
      <JourneysPage
        journeys={[
          {
            id: "japan",
            albumSlug: "japan",
            albumTitle: "Japan Winter Loop",
            title: "Japan Winter Loop",
            summary: "2 stops • 410 km • 3 days • Tokyo to Osaka",
            tags: ["winter", "city"],
            startDate: "2024-01-01T08:00:00.000Z",
            endDate: "2024-01-03T10:00:00.000Z",
            durationDays: 3,
            distanceKm: 410,
            stopCount: 2,
            geotaggedPhotoCount: 3,
            startPlace: "Tokyo",
            endPlace: "Osaka",
            cover: {
              href: "/album/japan#a.jpg",
              src: "/a@800.avif",
            },
            albumHref: "/album/japan",
            mapHref: "/map?filter_album=japan",
            timelineHref: "/timeline?filter_album=japan",
            stops: [
              {
                id: "japan:0",
                journeyId: "japan",
                sequenceIndex: 0,
                albumSlug: "japan",
                title: "Tokyo Arrival",
                summary: "2 photos • Jan 1, 2024",
                tags: ["arrival"],
                placeLabel: "Tokyo",
                startDate: "2024-01-01T08:00:00.000Z",
                endDate: "2024-01-01T08:30:00.000Z",
                photoCount: 2,
                decLat: 35.6,
                decLng: 139.7,
                coverHref: "/album/japan#a.jpg",
                cover: {
                  href: "/album/japan#a.jpg",
                  src: "/a@800.avif",
                },
                memberHrefs: ["/album/japan#a.jpg", "/album/japan#b.jpg"],
              },
              {
                id: "japan:1",
                journeyId: "japan",
                sequenceIndex: 1,
                albumSlug: "japan",
                title: "Osaka Nights",
                summary: "1 photo • Jan 3, 2024",
                tags: ["night"],
                placeLabel: "Osaka",
                startDate: "2024-01-03T10:00:00.000Z",
                endDate: "2024-01-03T10:00:00.000Z",
                photoCount: 1,
                decLat: 34.7,
                decLng: 135.5,
                coverHref: "/album/japan#c.jpg",
                cover: {
                  href: "/album/japan#c.jpg",
                  src: "/c@800.avif",
                },
                memberHrefs: ["/album/japan#c.jpg"],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Japan Winter Loop")).toBeTruthy();
    expect(screen.getByText("Tokyo Arrival")).toBeTruthy();
    expect(screen.getByText("Osaka Nights")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open album/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: /Open map/i }));
    expect(push).toHaveBeenCalledWith("/map?filter_album=japan");
  });
});
