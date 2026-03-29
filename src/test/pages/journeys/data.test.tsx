/**
 * @jest-environment node
 */

const getAlbums = jest.fn();
const getJourneys = jest.fn();

jest.mock("../../../services/album", () => ({
  getAlbums,
}));

jest.mock("../../../services/journeys", () => ({
  getJourneys,
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const { getStaticProps } = require("../../../pages/journeys/index");

describe("journeys page data fetching", () => {
  beforeEach(() => {
    getAlbums.mockReset();
    getJourneys.mockReset();
  });

  it("loads albums and builds journeys", async () => {
    const albums = [{ _build: { slug: "trip" } }];
    const journeys = [{ id: "trip", title: "Trip", stops: [] }];

    getAlbums.mockResolvedValue(albums);
    getJourneys.mockResolvedValue(journeys);

    const actual = await getStaticProps({});

    expect(getAlbums).toHaveBeenCalled();
    expect(getJourneys).toHaveBeenCalledWith(albums);
    expect(actual).toEqual({
      props: {
        journeys,
      },
    });
  });

  it("normalizes undefined journey fields into serializable values", async () => {
    const albums = [{ _build: { slug: "trip" } }];
    getAlbums.mockResolvedValue(albums);
    getJourneys.mockResolvedValue([
      {
        id: "trip",
        albumSlug: "trip",
        albumTitle: undefined,
        title: "Trip",
        summary: "1 stop",
        tags: [],
        startDate: null,
        endDate: null,
        durationDays: null,
        distanceKm: 0,
        stopCount: 1,
        geotaggedPhotoCount: 2,
        startPlace: null,
        endPlace: null,
        cover: {
          href: "/album/trip",
          src: "/trip.jpg",
          width: undefined,
          height: undefined,
          placeholderColor: undefined,
        },
        albumHref: "/album/trip",
        mapHref: "/map?filter_album=trip",
        timelineHref: "/timeline?filter_album=trip",
        memberHrefs: [],
        stops: [],
      },
    ]);

    const actual = await getStaticProps({});

    expect(actual).toEqual({
      props: {
        journeys: [
          expect.objectContaining({
            albumTitle: null,
            cover: expect.objectContaining({
              width: null,
              height: null,
              placeholderColor: null,
            }),
          }),
        ],
      },
    });
  });
});
