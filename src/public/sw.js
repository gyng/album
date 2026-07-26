const WORKER_BUILD_VERSION = new URL(self.location.href).searchParams.get("v") || "unversioned";
const VERSION = `snapshots-pwa-${WORKER_BUILD_VERSION}`;
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
// Deliberately outside the build generation. Album media live at content URLs
// rather than hashed build chunks, so a new generation cannot orphan them, and
// generation-scoping this would make every code deploy evict an installed photo
// frame's entire offline library. Only RUNTIME_CACHE holds per-build chunks.
const IMAGE_CACHE = "snapshots-pwa-images";
// Album media are keyed by original filename, not a content hash, so a re-edited
// photo reuses its URL. A cache-first strategy would pin the first bytes forever
// and never bound its own growth; stale-while-revalidate refreshes in the
// background and this cap evicts the oldest entries so the store cannot grow
// without limit.
//
// Sizing: an offline photo-frame library of ~1.5k photos served at two variants
// (thumbnail + full) is ~3k entries, and this cache also holds non-image /data/
// payloads, so a lower cap would silently punch holes in a large offline
// library. 4000 covers that with headroom while still bounding growth.
const IMAGE_CACHE_MAX_ENTRIES = 4000;
// A thumbnail reveal can expose well over a hundred cached photos in a few
// frames. Revalidating every one concurrently holds all of those response
// bodies and starts a full Cache Storage trim for each, which can starve a map
// worker request or exhaust Firefox during a reload. Four keeps the background
// work moving without turning one zoom gesture into an unbounded fetch burst.
const IMAGE_REVALIDATION_CONCURRENCY = 4;

const SHELL_DOCUMENTS = ["/", "/slideshow", "/slideshow/shell", "/slideshow/diagnostics"];
const SHELL_STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/pwa-icon.svg",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.svg",
];
const PRECACHE_DATA_PATHS = ["/search.sqlite", "/search-embeddings.sqlite"];

const isSameOrigin = (url) => url.origin === self.location.origin;
const isGeneratedAsset = (url) => /\.(?:css|js|mjs|wasm|otf|ttf|woff|woff2)$/i.test(url.pathname);
const isOfflineDataPath = (url) => url.pathname.endsWith(".sqlite");
// MapLibre's worker and the module it shares with the main bundle. Vendored
// because MapLibre 6 locates its worker from `import.meta.url`, which a bundled
// build cannot resolve — see `bin/prepare-maplibre-vendor.cjs`.
const isVendoredWorker = (url) => url.pathname.startsWith("/vendor/");

const documentAssetUrls = (html) => {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], self.location.origin);
    if (isSameOrigin(url) && isGeneratedAsset(url)) {
      urls.add(url.href);
    }
  }
  return [...urls];
};

const fetchAndStore = async (cache, request) => {
  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(`Failed to precache ${request}: ${response.status}`);
  }
  await cache.put(request, response.clone());
  return response;
};

const installOfflineShell = async () => {
  const [shellCache, runtimeCache, imageCache] = await Promise.all([
    caches.open(SHELL_CACHE),
    caches.open(RUNTIME_CACHE),
    caches.open(IMAGE_CACHE),
  ]);
  const documents = await Promise.all(
    SHELL_DOCUMENTS.map(async (pathname) => {
      // Bypass the HTTP cache for the shell HTML. A stale cached document can
      // reference hashed chunks that no longer exist, which makes fetchAndStore
      // throw for the missing chunk and rejects the whole install.
      const response = await fetch(pathname, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Failed to precache ${pathname}: ${response.status}`);
      }
      return { pathname, response, html: await response.clone().text() };
    }),
  );
  const generatedAssets = new Set(documents.flatMap(({ html }) => documentAssetUrls(html)));

  // Store a document only after all of its generated dependencies are safe.
  // This avoids publishing cached HTML that points at unavailable JS/CSS.
  await Promise.all([...generatedAssets].map((url) => fetchAndStore(runtimeCache, url)));
  await Promise.all(documents.map(({ pathname, response }) => shellCache.put(pathname, response)));

  // The manifest is what makes the app installable, so it stays mandatory. The
  // icons are cosmetic and several are build-generated rather than committed, so
  // they are best-effort for the same reason as the databases below: a deploy
  // missing one PNG must not reject install and silently leave the PWA with no
  // offline support at all. Registration failures are only logged.
  await fetchAndStore(runtimeCache, SHELL_STATIC_ASSETS[0]);
  await Promise.allSettled(
    SHELL_STATIC_ASSETS.slice(1).map((url) => fetchAndStore(imageCache, url)),
  );

  // Database precaching is best-effort: the core search DB is normally
  // present, while the split embeddings DB may be intentionally omitted.
  // Either way, a missing optional data file must not prevent PWA install.
  await Promise.allSettled(PRECACHE_DATA_PATHS.map((url) => fetchAndStore(runtimeCache, url)));
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone()).catch(() => {
      // Cache quota or storage failures must not hide a valid response.
    });
  }
  return response;
};

const trimCache = async (cache, maxEntries) => {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) {
    return;
  }
  // Cache.keys() preserves insertion order, so the entries at the front are the
  // oldest. Drop just enough of them to return to the cap.
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
};

// URLs whose media bytes have been fetched (cold download) or revalidated
// during this worker's lifetime. Bounds background revalidation to at most
// once per URL per lifetime: without it a kiosk re-downloads full image bytes
// on every single hit. The hit path marks a URL before scheduling its
// revalidation (deduping concurrent hits); only a thrown network error
// (offline) unmarks it for retry — a non-ok response keeps the mark, see
// revalidateImageInBackground below.
const revalidatedImageUrls = new Set();

// Fetch fresh media and store it, bounded by the cache cap. Uses `no-cache` so
// the request is conditional (ETag/Last-Modified): a server that supports
// validators answers unchanged media with a cheap 304 instead of resending the
// bytes, and — crucially — a long `max-age` response header cannot let the HTTP
// cache satisfy this from disk and skip revalidation entirely.
const fetchImageAndStore = async (cache, request) => {
  const response = await fetch(request, { cache: "no-cache" });
  if (response.ok) {
    await cache.put(request, response.clone()).catch(() => {
      // Cache quota or storage failures must not hide a valid response.
    });
    await trimCache(cache, IMAGE_CACHE_MAX_ENTRIES).catch(() => {
      // Eviction is best-effort; a failed trim must not break the response.
    });
  }
  return response;
};

// Background revalidation for the stale-while-revalidate hit path below. The
// caller has already marked the URL as done (in revalidatedImageUrls) before
// scheduling this. Only a thrown network error (offline) undoes that mark so
// the next hit retries; a non-ok response (e.g. the media was deleted
// server-side) keeps the mark, because unmarking it would turn every later
// hit into a fresh doomed round-trip for the worker's whole lifetime.
const revalidateImageInBackground = async (cache, request) => {
  try {
    await fetchImageAndStore(cache, request);
  } catch (_error) {
    revalidatedImageUrls.delete(request.url);
  }
};

const pendingImageRevalidations = [];
let activeImageRevalidations = 0;

const drainImageRevalidations = () => {
  while (
    activeImageRevalidations < IMAGE_REVALIDATION_CONCURRENCY &&
    pendingImageRevalidations.length > 0
  ) {
    const next = pendingImageRevalidations.shift();
    activeImageRevalidations += 1;
    void next().finally(() => {
      activeImageRevalidations -= 1;
      drainImageRevalidations();
    });
  }
};

// Each caller gives the resulting promise to FetchEvent.waitUntil(), so queued
// work keeps the worker alive just like immediately-started revalidation did.
const queueImageRevalidation = (cache, request) =>
  new Promise((resolve) => {
    pendingImageRevalidations.push(async () => {
      await revalidateImageInBackground(cache, request);
      resolve();
    });
    drainImageRevalidations();
  });

// Stale-while-revalidate for original-filename album media: serve the cached
// copy immediately, refresh it in the background at most once per URL per worker
// lifetime (failures ignored so offline stays fine), and keep the unversioned
// cache bounded after each write.
const staleWhileRevalidateImage = async (request, event) => {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // respondWith settles immediately with the cached copy. Revalidate in the
    // background only if we have not already done so this lifetime and we can
    // keep the worker alive to finish the write and trim.
    if (!revalidatedImageUrls.has(request.url) && typeof event.waitUntil === "function") {
      revalidatedImageUrls.add(request.url);
      event.waitUntil(queueImageRevalidation(cache, request));
    }
    return cached;
  }

  // Nothing cached yet — this is the initial download, not a revalidation, so
  // it is not subject to the throttle above. Return the network response as
  // soon as it arrives rather than waiting on it to be written to the cache:
  // trimCache does a full cache.keys() scan (up to IMAGE_CACHE_MAX_ENTRIES
  // entries) and must not delay first paint of a cold image. The write is
  // started immediately and kept alive separately via waitUntil.
  let response;
  try {
    response = await fetch(request, { cache: "no-cache" });
  } catch (_error) {
    return new Response(null, { status: 504 });
  }
  if (response.ok) {
    // The full bytes were fetched moments ago — mark the URL as fresh so the
    // next hit serves from cache without immediately revalidating it.
    revalidatedImageUrls.add(request.url);
    const responseToCache = response.clone();
    const store = (async () => {
      await cache.put(request, responseToCache).catch(() => {
        // Cache quota or storage failures must not hide a valid response.
      });
      await trimCache(cache, IMAGE_CACHE_MAX_ENTRIES).catch(() => {
        // Eviction is best-effort; a failed trim must not break the response.
      });
    })();
    if (typeof event.waitUntil === "function") {
      event.waitUntil(store);
    }
  }
  return response;
};

const staleWhileRevalidate = async (request, cacheName, event) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone()).catch(() => {
          // Cache quota or storage failures must not hide a valid response.
        });
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // respondWith may settle immediately with the stale response. Keep the
    // worker alive separately until its background revalidation is stored.
    event.waitUntil(networkPromise);
    return cached;
  }
  return (await networkPromise) ?? new Response(null, { status: 504 });
};

const networkFirst = async (
  request,
  cacheName,
  { fallbackOnErrorResponse = false, fallbackRequest, waitForCache = false, cacheKey, event } = {},
) => {
  const cache = await caches.open(cacheName);
  const matchFallback = async () =>
    (await cache.match(request)) ?? (fallbackRequest ? await cache.match(fallbackRequest) : null);
  let response;
  try {
    response = await fetch(request);
  } catch (_error) {
    const cached = await matchFallback();
    if (cached) {
      return cached;
    }
    throw _error;
  }

  if (!response.ok && fallbackOnErrorResponse) {
    const cached = await matchFallback();
    return cached ?? response;
  }

  if (response.ok) {
    const store = cache.put(cacheKey ?? request, response.clone()).catch(() => {
      // Cache quota or storage failures must not hide a valid network response.
    });
    if (waitForCache) {
      // Keep the respondWith promise pending until the offline fallback is
      // safely stored. A worker may be terminated once that promise settles.
      await store;
    } else if (event) {
      // respondWith settles as soon as the response is returned, so hold the
      // worker open separately until the write lands, as staleWhileRevalidate
      // does. Otherwise the document may never reach the cache.
      event.waitUntil(store);
    }
  }
  return response;
};

self.addEventListener("install", (event) => {
  event.waitUntil(installOfflineShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("snapshots-pwa-") &&
                key !== SHELL_CACHE &&
                key !== RUNTIME_CACHE &&
                key !== IMAGE_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  if (event.request.mode === "navigate") {
    // Key the document by pathname. The slideshow is configured entirely through
    // the query string, and every distinct one returns the same shell HTML, so
    // storing per full URL would grow the cache without bound and never be read
    // back — the offline fallback already matches on pathname.
    event.respondWith(
      networkFirst(event.request, SHELL_CACHE, {
        fallbackOnErrorResponse: true,
        fallbackRequest: url.pathname,
        cacheKey: url.pathname,
        event,
      }),
    );
    return;
  }

  if (SHELL_STATIC_ASSETS.includes(url.pathname)) {
    const cacheName = event.request.destination === "image" ? IMAGE_CACHE : RUNTIME_CACHE;
    event.respondWith(cacheFirst(event.request, cacheName));
    return;
  }

  // This build-derived index has a stable public URL. Always revalidate it so
  // a data-only deployment cannot be hidden by the long-lived media cache;
  // networkFirst still provides the most recent copy while offline.
  if (url.pathname === "/data/map-search-index.json") {
    event.respondWith(
      networkFirst(event.request, RUNTIME_CACHE, {
        fallbackOnErrorResponse: true,
        waitForCache: true,
      }),
    );
    return;
  }

  // The SQLite databases are the slideshow's application data. Keep the last
  // successfully fetched copies available so an installed photo-frame PWA can
  // restart offline; online requests still revalidate before using the cache.
  // The worker modules live beneath the installed MapLibre version so even an
  // older controlling service worker misses its cache after an upgrade. Keep
  // all vendor paths network-first as a second defence: it repairs a truncated
  // cached copy and protects readers whose older bundle still requests the
  // legacy stable paths. The failure is quiet and total — the worker fetches
  // the tiles, so a worker that does not come up leaves the map at "ready" with
  // a blank basemap. Keep the cache as the offline fallback.
  if (isVendoredWorker(url)) {
    event.respondWith(
      networkFirst(event.request, RUNTIME_CACHE, {
        fallbackOnErrorResponse: true,
        event,
      }),
    );
    return;
  }

  if (isOfflineDataPath(url)) {
    event.respondWith(
      networkFirst(event.request, RUNTIME_CACHE, {
        fallbackOnErrorResponse: true,
        waitForCache: true,
      }),
    );
    return;
  }

  if (event.request.destination === "image" || url.pathname.startsWith("/data/")) {
    event.respondWith(staleWhileRevalidateImage(event.request, event));
    return;
  }

  // Destination stays the primary classifier, but it cannot be the only one. A
  // WebAssembly binary is fetched by its own glue code with an empty
  // destination, and a worker chunk arrives as "worker", so neither matches the
  // destinations below. Both are also loaded at runtime rather than named in the
  // HTML, so install cannot discover them either. Without the extension check,
  // SQLite's wasm is the one required artifact left uncached: a cold offline
  // start restores the shell and the database, then cannot initialise to read
  // it. Matching on extension keeps this renderer-neutral — no framework-owned
  // URL prefix is involved.
  if (
    event.request.destination === "script" ||
    event.request.destination === "style" ||
    event.request.destination === "font" ||
    isGeneratedAsset(url)
  ) {
    event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE, event));
  }
});
