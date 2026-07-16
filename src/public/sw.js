const WORKER_BUILD_VERSION = new URL(self.location.href).searchParams.get("v") || "unversioned";
const VERSION = `snapshots-pwa-${WORKER_BUILD_VERSION}`;
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
// Deliberately outside the build generation. Album media live at content URLs
// rather than hashed build chunks, so a new generation cannot orphan them, and
// generation-scoping this would make every code deploy evict an installed photo
// frame's entire offline library. Only RUNTIME_CACHE holds per-build chunks.
const IMAGE_CACHE = "snapshots-pwa-images";

const SHELL_DOCUMENTS = ["/", "/slideshow"];
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
      const response = await fetch(pathname);
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
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
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
