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
});
