import type { RoutePoint } from "./mapRoute";
import {
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
});
