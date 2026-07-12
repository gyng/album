import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { DEFAULT_ROOT } from "./folders.ts";
import { closeExiftool } from "./geotagWrite.ts";
import { closeLensExiftool } from "./lensWrite.ts";

const port = Number(process.env.GEOTAG_PORT ?? 8788);
const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`geotag api listening on http://127.0.0.1:${port} (start: ${DEFAULT_ROOT})`);
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  server.close();
  await Promise.all([closeExiftool(), closeLensExiftool()]);
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
