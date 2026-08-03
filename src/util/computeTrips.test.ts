import { computeTrips, markFirstVisits, markLaterReturns, type TripPhoto } from "./computeTrips";

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

  // A travel day can hold two countries in equal number. Whichever the input
  // order happened to present first used to win, so the same archive grouped
  // differently depending on which page asked. The day ends where it ends, and
  // that is what connects to tomorrow.
  it("settles a tied day on the country it ended in, whatever the input order", () => {
    const day = [
      photo("2015-10-18T16:10:00", { country: "Hong Kong" }),
      photo("2015-10-18T20:13:00", { country: "Taiwan" }),
    ];
    const next = photo("2015-10-19T11:00:00", { country: "Taiwan" });

    const forwards = computeTrips([...day, next]);
    const backwards = computeTrips([next, ...day.toReversed()]);

    expect(forwards).toHaveLength(1);
    expect(forwards[0]?.dayCount).toBe(2);
    expect(backwards.map((trip) => trip.dayCount)).toEqual(forwards.map((trip) => trip.dayCount));
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

  it("averages each day's colour and records the hours it was shot in", () => {
    const trips = computeTrips([
      photo("2024-05-01T09:00:00", { swatch: "rgb(200, 100, 0)" }),
      photo("2024-05-01T09:30:00", { swatch: "rgb(100, 100, 100)" }),
      photo("2024-05-01T18:00:00", { swatch: "rgb(0, 100, 200)" }),
    ]);

    expect(trips[0]?.days[0]?.colour).toBe("rgb(100, 100, 100)");
    expect(trips[0]?.days[0]?.hours).toEqual([9, 18]);
  });

  it("leaves the colour null when nothing on the day carries one", () => {
    const trips = computeTrips([photo("2024-05-01T09:00:00")]);

    expect(trips[0]?.days[0]?.colour).toBeNull();
  });

  // "First time here" is only true relative to everything that came before, so
  // it can only be decided once every trip is known.
  it("marks places not seen on any earlier trip as first visits", () => {
    const trips = markFirstVisits(
      computeTrips([
        photo("2015-05-01T09:00:00", { city: "Kyoto" }),
        photo("2024-05-01T09:00:00", { city: "Kyoto" }),
        photo("2024-05-01T10:00:00", { city: "Nara" }),
      ]),
    );

    const [recent, earlier] = trips;
    expect(earlier?.firstVisits).toEqual(["Kyoto"]);
    expect(recent?.firstVisits).toEqual(["Nara"]);
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

describe("what you carried", () => {
  it("ranks bodies and lenses by share, and says how much of the trip recorded a lens", () => {
    const trips = computeTrips([
      photo("2024-05-01T09:00:00", { camera: "X-T5", lens: "XF16-80mmF4 R OIS WR" }),
      photo("2024-05-01T10:00:00", { camera: "X-T5", lens: "XF16-80mmF4 R OIS WR" }),
      photo("2024-05-01T11:00:00", { camera: "X-T5", lens: "XF23mmF1.4 R LM WR" }),
      // A fixed-lens body records no LensModel at all, which is the ordinary
      // case for half this archive — it must not be counted as a lens.
      photo("2024-05-01T12:00:00", { camera: "X100T" }),
    ]);

    expect(trips[0]?.gear).toEqual({
      cameras: [
        { name: "X-T5", count: 3 },
        { name: "X100T", count: 1 },
      ],
      lenses: [
        { name: "XF16-80mmF4 R OIS WR", count: 2 },
        { name: "XF23mmF1.4 R LM WR", count: 1 },
      ],
      photosWithCamera: 4,
      photosWithLens: 3,
    });
  });

  it("reports no gear when nothing recorded any", () => {
    expect(computeTrips([photo("2024-05-01T09:00:00")])[0]?.gear).toEqual({
      cameras: [],
      lenses: [],
      photosWithCamera: 0,
      photosWithLens: 0,
    });
  });
});

describe("what you photographed here that you rarely do", () => {
  // The point is rarity, not frequency: a tag on every photo in the archive
  // says nothing about this trip even if it is the trip's commonest tag.
  it("ranks tags by how much commoner they are here than across the archive", () => {
    const everywhere = Array.from({ length: 20 }, (_, index) =>
      photo(`2020-0${1 + (index % 3)}-1${index % 8}T10:00:00`, { tags: ["sky"] }),
    );
    const trips = computeTrips([
      ...everywhere,
      photo("2024-05-01T09:00:00", { tags: ["sky", "moss"] }),
      photo("2024-05-01T10:00:00", { tags: ["sky", "moss"] }),
    ]);

    const trip = trips.find((candidate) => candidate.startDate === "2024-05-01");
    expect(trip?.distinctiveTags[0]?.tag).toBe("moss");
    expect(trip?.distinctiveTags.map((entry) => entry.tag)).not.toContain("sky");
  });

  // A tag seen nowhere else scores at the ceiling however rare it is, so
  // without smoothing every one-trip-only tag ties on the same number and the
  // ranking falls back to the alphabet. Six tags at "8.9×" is not a finding.
  it("ranks a subject that recurs above one that appeared twice, when neither occurs elsewhere", () => {
    // Sized like the real archive relative to one trip: with only a few dozen
    // photographs behind it the smoothing prior would dominate, which says
    // nothing about the rule.
    const elsewhere = Array.from({ length: 400 }, (_, index) =>
      photo(`20${10 + (index % 9)}-0${1 + (index % 3)}-1${index % 8}T10:00:00`, { tags: ["sky"] }),
    );
    const trip = Array.from({ length: 20 }, (_, index) =>
      photo(`2024-05-01T${String(9 + index).padStart(2, "0")}:00:00`, {
        tags: index < 12 ? ["moss"] : index < 14 ? ["graveyard"] : [],
      }),
    );

    const found = computeTrips([...elsewhere, ...trip]).find(
      (candidate) => candidate.startDate === "2024-05-01",
    );

    expect(found?.distinctiveTags.map((entry) => entry.tag)).toEqual(["moss", "graveyard"]);
    expect(found?.distinctiveTags[0]?.times).toBeGreaterThan(found?.distinctiveTags[1]?.times ?? 0);
  });

  // Otherwise every Japan trip reports, at great length, that it is in Japan.
  it("drops tags that merely repeat where the photograph was taken", () => {
    // "kyoto" and "japan" are on every frame of this trip, so by rate alone
    // they would outrank moss — the place words have to go before the ranking.
    const elsewhere = Array.from({ length: 20 }, (_, index) =>
      photo(`2020-0${1 + (index % 3)}-1${index % 8}T10:00:00`, {
        city: "Singapore",
        tags: ["sky"],
      }),
    );
    const trips = computeTrips([
      ...elsewhere,
      photo("2024-05-01T09:00:00", { city: "Kyoto", country: "Japan", tags: ["kyoto", "moss"] }),
      photo("2024-05-01T10:00:00", { city: "Kyoto", country: "Japan", tags: ["japan", "moss"] }),
    ]);

    const trip = trips.find((candidate) => candidate.startDate === "2024-05-01");
    expect(trip?.distinctiveTags.map((entry) => entry.tag)).toEqual(["moss"]);
  });
});

describe("the route", () => {
  it("gives each day one point, taken from a photograph that has coordinates", () => {
    const trips = computeTrips([
      photo("2024-05-01T09:00:00", {}),
      photo("2024-05-01T10:00:00", { lat: 35.01, lng: 135.76 }),
      photo("2024-05-02T10:00:00", { lat: 34.67, lng: 135.5 }),
    ]);

    expect(trips[0]?.days.map((day) => day.point)).toEqual([
      { lat: 35.01, lng: 135.76 },
      { lat: 34.67, lng: 135.5 },
    ]);
  });

  it("leaves a day with no located photograph without a point", () => {
    expect(computeTrips([photo("2024-05-01T09:00:00")])[0]?.days[0]?.point).toBeNull();
  });
});

describe("markLaterReturns", () => {
  // The mirror of firstVisits: that one says "you had never been here", this
  // one says "and you came back".
  it("names the next trip that reached the same place, and the year it did", () => {
    const trips = markLaterReturns(
      computeTrips([
        photo("2018-04-01T10:00:00", { city: "Kyoto" }),
        photo("2022-11-02T10:00:00", { city: "Kyoto" }),
        photo("2024-03-03T10:00:00", { city: "Kyoto" }),
      ]),
    );

    const first = trips.find((trip) => trip.startDate === "2018-04-01");
    expect(first?.laterReturns).toEqual([{ place: "Kyoto", year: 2022 }]);
  });

  it("says nothing about a place never returned to, or about the last visit", () => {
    const trips = markLaterReturns(
      computeTrips([
        photo("2018-04-01T10:00:00", { city: "Kyoto" }),
        photo("2022-11-02T10:00:00", { city: "Osaka" }),
      ]),
    );

    expect(trips.every((trip) => trip.laterReturns.length === 0)).toBe(true);
  });
});
