import { loadEmbeddingSpace } from "../../../services/embeddingSpace";

// This route is a build adapter: the payload is generated once from the album
// sources and the embeddings database, and served at a stable, framework-neutral
// URL.
export const dynamic = "force-static";

export const GET = async (): Promise<Response> => {
  const points = await loadEmbeddingSpace();
  return Response.json(
    { points },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    },
  );
};
