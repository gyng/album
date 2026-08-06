/**
 * The embedding space, made small enough to look at.
 *
 * Every photograph carries a 768-dimension SigLIP vector describing what is in
 * it. Nobody can see 768 dimensions, but the three directions along which this
 * particular collection varies most are a real, defensible view of it — so
 * principal components take the corpus down to a cloud you can turn around.
 *
 * What you get out of it is not a chart: nearby means "these look and read
 * alike to the model", and the axes have no names. That is the point — the
 * clusters are the collection's own subjects, not ones anybody chose.
 *
 * Pure and framework-neutral: the projection runs at build time, the camera
 * runs sixty times a second in a canvas, and both are testable without either.
 */

export type SpacePoint = { x: number; y: number; z: number };

/**
 * How much a thin axis may be stretched to fill the view.
 *
 * Three is enough to turn the usual pancake into something with depth, and
 * little enough that an axis carrying almost nothing stays visibly thin rather
 * than becoming a cloud of amplified noise.
 */
const MAX_AXIS_STRETCH = 3;

/** How many times a component is refined. Ten is past convergence for this data. */
const POWER_ITERATIONS = 24;

const dot = (a: readonly number[], b: readonly number[]): number => {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += (a[index] as number) * (b[index] as number);
  }
  return total;
};

const normalise = (vector: number[]): number[] => {
  const length = Math.sqrt(dot(vector, vector));
  return length === 0 ? vector : vector.map((value) => value / length);
};

/**
 * A starting direction that is the same on every build.
 *
 * Deterministic rather than random: a build that ran twice would otherwise
 * publish a cloud rotated into a different pose, and every reader would
 * re-download it for no visible change.
 */
const seedVector = (dimensions: number, component: number): number[] =>
  normalise(
    Array.from({ length: dimensions }, (_, index) => Math.sin((index + 1) * (component + 1) * 0.7)),
  );

/** The direction of greatest remaining variance, by power iteration. */
const principalComponent = (rows: readonly (readonly number[])[], component: number): number[] => {
  const dimensions = rows[0]?.length ?? 0;
  let vector = seedVector(dimensions, component);

  for (let step = 0; step < POWER_ITERATIONS; step += 1) {
    const next: number[] = Array.from({ length: dimensions }, () => 0);
    // Covariance times the vector, without ever building the covariance matrix:
    // 768×768 doubles would be six megabytes to answer one question.
    for (const row of rows) {
      const projection = dot(row, vector);
      for (let index = 0; index < dimensions; index += 1) {
        next[index] = (next[index] as number) + projection * (row[index] as number);
      }
    }

    const length = Math.sqrt(dot(next, next));
    // Nothing left to find: a collection that genuinely lies in a plane has no
    // third direction, and answering with the arbitrary seed would invent a
    // depth axis out of the first two.
    if (length === 0) return Array.from({ length: dimensions }, () => 0);
    vector = next.map((value) => value / length);
  }

  return vector;
};

/**
 * A direction with the ones already taken removed from it.
 *
 * Deflation leaves floating-point residue, so the third power iteration on a
 * collection that really lies in a plane converges on numerical noise pointing
 * back into the first two directions. Projecting onto that produces a depth
 * axis made entirely of the axes already on screen — a cloud that looks
 * three-dimensional and is not. Anything this short after orthogonalising had
 * no variance of its own, so it becomes no axis at all.
 */
const ORTHOGONAL_RESIDUE = 1e-6;

const orthogonalise = (
  axis: readonly number[],
  taken: readonly (readonly number[])[],
): number[] => {
  const residual = [...axis];
  for (const previous of taken) {
    const projection = dot(residual, previous);
    for (let index = 0; index < residual.length; index += 1) {
      residual[index] = (residual[index] as number) - projection * (previous[index] as number);
    }
  }

  const length = Math.sqrt(dot(residual, residual));
  return length < ORTHOGONAL_RESIDUE
    ? Array.from({ length: axis.length }, () => 0)
    : residual.map((value) => value / length);
};

/** Removes a direction from every row, so the next component finds something new. */
const deflate = (rows: number[][], direction: readonly number[]): void => {
  for (const row of rows) {
    const projection = dot(row, direction);
    for (let index = 0; index < row.length; index += 1) {
      row[index] = (row[index] as number) - projection * (direction[index] as number);
    }
  }
};

/**
 * How much each axis was stretched to fill the cube, relative to the widest.
 *
 * The cloud is stretched so it can be turned; the flat view is a scatter plot
 * and wants the proportions the data actually has. Multiplying a point's
 * coordinate by its axis's figure here undoes the stretch exactly.
 */
export type AxisScale = { x: number; y: number; z: number };

export type Projection = { points: SpacePoint[]; axisScale: AxisScale };

/**
 * Vectors to a cloud: the three directions this collection varies along most,
 * scaled into a cube from -1 to 1 so a camera can be written once.
 */
export const projectToThreeDimensions = (vectors: readonly (readonly number[])[]): Projection => {
  const dimensions = vectors[0]?.length ?? 0;
  const unscaled = { x: 1, y: 1, z: 1 };
  if (vectors.length < 2 || dimensions < 3) {
    return { points: vectors.map(() => ({ x: 0, y: 0, z: 0 })), axisScale: unscaled };
  }

  // Centred first: principal components describe variation around the middle of
  // the data, and an uncentred cloud's first component is just "where it is".
  const centre: number[] = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      centre[index] = (centre[index] as number) + (vector[index] as number);
    }
  }
  for (let index = 0; index < dimensions; index += 1) {
    centre[index] = (centre[index] as number) / vectors.length;
  }

  const rows = vectors.map((vector) =>
    vector.map((value, index) => value - (centre[index] as number)),
  );
  const working = rows.map((row) => [...row]);

  const axes: number[][] = [];
  for (let component = 0; component < 3; component += 1) {
    const axis = orthogonalise(principalComponent(working, component), axes);
    axes.push(axis);
    if (axis.some((value) => value !== 0)) deflate(working, axis);
  }

  const projected = rows.map((row) => ({
    x: dot(row, axes[0] as number[]),
    y: dot(row, axes[1] as number[]),
    z: dot(row, axes[2] as number[]),
  }));

  // Each axis is scaled towards filling the cube on its own rather than all
  // three by the widest. The components are ordered by variance, so a shared
  // scale draws most collections as an almost flat slab — true to the numbers,
  // and useless to turn around, since the third axis is the one that reads as
  // depth. Neighbour relationships and clusters survive a stretch; only the
  // aspect ratio changes.
  //
  // But the stretch is capped, because an axis with almost no variance is
  // numerical noise, and filling the cube with it would invent a depth this
  // collection does not have.
  const extent = {
    x: Math.max(...projected.map((point) => Math.abs(point.x))),
    y: Math.max(...projected.map((point) => Math.abs(point.y))),
    z: Math.max(...projected.map((point) => Math.abs(point.z))),
  };
  const widest = Math.max(extent.x, extent.y, extent.z);
  if (widest === 0) return { points: projected, axisScale: unscaled };

  const divisor = (own: number) => Math.max(own, widest / MAX_AXIS_STRETCH);
  const divisors = { x: divisor(extent.x), y: divisor(extent.y), z: divisor(extent.z) };
  const largest = Math.max(divisors.x, divisors.y, divisors.z);

  return {
    points: projected.map((point) => ({
      x: point.x / divisors.x,
      y: point.y / divisors.y,
      z: point.z / divisors.z,
    })),
    // Normalised so the widest axis is 1: the flat view multiplies by these to
    // get back to the proportions the components actually have.
    axisScale: {
      x: divisors.x / largest,
      y: divisors.y / largest,
      z: divisors.z / largest,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Looking at it                                                               */
/* -------------------------------------------------------------------------- */

export type Camera = {
  /** Turn around the cloud, in radians. */
  yaw: number;
  /** Rise above it, in radians. */
  pitch: number;
  /** How far back the eye is, in cloud units. Below 1 puts the eye inside. */
  distance: number;
};

export type Viewport = { width: number; height: number };

export type ProjectedPoint = {
  /** Screen position in pixels. */
  x: number;
  y: number;
  /** 1 at the centre of the cloud, larger nearer the eye — a size multiplier. */
  scale: number;
  /** Distance from the eye, for drawing far things first. */
  depth: number;
};

/** Perspective strength. Larger is a longer lens: less depth, less distortion. */
const FOCAL_LENGTH = 1.6;

/**
 * How much of the frame the cloud is allowed to fill at rest.
 *
 * The projection is scaled so the edge of the cube lands just inside the
 * shorter side. Without this the cloud is drawn wider than the canvas and its
 * edges are simply missing — and moving the camera back does not help, because
 * at the middle of the cloud the scale is the focal length whatever the
 * distance is.
 */
const FRAME_FILL = 0.95;

/**
 * One point of the cloud on the screen, or nothing when it is behind the eye.
 *
 * A plain perspective divide rather than a matrix stack: there is one camera,
 * it only ever orbits, and the arithmetic being legible is worth more here than
 * generality.
 */
export const projectPoint = (
  point: SpacePoint,
  camera: Camera,
  viewport: Viewport,
): ProjectedPoint | null => {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);

  const x = point.x * cosYaw - point.z * sinYaw;
  const forward = point.x * sinYaw + point.z * cosYaw;
  const y = point.y * cosPitch - forward * sinPitch;
  const depth = point.y * sinPitch + forward * cosPitch + camera.distance;

  if (depth <= 0.05) return null;

  const size = ((Math.min(viewport.width, viewport.height) / 2) * FRAME_FILL) / FOCAL_LENGTH;
  const scale = (FOCAL_LENGTH * camera.distance) / depth;

  return {
    x: viewport.width / 2 + x * scale * size,
    // Screen y grows downwards; the cloud's does not.
    y: viewport.height / 2 - y * scale * size,
    scale,
    depth,
  };
};

/**
 * How much larger the flat view draws the cloud than it does at rest.
 *
 * Flat drops the depth axis, and a projection with no depth is orthographic:
 * `projectPoint`'s scale is `focal × distance ÷ depth`, and with every point at
 * the eye's own distance that is the focal length whatever the distance is. So
 * moving the eye moves nothing, and the wheel — which is only ever allowed to
 * change the distance — did nothing at all in the flat view while still
 * claiming a magnification. The same number the readout shows is applied by
 * hand instead, on the screen positions.
 */
export const flatViewScale = (camera: Camera, restingDistance: number): number =>
  restingDistance / camera.distance;

/**
 * A projected point placed in the flat view: dragged, then magnified about the
 * middle of the frame.
 *
 * `pan` is in unmagnified pixels, which is what lets the two gestures compose —
 * the middle of the frame stays put under a zoom however far the cloud has been
 * dragged, and a drag divided by the same scale tracks the pointer exactly.
 *
 * Everything drawn in the flat view goes through here, points and clump names
 * alike: they were two projections of the same cloud, and only one of them was
 * being dragged, so the names sat where the photographs used to be.
 *
 * The gap between two photographs takes the whole of the zoom; a photograph
 * takes its square root. Growing the marks as fast as the space between them
 * only magnifies the picture — the same mosaic, larger — where the point of
 * zooming into a crowd is that the crowd opens up. At the far end that is a
 * cloud spread four and a half times over with photographs about twice the
 * size, which is room enough to see between them.
 */
export const placeFlat = (
  point: ProjectedPoint,
  viewport: Viewport,
  pan: { x: number; y: number },
  scale: number,
): ProjectedPoint => ({
  x: viewport.width / 2 + (point.x - viewport.width / 2 + pan.x) * scale,
  y: viewport.height / 2 + (point.y - viewport.height / 2 + pan.y) * scale,
  scale: point.scale * Math.sqrt(scale),
  depth: point.depth,
});

/**
 * The points a reader can actually see, with room for a mark that overhangs the
 * edge it is drawn at.
 *
 * What it is for is the budget: only so many points are drawn as photographs,
 * and spending that on the whole cloud meant zooming into a corner left the
 * same fixed share showing itself, most of it off screen — so closing in on a
 * handful of dots brought no photographs up at all.
 */
export const withinFrame = <T extends ProjectedPoint>(
  points: readonly T[],
  viewport: Viewport,
  margin: number,
): T[] =>
  points.filter(
    (point) =>
      point.x > -margin &&
      point.x < viewport.width + margin &&
      point.y > -margin &&
      point.y < viewport.height + margin,
  );

/** Far to near, so nearer photographs are drawn over the ones behind them. */
export const backToFront = <T extends { depth: number }>(points: readonly T[]): T[] =>
  [...points].sort((a, b) => b.depth - a.depth);

/**
 * What the pointer is over: the nearest point to the cursor within its own
 * drawn size, preferring whatever is in front when several overlap.
 */
export const pickPoint = <T extends ProjectedPoint>(
  points: readonly T[],
  at: { x: number; y: number },
  radiusFor: (point: T) => number,
): T | null => {
  let best: T | null = null;
  for (const point of points) {
    const radius = radiusFor(point);
    if (Math.hypot(point.x - at.x, point.y - at.y) > radius) continue;
    if (!best || point.depth < best.depth) best = point;
  }
  return best;
};

/* -------------------------------------------------------------------------- */
/* Who is next to whom                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Each photograph's nearest neighbours, by cosine similarity in the full space.
 *
 * In the *full* space deliberately. Two photographs can land beside each other
 * in three dimensions and be nothing alike — that is what a projection down
 * from 768 costs — so a line drawn from where things ended up on screen would
 * be a line about the projection rather than about the photographs. These are
 * computed before the projection and survive it.
 *
 * Brute force, because it runs once at build time: fifteen hundred photographs
 * is a million pairs, which is a second or two and no dependency.
 */
export const nearestNeighbours = (
  vectors: readonly (readonly number[])[],
  count = 4,
): number[][] => {
  const total = vectors.length;
  const dimensions = vectors[0]?.length ?? 0;
  if (total < 2 || dimensions === 0 || count < 1) {
    return vectors.map(() => []);
  }

  // Normalised once, so a similarity is a dot product and nothing else.
  const unit = new Float32Array(total * dimensions);
  for (let row = 0; row < total; row += 1) {
    const vector = vectors[row] as readonly number[];
    let length = 0;
    for (let index = 0; index < dimensions; index += 1) {
      length += (vector[index] as number) ** 2;
    }
    const scale = length > 0 ? 1 / Math.sqrt(length) : 0;
    for (let index = 0; index < dimensions; index += 1) {
      unit[row * dimensions + index] = (vector[index] as number) * scale;
    }
  }

  const wanted = Math.min(count, total - 1);
  const neighbours: number[][] = [];

  for (let row = 0; row < total; row += 1) {
    // A short list kept sorted beats sorting a thousand similarities per row.
    const best: { index: number; similarity: number }[] = [];

    for (let other = 0; other < total; other += 1) {
      if (other === row) continue;

      let similarity = 0;
      for (let index = 0; index < dimensions; index += 1) {
        similarity +=
          (unit[row * dimensions + index] as number) * (unit[other * dimensions + index] as number);
      }

      if (best.length < wanted) {
        best.push({ index: other, similarity });
        best.sort((a, b) => b.similarity - a.similarity);
      } else if (similarity > (best.at(-1)?.similarity ?? 0)) {
        best[best.length - 1] = { index: other, similarity };
        best.sort((a, b) => b.similarity - a.similarity);
      }
    }

    neighbours.push(best.map((entry) => entry.index));
  }

  return neighbours;
};

/* -------------------------------------------------------------------------- */
/* What the clumps turned out to be                                            */
/* -------------------------------------------------------------------------- */

export type Cluster = { centre: SpacePoint; members: number[] };

const distanceSquared = (a: SpacePoint, b: SpacePoint): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/**
 * Seeds spread out across the cloud, chosen without randomness.
 *
 * Farthest-point sampling: start at the first photograph and repeatedly take
 * whichever is furthest from everything chosen so far. k-means++ would do the
 * same job with a random number generator, and a build that seeds its clusters
 * randomly labels the same collection differently every time.
 */
const spreadSeeds = (points: readonly SpacePoint[], k: number): SpacePoint[] => {
  const seeds: SpacePoint[] = [points[0] as SpacePoint];

  while (seeds.length < k) {
    let furthest = points[0] as SpacePoint;
    let record = -1;
    for (const point of points) {
      const nearest = Math.min(...seeds.map((seed) => distanceSquared(point, seed)));
      if (nearest > record) {
        record = nearest;
        furthest = point;
      }
    }
    seeds.push(furthest);
  }

  return seeds;
};

/**
 * The cloud's own clumps, by k-means over the three dimensions on screen.
 *
 * Over the projected positions rather than the full space on purpose: these
 * exist to label what a reader can actually see grouped together. A cluster in
 * 768 dimensions that the projection has scattered across the view would be a
 * label pointing at nothing.
 */
export const clusterPoints = (
  points: readonly SpacePoint[],
  k: number,
  iterations = 12,
): Cluster[] => {
  if (points.length === 0 || k < 1) return [];

  const wanted = Math.min(k, points.length);
  let centres = spreadSeeds(points, wanted);
  let members: number[][] = [];

  for (let step = 0; step < iterations; step += 1) {
    members = centres.map(() => []);

    points.forEach((point, index) => {
      let best = 0;
      let record = Number.POSITIVE_INFINITY;
      centres.forEach((centre, cluster) => {
        const distance = distanceSquared(point, centre);
        if (distance < record) {
          record = distance;
          best = cluster;
        }
      });
      (members[best] as number[]).push(index);
    });

    centres = centres.map((centre, cluster) => {
      const owned = members[cluster] as number[];
      if (owned.length === 0) return centre;

      return {
        x: owned.reduce((sum, index) => sum + (points[index] as SpacePoint).x, 0) / owned.length,
        y: owned.reduce((sum, index) => sum + (points[index] as SpacePoint).y, 0) / owned.length,
        z: owned.reduce((sum, index) => sum + (points[index] as SpacePoint).z, 0) / owned.length,
      };
    });
  }

  return centres
    .map((centre, cluster) => ({ centre, members: members[cluster] ?? [] }))
    .filter((cluster) => cluster.members.length > 0);
};

/**
 * What to call a clump: the tag that is far commoner inside it than outside.
 *
 * Frequency alone would label every cluster "japan", because most of the
 * collection is. Dividing by how common a tag is everywhere asks a better
 * question — what is this group *about* that the collection as a whole is not —
 * and the smoothing keeps a tag that appears twice in the whole archive from
 * winning on a ratio of two.
 */
export const distinctiveTag = (
  memberTags: readonly (readonly string[])[],
  overall: ReadonlyMap<string, number>,
  minimum = 3,
  smoothing = 12,
): string | null => {
  const counts = new Map<string, number>();
  for (const tags of memberTags) {
    for (const tag of new Set(tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [tag, count] of counts) {
    if (count < minimum) continue;
    const score = count / ((overall.get(tag) ?? count) + smoothing);
    // Ties go to the commoner tag inside the cluster, then to the earlier name,
    // so the same collection always gets the same labels.
    if (score > bestScore || (score === bestScore && best !== null && tag < best)) {
      bestScore = score;
      best = tag;
    }
  }

  return best;
};
