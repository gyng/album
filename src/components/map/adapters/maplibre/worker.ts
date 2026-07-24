import { gl } from "./engine";

/**
 * MapLibre 6 ships ESM only and resolves its tile worker from `import.meta.url`
 * inside its own bundle. Turbopack's production build does not leave that as an
 * `http(s):` URL, so MapLibre's resolver bails out and returns an empty string —
 * and an empty worker URL is not an error there, it is `new Worker("")`, which
 * the browser resolves against the document. The map then loads the *page* as
 * its worker, the worker dies parsing HTML, no tile is ever requested, `load`
 * never fires, and the map sits there as a blank canvas with no children. It
 * fails silently: nothing throws and nothing reaches an error boundary.
 *
 * So the worker is served as a static vendor asset instead (see
 * `bin/prepare-maplibre-vendor.cjs`, which copies it next to MapLibre's
 * stylesheet) and pointed at explicitly. The worker imports
 * `maplibre-gl-shared.mjs` from the same directory, so both files are copied and
 * neither may be renamed.
 */
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

let applied = false;

/**
 * Idempotent, and must run before the first `new gl.Map(...)`.
 *
 * The flag is set *after* the call, not before: if `setWorkerUrl` throws, the
 * worker has not been installed, and marking it as done would leave every later
 * map on the page silently falling back to the broken empty-worker path.
 */
export const installVendoredWorker = (): void => {
  if (applied) {
    return;
  }
  gl.setWorkerUrl(WORKER_URL);
  applied = true;
};
