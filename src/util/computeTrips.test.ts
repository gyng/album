import { computeTrips, type TripPhoto } from "./computeTrips";

const photo = (date: string | null, over: Partial<TripPhoto> = {}): TripPhoto => ({
  date,
  album: "trip",
  src: "/a.avif",
  href: "/album/trip#a.jpg",
  label: "a.jpg",
  country: "Japan",
  ...over,
});

describe("computeTrips", () => {
  it("groups consecutive shooting days into one trip", () => {
    const trips = computeTrips([
      photo("2016-11-13T10:00:00"),
      photo("2016-11-14T10:00:00"),
      photo("2016-11-15T10:00:00"),
    ]);

    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ startDate: "2016-11-13", endDate: "2016-11-15", dayCount: 3 });
    expect(trips[0]?.photoCount).toBe(3);
  });

  // A journey survives a day without photographs; a fortnight later is a different trip.
  it("bridges a gap of up to three days and breaks on a longer one", () => {
    const bridged = computeTrips([photo("2024-05-01T10:00:00"), photo("2024-05-04T10:00:00")]);
    expect(bridged).toHaveLength(1);

    const split = computeTrips([photo("2024-05-01T10:00:00"), photo("2024-05-06T10:00:00")]);
    expect(split).toHaveLength(2);
  });

  // Without this, one frame taken at home on a Tuesday welds two journeys together.
  it("breaks a trip when the country changes, however close the dates", () => {
    const trips = computeTrips([
      photo("2024-05-01T10:00:00", { country: "Japan" }),
      photo("2024-05-02T10:00:00", { country: "Singapore" }),
    ]);

    expect(trips).toHaveLength(2);
    // Newest first, as everywhere else here.
    expect(trips.map((trip) => trip.country)).toEqual(["Singapore", "Japan"]);
  });

  it("marks a single day as an outing and a longer run as a trip", () => {
    const trips = computeTrips([
      photo("2024-05-01T10:00:00"),
      photo("2024-06-01T10:00:00"),
      photo("2024-06-02T10:00:00"),
    ]);

    expect(trips.map((trip) => trip.isOuting)).toEqual([false, true]);
  });

  // The camera-local wall clock decides the day. Reading these as UTC would move a
  // late-evening frame onto the following day of the trip.
  it("uses the camera's own clock for day boundaries", () => {
    const trips = computeTrips([
      photo("2024-05-01T23:30:00"),
      photo("2024-05-02T00:30:00"),
      photo("2024-05-02T09:00:00"),
    ]);

    expect(trips[0]?.dayCount).toBe(2);
    expect(trips[0]?.days.map((day) => day.count)).toEqual([1, 2]);
  });

  it("orders places by when they were reached, without repeating a stay", () => {
    const trips = computeTrips([
      photo("2024-05-01T09:00:00", { city: "Takayama" }),
      photo("2024-05-01T11:00:00", { city: "Takayama" }),
      photo("2024-05-01T15:00:00", { city: "Hida" }),
      photo("2024-05-01T18:00:00", { city: "Takayama" }),
    ]);

    expect(trips[0]?.days[0]?.places).toEqual(["Takayama", "Hida", "Takayama"]);
    expect(trips[0]?.places).toEqual(["Takayama", "Hida"]);
  });

  // A trip can be assembled from albums filed separately — one journey split into a
  // thematic and a geographic album is real in this archive.
  it("collects every album a trip draws from", () => {
    const trips = computeTrips([
      photo("2016-11-15T10:00:00", { album: "hyouka" }),
      photo("2016-11-16T10:00:00", { album: "kansai" }),
    ]);

    expect(trips[0]?.albums).toEqual(["hyouka", "kansai"]);
  });

  it("excludes photos with no usable date rather than defaulting them", () => {
    const trips = computeTrips([photo(null), photo("2024-05-01T10:00:00"), photo("not a date")]);

    expect(trips).toHaveLength(1);
    expect(trips[0]?.photoCount).toBe(1);
  });

  it("returns newest first, so a trip list opens on the most recent journey", () => {
    const trips = computeTrips([photo("2015-01-01T10:00:00"), photo("2024-05-01T10:00:00")]);

    expect(trips.map((trip) => trip.startDate)).toEqual(["2024-05-01", "2015-01-01"]);
  });

  it("measures the ground covered within a day and the overnight move between days", () => {
    const trips = computeTrips([
      // Two points ~1.1km apart on the same day, then a jump of ~78km overnight.
      photo("2024-05-01T09:00:00", { lat: 35.0, lng: 135.0 }),
      photo("2024-05-01T12:00:00", { lat: 35.01, lng: 135.0 }),
      photo("2024-05-02T09:00:00", { lat: 35.7, lng: 135.0 }),
    ]);

    expect(trips[0]?.days[0]?.coveredKm).toBeCloseTo(1.1, 0);
    expect(trips[0]?.days[0]?.movedKm).toBeNull();
    expect(trips[0]?.days[1]?.movedKm).toBeCloseTo(78, -1);
  });

  it("keeps a representative photo per day for a summary to show", () => {
    const trips = computeTrips([
      photo("2024-05-01T09:00:00", { src: "/one.avif" }),
      photo("2024-05-01T12:00:00", { src: "/two.avif" }),
    ]);

    expect(trips[0]?.days[0]?.photos[0]?.src).toBe("/one.avif");
    expect(trips[0]?.days[0]?.photos).toHaveLength(2);
  });
});
