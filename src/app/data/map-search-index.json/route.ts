import { loadMapSearchIndexEntries } from "../../../services/mapSearchIndex";

// This route is a build adapter: the payload is generated once from album
// sources and served at a stable, framework-neutral URL.
export const dynamic = "force-static";

export const GET = async (): Promise<Response> => {
  const entries = await loadMapSearchIndexEntries();
  return Response.json(
    { entries },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    },
  );
};
