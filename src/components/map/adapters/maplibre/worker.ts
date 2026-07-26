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
 * `bin/prepare-maplibre-vendor.cjs`) and pointed at explicitly. The worker and
 * `maplibre-gl-shared.mjs` live together beneath the installed MapLibre version.
 * That versioned path makes an old controlling service worker miss its cache
 * after an upgrade instead of handing the new main bundle an older worker.
 */
const workerUrl = (): string =>
  `/vendor/maplibre-gl/${encodeURIComponent(gl.getVersion())}/maplibre-gl-worker.mjs`;

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
  gl.setWorkerUrl(workerUrl());
  applied = true;
};
