import {
  backToFront,
  clusterPoints,
  distinctiveTag,
  nearestNeighbours,
  type Camera,
  pickPoint,
  projectPoint,
  projectToThreeDimensions,
  type SpacePoint,
} from "./embeddingSpace";

const VIEWPORT = { width: 800, height: 600 };
const CAMERA: Camera = { yaw: 0, pitch: 0, distance: 2.6 };

/** A vector with `value` in one dimension and a little noise everywhere else. */
const spike = (dimensions: number, at: number, value: number): number[] =>
  Array.from({ length: dimensions }, (_, index) =>
    index === at ? value : Math.sin(index * 0.3) * 0.01,
  );

describe("projectToThreeDimensions", () => {
  // The whole promise: photographs the model reads as alike stay together, and
  // ones it reads as different stay apart.
  it("keeps separated groups separated", () => {
    const vectors = [
      ...Array.from({ length: 6 }, (_, i) => spike(32, 0, 5 + i * 0.01)),
      ...Array.from({ length: 6 }, (_, i) => spike(32, 1, 5 + i * 0.01)),
      ...Array.from({ length: 6 }, (_, i) => spike(32, 2, 5 + i * 0.01)),
    ];

    const points = projectToThreeDimensions(vectors);
    const centroid = (from: number) => {
      const group = points.slice(from, from + 6);
      return {
        x: group.reduce((sum, point) => sum + point.x, 0) / group.length,
        y: group.reduce((sum, point) => sum + point.y, 0) / group.length,
        z: group.reduce((sum, point) => sum + point.z, 0) / group.length,
      };
    };
    const distance = (a: SpacePoint, b: SpacePoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    const [first, second, third] = [centroid(0), centroid(6), centroid(12)];
    // Groups are far apart relative to the spread within each one.
    const spread = Math.max(
      ...points.slice(0, 6).map((point) => distance(point, first)),
      ...points.slice(6, 12).map((point) => distance(point, second)),
    );
    expect(distance(first, second)).toBeGreaterThan(spread * 10);
    expect(distance(second, third)).toBeGreaterThan(spread * 10);
  });

  it("fits the cloud into a cube a camera can be written for", () => {
    const points = projectToThreeDimensions(
      Array.from({ length: 40 }, (_, index) => spike(24, index % 24, 1 + index)),
    );

    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1.000001);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1.000001);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(1.000001);
    }
    expect(Math.max(...points.map((point) => Math.abs(point.x)))).toBeCloseTo(1, 5);
  });

  // The components are ordered by variance, so a shared scale would draw this
  // as an almost flat slab — true, and useless to turn around, since the third
  // axis is the one that reads as depth.
  it("gives each axis the whole cube, so the depth axis can be seen", () => {
    const points = projectToThreeDimensions(
      Array.from({ length: 40 }, (_, index) => spike(24, index % 24, 1 + index)),
    );

    for (const axis of ["x", "y", "z"] as const) {
      expect(Math.max(...points.map((point) => Math.abs(point[axis])))).toBeCloseTo(1, 5);
    }
  });

  // Data that genuinely lies in a plane should come out as a plane rather than
  // as a cloud with a made-up third axis.
  it("reports a flat collection as flat", () => {
    const vectors = Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2;
      const flat: number[] = Array.from({ length: 16 }, () => 0);
      flat[0] = Math.cos(angle);
      flat[1] = Math.sin(angle);
      return flat;
    });

    const points = projectToThreeDimensions(vectors);
    const depth = Math.max(...points.map((point) => Math.abs(point.z)));

    expect(depth).toBeLessThan(0.01);
  });

  // A build that ran twice would otherwise publish the same cloud in a
  // different pose, and every reader would download it again for no change.
  it("is the same on every build", () => {
    const vectors = Array.from({ length: 12 }, (_, index) => spike(20, index % 5, index + 1));

    expect(projectToThreeDimensions(vectors)).toEqual(projectToThreeDimensions(vectors));
  });

  it("has nothing to say about one photograph, or none", () => {
    expect(projectToThreeDimensions([])).toEqual([]);
    expect(projectToThreeDimensions([[1, 2, 3]])).toEqual([{ x: 0, y: 0, z: 0 }]);
  });

  it("survives a collection where every vector is identical", () => {
    const points = projectToThreeDimensions(Array.from({ length: 5 }, () => [1, 1, 1, 1]));

    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
    }
  });
});

describe("projectPoint", () => {
  it("puts the middle of the cloud in the middle of the view", () => {
    const projected = projectPoint({ x: 0, y: 0, z: 0 }, CAMERA, VIEWPORT);

    expect(projected?.x).toBeCloseTo(400, 5);
    expect(projected?.y).toBeCloseTo(300, 5);
  });

  it("draws what is further away smaller", () => {
    const near = projectPoint({ x: 0, y: 0, z: -0.9 }, CAMERA, VIEWPORT);
    const far = projectPoint({ x: 0, y: 0, z: 0.9 }, CAMERA, VIEWPORT);

    expect(near?.scale).toBeGreaterThan(far?.scale ?? 0);
    expect(near?.depth).toBeLessThan(far?.depth ?? 0);
  });

  // The cloud's y goes up and the screen's goes down.
  it("draws what is above the middle above the middle", () => {
    expect(projectPoint({ x: 0, y: 0.5, z: 0 }, CAMERA, VIEWPORT)?.y).toBeLessThan(300);
  });

  it("turns the cloud when the camera does", () => {
    const still = projectPoint({ x: 1, y: 0, z: 0 }, CAMERA, VIEWPORT);
    const turned = projectPoint({ x: 1, y: 0, z: 0 }, { ...CAMERA, yaw: Math.PI / 2 }, VIEWPORT);

    expect(still?.x).toBeGreaterThan(400);
    // A quarter turn takes that point behind the middle, not beside it.
    expect(turned?.x).toBeCloseTo(400, 5);
    expect(turned?.depth).toBeGreaterThan(still?.depth ?? 0);
  });

  it("drops a point that has gone behind the eye", () => {
    expect(projectPoint({ x: 0, y: 0, z: -1 }, { ...CAMERA, distance: 0.5 }, VIEWPORT)).toBeNull();
  });
});

describe("backToFront", () => {
  it("draws the far ones first, so the near ones cover them", () => {
    const order = backToFront([{ depth: 1 }, { depth: 5 }, { depth: 3 }]);

    expect(order.map((point) => point.depth)).toEqual([5, 3, 1]);
  });

  it("leaves the caller's own array alone", () => {
    const points = [{ depth: 1 }, { depth: 2 }];
    backToFront(points);

    expect(points.map((point) => point.depth)).toEqual([1, 2]);
  });
});

describe("pickPoint", () => {
  const points = [
    { x: 100, y: 100, scale: 1, depth: 5 },
    { x: 104, y: 102, scale: 1, depth: 2 },
    { x: 400, y: 400, scale: 1, depth: 1 },
  ];

  it("picks what is in front where two overlap", () => {
    expect(pickPoint(points, { x: 102, y: 101 }, () => 12)?.depth).toBe(2);
  });

  it("picks nothing where there is nothing", () => {
    expect(pickPoint(points, { x: 250, y: 250 }, () => 12)).toBeNull();
  });

  it("uses each point's own drawn size, so a big one is easier to hit", () => {
    expect(pickPoint(points, { x: 130, y: 100 }, () => 8)).toBeNull();
    expect(pickPoint(points, { x: 130, y: 100 }, () => 40)).not.toBeNull();
  });
});

describe("nearestNeighbours", () => {
  // The lines have to be about the photographs, not about the projection: two
  // can land beside each other in three dimensions and be nothing alike.
  it("ranks by similarity in the full space", () => {
    const vectors = [
      [1, 0, 0, 0],
      [0.99, 0.1, 0, 0], // almost the first
      [0.7, 0.7, 0, 0],
      [0, 0, 1, 0], // nothing like it
    ];

    expect(nearestNeighbours(vectors, 2)[0]).toEqual([1, 2]);
    expect(nearestNeighbours(vectors, 3)[0]).toEqual([1, 2, 3]);
  });

  it("never makes a photograph its own neighbour", () => {
    const vectors = Array.from({ length: 6 }, (_, index) => spike(8, index % 3, 1 + index));

    nearestNeighbours(vectors, 3).forEach((row, index) => {
      expect(row).not.toContain(index);
      expect(new Set(row).size).toBe(row.length);
    });
  });

  it("cares about direction rather than length", () => {
    const vectors = [
      [1, 0, 0],
      [8, 0, 0], // the same photograph, louder
      [0, 1, 0],
    ];

    expect(nearestNeighbours(vectors, 1)[0]).toEqual([1]);
  });

  it("asks for no more neighbours than there are photographs", () => {
    expect(
      nearestNeighbours(
        [
          [1, 0],
          [0, 1],
        ],
        5,
      )[0],
    ).toHaveLength(1);
  });

  it("has nothing to join when there is nothing, or nobody to join to", () => {
    expect(nearestNeighbours([])).toEqual([]);
    expect(nearestNeighbours([[1, 2, 3]])).toEqual([[]]);
    expect(
      nearestNeighbours(
        [
          [1, 0],
          [0, 1],
        ],
        0,
      ),
    ).toEqual([[], []]);
  });

  it("survives a photograph with no vector at all", () => {
    expect(
      nearestNeighbours(
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        1,
      ),
    ).toHaveLength(3);
  });
});

describe("clusterPoints", () => {
  const around = (centre: SpacePoint, count: number, spread = 0.02): SpacePoint[] =>
    Array.from({ length: count }, (_, index) => ({
      x: centre.x + Math.sin(index) * spread,
      y: centre.y + Math.cos(index) * spread,
      z: centre.z + Math.sin(index * 2) * spread,
    }));

  const corners: SpacePoint[] = [
    { x: -0.8, y: -0.8, z: -0.8 },
    { x: 0.8, y: 0.8, z: -0.8 },
    { x: 0.8, y: -0.8, z: 0.8 },
  ];

  it("finds the clumps that are actually there", () => {
    const points = corners.flatMap((corner) => around(corner, 12));
    const clusters = clusterPoints(points, 3);

    expect(clusters).toHaveLength(3);
    for (const cluster of clusters) {
      // Every member of a cluster came from the same corner.
      const corner = Math.floor((cluster.members[0] as number) / 12);
      expect(cluster.members.every((index) => Math.floor(index / 12) === corner)).toBe(true);
    }
  });

  // A build that seeded its clusters randomly would label the same collection
  // differently every time.
  it("is the same on every build", () => {
    const points = corners.flatMap((corner) => around(corner, 8));

    expect(clusterPoints(points, 3)).toEqual(clusterPoints(points, 3));
  });

  it("asks for no more clusters than there are photographs", () => {
    expect(clusterPoints(around({ x: 0, y: 0, z: 0 }, 2), 9)).toHaveLength(2);
  });

  it("has nothing to cluster when there is nothing", () => {
    expect(clusterPoints([], 4)).toEqual([]);
    expect(clusterPoints(around({ x: 0, y: 0, z: 0 }, 4), 0)).toEqual([]);
  });
});

describe("distinctiveTag", () => {
  // Frequency alone labels every cluster with whatever the collection is mostly
  // about; the question worth asking is what this group is about that the rest
  // is not.
  it("prefers the tag that is unusual here rather than the one that is common everywhere", () => {
    const overall = new Map([
      ["japan", 900],
      ["waterfall", 30],
    ]);
    const members = Array.from({ length: 20 }, () => ["japan", "waterfall"]);

    expect(distinctiveTag(members, overall)).toBe("waterfall");
  });

  it("ignores a tag that barely appears in the cluster", () => {
    const overall = new Map([["heron", 2]]);

    expect(distinctiveTag([["heron"], ["heron"]], overall)).toBeNull();
  });

  // Smoothing: a tag seen twice in the whole archive would otherwise win on a
  // ratio of two.
  it("does not let a rarity win on a ratio alone", () => {
    const overall = new Map([
      ["oddity", 3],
      ["forest", 60],
    ]);
    const members = Array.from({ length: 40 }, (_, index) =>
      index < 3 ? ["oddity", "forest"] : ["forest"],
    );

    expect(distinctiveTag(members, overall)).toBe("forest");
  });

  it("counts a photograph once however many times it repeats a tag", () => {
    const overall = new Map([["shrine", 10]]);

    expect(distinctiveTag([["shrine", "shrine", "shrine"]], overall, 2)).toBeNull();
  });

  it("has nothing to say about a cluster with no tags", () => {
    expect(distinctiveTag([], new Map())).toBeNull();
  });
});
