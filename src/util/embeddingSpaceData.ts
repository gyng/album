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
  tag?: string;
  x: number;
  y: number;
  z: number;
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
export const fetchEmbeddingSpace = async (
  fetcher: FetchLike = (input, init) => fetch(input, init as RequestInit),
): Promise<EmbeddingSpaceEntry[]> => {
  const response = await fetcher(EMBEDDING_SPACE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load the embedding space (${response.status ?? "unknown"})`);
  }

  const payload = (await response.json()) as { points?: unknown };
  return Array.isArray(payload.points) ? payload.points.filter(isEntry) : [];
};
