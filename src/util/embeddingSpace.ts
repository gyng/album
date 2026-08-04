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
 * Vectors to a cloud: the three directions this collection varies along most,
 * scaled into a cube from -1 to 1 so a camera can be written once.
 */
export const projectToThreeDimensions = (vectors: readonly (readonly number[])[]): SpacePoint[] => {
  const dimensions = vectors[0]?.length ?? 0;
  if (vectors.length < 2 || dimensions < 3) {
    return vectors.map(() => ({ x: 0, y: 0, z: 0 }));
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

  const extent = projected.reduce(
    (widest, point) => Math.max(widest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)),
    0,
  );
  if (extent === 0) return projected;

  return projected.map((point) => ({
    x: point.x / extent,
    y: point.y / extent,
    z: point.z / extent,
  }));
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

  const size = Math.min(viewport.width, viewport.height) / 2;
  const scale = (FOCAL_LENGTH * camera.distance) / depth;

  return {
    x: viewport.width / 2 + x * scale * size,
    // Screen y grows downwards; the cloud's does not.
    y: viewport.height / 2 - y * scale * size,
    scale,
    depth,
  };
};

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
