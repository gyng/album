import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { DEFAULT_ROOT } from "./folders.ts";

const port = Number(process.env.GEOTAG_PORT ?? 8788);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`geotag api listening on http://127.0.0.1:${port} (start: ${DEFAULT_ROOT})`);
});
