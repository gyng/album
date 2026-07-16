const WORKER_BUILD_VERSION = new URL(self.location.href).searchParams.get("v") || "unversioned";
const VERSION = `snapshots-pwa-${WORKER_BUILD_VERSION}`;
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const IMAGE_CACHE = `${VERSION}-images`;

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
const isGeneratedAsset = (url) => /\.(?:css|js|mjs|otf|ttf|woff|woff2)$/i.test(url.pathname);
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

  await Promise.all([
    fetchAndStore(runtimeCache, SHELL_STATIC_ASSETS[0]),
    ...SHELL_STATIC_ASSETS.slice(1).map((url) => fetchAndStore(imageCache, url)),
  ]);

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
  { fallbackOnErrorResponse = false, fallbackRequest, waitForCache = false } = {},
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
    const store = cache.put(request, response.clone()).catch(() => {
      // Cache quota or storage failures must not hide a valid network response.
    });
    if (waitForCache) {
      // Keep the respondWith promise pending until the offline fallback is
      // safely stored. A worker may be terminated once that promise settles.
      await store;
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
    event.respondWith(
      networkFirst(event.request, SHELL_CACHE, {
        fallbackOnErrorResponse: true,
        fallbackRequest: url.pathname,
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

  if (
    event.request.destination === "script" ||
    event.request.destination === "style" ||
    event.request.destination === "font"
  ) {
    event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE, event));
  }
});
