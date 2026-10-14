import { loadHomePageData } from "../../../services/pageData/home";

// This route is a build adapter: the album list, in the home page's order, is
// generated once and served at a stable, framework-neutral URL. An album page
// reads it for its neighbours instead of loading every album to find them.
export const dynamic = "force-static";

export const GET = async (): Promise<Response> =>
  Response.json(await loadHomePageData(), {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
