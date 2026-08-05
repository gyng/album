/**
 * The cloud, as the browser gets it.
 *
 * Framework-neutral and Node-free: the payload is built at a stable URL by a
 * build adapter, and this is the only thing that knows the URL or the shape.
 */

export type EmbeddingSpaceEntry = {
  src: string;
  href: string;
  label: string;
  album?: string;
  swatch?: string;
  /** What the captioner said is in it, most telling first. */
  tags?: string[];
  /** Its cell on the contact sheet, when the build made one. */
  slot?: number;
  /** The photographs the model reads as most like this one, by index. */
  near?: number[];
  /** Which named clump it fell in, as an index into the clusters. */
  cluster?: number;
  x: number;
  y: number;
  z: number;
};

/**
 * The contact sheet every photograph in the cloud is drawn from.
 *
 * One image rather than fifteen hundred requests: at the smallest variant this
 * site publishes that would be about a hundred and fifty megabytes, and this is
 * under half a megabyte.
 */
export type EmbeddingSpaceAtlas = {
  cell: number;
  sheet: number;
  perSheet: number;
  files: string[];
};

/** What one clump of the cloud turned out to be about. */
export type EmbeddingSpaceCluster = {
  x: number;
  y: number;
  z: number;
  label: string;
  count: number;
};

/**
 * How much each axis was stretched to fill the cube.
 *
 * The turning view wants the stretch — the components come out ordered by
 * variance, and a faithful cloud is a pancake. The flat view is a scatter plot
 * of the first two components and wants their real proportions, which is what
 * multiplying by these gives back.
 */
export type EmbeddingAxisScale = { x: number; y: number; z: number };

export type EmbeddingSpace = {
  points: EmbeddingSpaceEntry[];
  clusters: EmbeddingSpaceCluster[];
  axisScale: EmbeddingAxisScale;
  atlas: EmbeddingSpaceAtlas | null;
};

export const EMBEDDING_SPACE_URL = "/data/embedding-space.json";

type FetchLike = (
  input: string,
  init?: { cache?: RequestCache },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

const isEntry = (value: unknown): value is EmbeddingSpaceEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.src === "string" &&
    typeof entry.href === "string" &&
    typeof entry.x === "number" &&
    typeof entry.y === "number" &&
    typeof entry.z === "number"
  );
};

/**
 * `no-store` for the same reason the map search index uses it: the payload is
 * regenerated on every deploy and a stale copy is a cloud of photographs that
 * are no longer there.
 */
const isCluster = (value: unknown): value is EmbeddingSpaceCluster => {
  if (typeof value !== "object" || value === null) return false;
  const cluster = value as Record<string, unknown>;
  return (
    typeof cluster.x === "number" &&
    typeof cluster.y === "number" &&
    typeof cluster.z === "number" &&
    typeof cluster.label === "string"
  );
};

const isAtlas = (value: unknown): value is EmbeddingSpaceAtlas => {
  if (typeof value !== "object" || value === null) return false;
  const atlas = value as Record<string, unknown>;
  return (
    typeof atlas.cell === "number" &&
    typeof atlas.sheet === "number" &&
    typeof atlas.perSheet === "number" &&
    Array.isArray(atlas.files) &&
    atlas.files.every((file) => typeof file === "string")
  );
};

export const fetchEmbeddingSpace = async (
  fetcher: FetchLike = (input, init) => fetch(input, init as RequestInit),
): Promise<EmbeddingSpace> => {
  const response = await fetcher(EMBEDDING_SPACE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load the embedding space (${response.status ?? "unknown"})`);
  }

  const payload = (await response.json()) as {
    points?: unknown;
    clusters?: unknown;
    axisScale?: unknown;
    atlas?: unknown;
  };
  const scale = payload.axisScale as Partial<EmbeddingAxisScale> | undefined;
  return {
    axisScale: {
      x: typeof scale?.x === "number" ? scale.x : 1,
      y: typeof scale?.y === "number" ? scale.y : 1,
      z: typeof scale?.z === "number" ? scale.z : 1,
    },
    points: Array.isArray(payload.points) ? payload.points.filter(isEntry) : [],
    clusters: Array.isArray(payload.clusters) ? payload.clusters.filter(isCluster) : [],
    atlas: isAtlas(payload.atlas) ? payload.atlas : null,
  };
};

/**
 * The database's own key for a photograph, recovered from the URL of its
 * optimised variant.
 *
 * The cloud's payload carries what the browser needs to *draw* a photograph;
 * search identifies one by the path the indexer keyed it under. Rather than
 * ship both for fifteen hundred photographs — sixty kilobytes to say the same
 * thing twice — the key is derived, because the URL is built from it.
 */
export const indexedPathFromSrc = (src: string, albumsDir = "../albums"): string | null => {
  const match = /\/data\/albums\/([^/]+)\/\.resized_images\/(.+?)(?:%40|@)\d+\.[a-z0-9]+$/i.exec(
    src,
  );
  if (!match) return null;

  try {
    return `${albumsDir}/${decodeURIComponent(match[1] ?? "")}/${decodeURIComponent(match[2] ?? "")}`;
  } catch {
    // A malformed escape is not worth taking a selection down for.
    return null;
  }
};
