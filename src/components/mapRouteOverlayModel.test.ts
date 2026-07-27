import type { RoutePoint } from "./mapRoute";
import {
  formatDistanceKm,
  clipRouteSegmentsToViewport,
  getAnimationSecondsFromSpeed,
  getDirectionalGradientStops,
  isTransferLeg,
  isRoutePointInViewport,
  projectGhostRoutePath,
  projectRouteSegments,
  selectPreferredLabelSegmentIds,
  type ProjectedRouteSegment,
} from "./mapRouteOverlayModel";

const point = (overrides: Partial<RoutePoint>): RoutePoint => ({
  album: "journey",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 10,
  decLng: 170,
  date: "2024-01-01T00:00:00",
  href: "/album/journey#a.jpg",
  isStart: false,
  isEnd: false,
  sequenceIndex: 0,
  stopPhotoCount: 1,
  memberHrefs: [],
  ...overrides,
});

const segment = (overrides: Partial<ProjectedRouteSegment>): ProjectedRouteSegment => ({
  id: "segment",
  d: "M 0 0 L 100 0",
  color: "red",
  approxSpeedKmh: 80,
  durationSeconds: 3600,
  distanceKm: 80,
  midX: 50,
  midY: 0,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 0,
  angle: 0,
  lengthPx: 100,
  ...overrides,
});

describe("mapRouteOverlayModel", () => {
  const twoPoints = (overrides: Partial<RoutePoint> = {}): RoutePoint[] => [
    point({ href: "start", decLng: 0, decLat: 0 }),
    point({
      href: "end",
      decLng: 1,
      decLat: 0,
      date: "2024-01-01T01:00:00",
      sequenceIndex: 1,
      ...overrides,
    }),
  ];

  const projectPair = (
    start: { x: number; y: number } | null | undefined,
    end: { x: number; y: number } | null | undefined,
  ) => {
    let call = 0;
    return () => (call++ === 0 ? start : end);
  };

  it("builds directional gradients and clamps animation timing to readable speeds", () => {
    const stops = getDirectionalGradientStops("hsl(0 100% 50%)", "hsl(120 100% 50%)");
    expect(stops.map((stop) => stop.offset)).toEqual(["0%", "50%", "100%"]);
    expect(stops[0]?.color).toBe("hsl(0 100% 50%)");
    expect(stops[2]?.color).toBe("hsl(120 100% 50%)");

    expect(getAnimationSecondsFromSpeed(null)).toBe(1.8);
    expect(getAnimationSecondsFromSpeed(0)).toBe(1.8);
    expect(getAnimationSecondsFromSpeed(1)).toBe(2.5);
    expect(getAnimationSecondsFromSpeed(1000)).toBe(0.49);
    expect(getAnimationSecondsFromSpeed(10_000)).toBe(0.49);
  });

  it("requires at least two route points and valid projected coordinates", () => {
    expect(
      projectRouteSegments(
        [],
        () => ({ x: 0, y: 0 }),
        () => "red",
      ),
    ).toEqual([]);
    expect(
      projectRouteSegments(
        [point({})],
        () => ({ x: 0, y: 0 }),
        () => "red",
      ),
    ).toEqual([]);

    const invalidPairs = [
      [null, { x: 1, y: 1 }],
      [
        { x: "bad", y: 0 },
        { x: 1, y: 1 },
      ],
      [
        { x: 0, y: "bad" },
        { x: 1, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: "bad", y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: "bad" },
      ],
    ] as Array<[unknown, unknown]>;

    for (const [start, end] of invalidPairs) {
      expect(
        projectRouteSegments(twoPoints(), projectPair(start as never, end as never), () => "red"),
      ).toEqual([]);
    }
  });

  it("projects an antimeridian crossing onto the nearest world copy", () => {
    const routePoints = [
      point({ href: "start", decLng: 170 }),
      point({ href: "end", decLat: 20, decLng: -170, sequenceIndex: 1 }),
    ];

    const projected = projectRouteSegments(
      routePoints,
      ([longitude, latitude]) => ({ x: longitude * 100, y: latitude * 100 }),
      () => "red",
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]?.startX).toBe(17000);
    expect(projected[0]?.endX).toBe(19000);
    expect(projected[0]?.d).not.toContain("-17000");
  });

  it("selects long speed labels while keeping their midpoints apart", () => {
    const selected = selectPreferredLabelSegmentIds([
      segment({ id: "longest", midX: 0, lengthPx: 120 }),
      segment({ id: "nearby", midX: 40, lengthPx: 100 }),
      segment({ id: "distant", midX: 200, lengthPx: 80 }),
      segment({ id: "short", midX: 400, lengthPx: 10, distanceKm: 2 }),
      segment({ id: "unknown-speed", midX: 600, approxSpeedKmh: null }),
    ]);

    expect(Array.from(selected)).toEqual(["longest", "distant"]);
  });

  it("keeps only route legs whose screen-space bounds meet the padded viewport", () => {
    const visible = segment({
      id: "visible",
      startX: 20,
      startY: 30,
      endX: 80,
      endY: 40,
    });
    const crossing = segment({
      id: "crossing",
      startX: -1_000,
      startY: 50,
      endX: 1_000,
      endY: 50,
    });
    const padded = segment({
      id: "padded",
      startX: 110,
      startY: 30,
      endX: 120,
      endY: 40,
    });
    const outside = segment({
      id: "outside",
      startX: 500,
      startY: 500,
      endX: 600,
      endY: 600,
    });

    const clipped = clipRouteSegmentsToViewport(
      [visible, crossing, padded, outside],
      { width: 100, height: 80 },
      24,
    );

    expect(clipped.map(({ id }) => id)).toEqual(["visible", "crossing", "padded"]);
    expect(clipped.find(({ id }) => id === "crossing")).toMatchObject({
      startX: -24,
      endX: 124,
      d: "M -24.00 50.00 L 124.00 50.00",
    });
  });

  it("recognises only endpoint decorations inside the padded viewport", () => {
    const viewport = { width: 100, height: 80 };

    expect(isRoutePointInViewport({ x: -24, y: 40 }, viewport, 24)).toBe(true);
    expect(isRoutePointInViewport({ x: 124, y: 40 }, viewport, 24)).toBe(true);
    expect(isRoutePointInViewport({ x: -25, y: 40 }, viewport, 24)).toBe(false);
    expect(isRoutePointInViewport({ x: 50, y: 105 }, viewport, 24)).toBe(false);
  });

  it("keeps zero-length and backwards labels geometrically stable and readable", () => {
    const zeroLength = projectRouteSegments(
      twoPoints(),
      projectPair({ x: 5, y: 5 }, { x: 5, y: 5 }),
      () => "blue",
    )[0]!;
    expect(zeroLength.midX).toBe(5);
    expect(zeroLength.midY).toBe(5);
    expect(zeroLength.lengthPx).toBe(0);

    const upLeft = projectRouteSegments(
      twoPoints(),
      projectPair({ x: 0, y: 0 }, { x: -10, y: 10 }),
      () => "blue",
    )[0]!;
    const downLeft = projectRouteSegments(
      twoPoints(),
      projectPair({ x: 0, y: 0 }, { x: -10, y: -10 }),
      () => "blue",
    )[0]!;
    expect(upLeft.angle).toBe(-45);
    expect(downLeft.angle).toBe(45);
  });

  it("derives duration and plausible speed only from valid forward local timestamps", () => {
    const valid = projectRouteSegments(
      twoPoints(),
      projectPair({ x: 0, y: 0 }, { x: 100, y: 0 }),
      () => "red",
    )[0]!;
    expect(valid.durationSeconds).toBe(3600);
    expect(valid.approxSpeedKmh).toBe(111);

    const invalidFrom = twoPoints();
    invalidFrom[0]!.date = "not-a-date";
    const invalidResult = projectRouteSegments(
      invalidFrom,
      projectPair({ x: 0, y: 0 }, { x: 100, y: 0 }),
      () => "red",
    )[0]!;
    expect(invalidResult.durationSeconds).toBe(0);
    expect(invalidResult.approxSpeedKmh).toBeNull();

    const invalidTo = twoPoints({ date: "not-a-date" });
    expect(
      projectRouteSegments(invalidTo, projectPair({ x: 0, y: 0 }, { x: 100, y: 0 }), () => "red")[0]
        ?.approxSpeedKmh,
    ).toBeNull();

    const reverse = twoPoints({ date: "2023-12-31T23:00:00" });
    const reverseResult = projectRouteSegments(
      reverse,
      projectPair({ x: 0, y: 0 }, { x: 100, y: 0 }),
      () => "red",
    )[0]!;
    expect(reverseResult.durationSeconds).toBe(3600);
    expect(reverseResult.approxSpeedKmh).toBeNull();
  });

  it("rejects implausibly short, slow, fast, and non-finite speed estimates", () => {
    const scenarios = [
      twoPoints({ decLng: 0.0001 }),
      twoPoints({ date: "2025-01-01T01:00:00" }),
      twoPoints({ date: "2024-01-01T00:01:00" }),
      twoPoints({ decLat: Number.POSITIVE_INFINITY }),
    ];

    for (const route of scenarios) {
      expect(
        projectRouteSegments(route, projectPair({ x: 0, y: 0 }, { x: 100, y: 0 }), () => "red")[0]
          ?.approxSpeedKmh,
      ).toBeNull();
    }
  });

  it("builds ghost paths from valid projected points only", () => {
    expect(projectGhostRoutePath([], () => ({ x: 0, y: 0 }))).toBeNull();
    expect(projectGhostRoutePath([point({})], () => ({ x: 0, y: 0 }))).toBeNull();

    const route = [
      point({ decLng: 0, decLat: 0 }),
      point({ decLng: 1, decLat: 1 }),
      point({ decLng: 2, decLat: 2 }),
    ];
    expect(
      projectGhostRoutePath(route, ([longitude, latitude]) =>
        longitude === 1 ? null : { x: longitude * 10, y: latitude * 10 },
      ),
    ).toBe("M 0.00 0.00 L 20.00 20.00");
    expect(projectGhostRoutePath(route, () => undefined)).toBeNull();
  });

  it("formats route distances and identifies transfers by distance or duration", () => {
    expect(formatDistanceKm(9.94)).toBe("9.9km");
    expect(formatDistanceKm(10.4)).toBe("10km");
    expect(isTransferLeg(12, 60)).toBe(true);
    expect(isTransferLeg(5, 7200)).toBe(true);
    expect(isTransferLeg(5, 7199)).toBe(false);
  });
});
