import fs from "node:fs";
import vm from "node:vm";

type FetchEvent = {
  request: {
    method: string;
    url: string;
    mode: string;
    destination: string;
  };
  respondWith: (response: Promise<Response>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type InstallEvent = {
  waitUntil: (promise: Promise<unknown>) => void;
};

const loadInstallHandler = (
  options: { respondTo?: (input: string) => Promise<Response> | undefined } = {},
) => {
  const handlers = new Map<string, (event: InstallEvent) => void>();
  const cacheByName = new Map<string, { match: jest.Mock; put: jest.Mock }>();
  const open = jest.fn(async (name: string) => {
    const cache = cacheByName.get(name) ?? {
      match: jest.fn().mockResolvedValue(undefined),
      put: jest.fn().mockResolvedValue(undefined),
    };
    cacheByName.set(name, cache);
    return cache;
  });
  const fetchMock = jest.fn(async (input: string) => {
    const override = options.respondTo?.(input);
    if (override) {
      return override;
    }
    if (
      input === "/" ||
      input === "/slideshow" ||
      input === "/slideshow/shell" ||
      input === "/slideshow/diagnostics"
    ) {
      const route =
        input === "/"
          ? "home"
          : input === "/slideshow"
            ? "slideshow"
            : input === "/slideshow/shell"
              ? "shell"
              : "diagnostics";
      return new Response(
        `<link rel="stylesheet" href="/assets/${route}.css"><script src="/assets/${route}.js"></script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response(`asset ${input}`, { status: 200 });
  });
  const context = {
    URL,
    Response,
    caches: { open, keys: jest.fn().mockResolvedValue([]) },
    fetch: fetchMock,
    self: {
      location: {
        origin: "https://photos.example.com",
        href: "https://photos.example.com/sw.js?v=test-build",
      },
      addEventListener: (name: string, handler: (event: InstallEvent) => void) => {
        handlers.set(name, handler);
      },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn() },
    },
  };

  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), context);
  return { handler: handlers.get("install")!, cacheByName, fetchMock };
};

const loadActivateHandler = (existingKeys: string[]) => {
  const handlers = new Map<string, (event: InstallEvent) => void>();
  const deleteMock = jest.fn().mockResolvedValue(true);
  const context = {
    URL,
    Response,
    caches: {
      open: jest.fn().mockResolvedValue({
        match: jest.fn().mockResolvedValue(undefined),
        put: jest.fn().mockResolvedValue(undefined),
      }),
      keys: jest.fn().mockResolvedValue(existingKeys),
      delete: deleteMock,
    },
    fetch: jest.fn(),
    self: {
      location: {
        origin: "https://photos.example.com",
        href: "https://photos.example.com/sw.js?v=test-build",
      },
      addEventListener: (name: string, handler: (event: InstallEvent) => void) => {
        handlers.set(name, handler);
      },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn() },
    },
  };

  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), context);
  return { handler: handlers.get("activate")!, deleteMock };
};

const runActivate = async (existingKeys: string[]) => {
  const { handler, deleteMock } = loadActivateHandler(existingKeys);
  let activatePromise: Promise<unknown> | undefined;
  handler({
    waitUntil: (promise) => {
      activatePromise = promise;
    },
  });
  await activatePromise;
  return (deleteMock.mock.calls as [string][]).map(([key]) => key).sort();
};

const loadFetchHandler = (options: {
  cachedResponse: Response;
  networkResponse?: Response;
  networkError?: Error;
  cachePut?: () => Promise<void>;
  cacheMatch?: (request: unknown) => Promise<Response | undefined>;
  cacheKeys?: () => Promise<unknown[]>;
  cacheDelete?: (key: unknown) => Promise<boolean>;
}): ((event: FetchEvent) => void) => {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const cache = {
    addAll: jest.fn(),
    match: jest.fn(options.cacheMatch ?? (() => Promise.resolve(options.cachedResponse))),
    put: jest.fn(options.cachePut ?? (() => Promise.resolve())),
    keys: jest.fn(options.cacheKeys ?? (() => Promise.resolve([]))),
    delete: jest.fn(options.cacheDelete ?? (() => Promise.resolve(true))),
  };
  const context = {
    URL,
    Response,
    caches: {
      open: jest.fn().mockResolvedValue(cache),
      keys: jest.fn().mockResolvedValue([]),
    },
    fetch: options.networkError
      ? jest.fn().mockRejectedValue(options.networkError)
      : jest.fn().mockResolvedValue(options.networkResponse),
    self: {
      location: {
        origin: "https://photos.example.com",
        href: "https://photos.example.com/sw.js?v=test-build",
      },
      addEventListener: (name: string, handler: (event: FetchEvent) => void) => {
        handlers.set(name, handler);
      },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn() },
    },
  };

  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), context);
  const fetchHandler = handlers.get("fetch")!;
  // Expose the context fetch mock so lifetime-scoped behaviour (conditional
  // revalidation, once-per-URL throttling) can be asserted without changing the
  // handler's call signature.
  (fetchHandler as unknown as { fetchMock: jest.Mock }).fetchMock = context.fetch as jest.Mock;
  return fetchHandler;
};

const fetchMockOf = (handler: (event: FetchEvent) => void): jest.Mock =>
  (handler as unknown as { fetchMock: jest.Mock }).fetchMock;

const request = (pathname: string, destination = "") => ({
  method: "GET",
  url: `https://photos.example.com${pathname}`,
  mode: "cors",
  destination,
});

describe("service worker data caching", () => {
  it("precaches the slideshow document and its generated runtime assets", async () => {
    const { handler, cacheByName, fetchMock } = loadInstallHandler();
    let installPromise: Promise<unknown> | undefined;

    handler({
      waitUntil: (promise) => {
        installPromise = promise;
      },
    });
    await installPromise;

    // Shell documents bypass the HTTP cache so a stale HTML referencing dead
    // hashed chunks cannot reject the install.
    expect(fetchMock).toHaveBeenCalledWith("/slideshow", { cache: "no-cache" });
    expect(fetchMock).toHaveBeenCalledWith("/slideshow/shell", { cache: "no-cache" });
    expect(fetchMock).toHaveBeenCalledWith("https://photos.example.com/assets/slideshow.js");
    expect(fetchMock).toHaveBeenCalledWith("https://photos.example.com/assets/slideshow.css");
    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).toHaveBeenCalledWith(
      "/slideshow",
      expect.any(Response),
    );
    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).toHaveBeenCalledWith(
      "/slideshow/shell",
      expect.any(Response),
    );
    // The diagnostics report is most needed on a kiosk that has just failed —
    // including one that failed because it is offline.
    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).toHaveBeenCalledWith(
      "/slideshow/diagnostics",
      expect.any(Response),
    );
    expect(cacheByName.get("snapshots-pwa-test-build-runtime")?.put).toHaveBeenCalledWith(
      "https://photos.example.com/assets/slideshow.js",
      expect.any(Response),
    );
    expect(fetchMock).toHaveBeenCalledWith("/search.sqlite");
    expect(fetchMock).toHaveBeenCalledWith("/search-embeddings.sqlite");
  });

  it("deletes superseded build generations on activation", async () => {
    // Without this the hashed chunks of every past deploy accumulate until the
    // origin hits its storage quota, at which point cache writes start failing
    // silently and the PWA simply stops restarting offline.
    const deleted = await runActivate([
      "snapshots-pwa-oldsha-shell",
      "snapshots-pwa-oldsha-runtime",
      "snapshots-pwa-test-build-shell",
      "snapshots-pwa-test-build-runtime",
    ]);

    expect(deleted).toEqual(["snapshots-pwa-oldsha-runtime", "snapshots-pwa-oldsha-shell"]);
  });

  it("keeps the current generation and foreign caches on activation", async () => {
    // Deleting the caches the worker just installed would leave it unable to
    // restart offline at all, and the origin's other caches are not ours.
    const deleted = await runActivate([
      "snapshots-pwa-test-build-shell",
      "snapshots-pwa-test-build-runtime",
      "some-other-app-cache",
    ]);

    expect(deleted).toEqual([]);
  });

  it("keeps cached album media across build generations", async () => {
    // Album media live at content URLs, not hashed build chunks, so a new
    // generation cannot orphan them. Scoping their cache to the build would make
    // every code deploy evict an installed photo frame's whole offline library.
    const deleted = await runActivate([
      "snapshots-pwa-images",
      "snapshots-pwa-oldsha-shell",
      "snapshots-pwa-test-build-shell",
    ]);

    expect(deleted).toEqual(["snapshots-pwa-oldsha-shell"]);
  });

  it("stores a document only once its generated assets are cached", async () => {
    // Publishing the HTML first would leave a cached document pointing at JS
    // that never arrived, so an offline restart renders a blank page.
    let releaseAsset: (() => void) | undefined;
    const assetGate = new Promise<void>((resolve) => {
      releaseAsset = resolve;
    });
    const { handler, cacheByName } = loadInstallHandler({
      respondTo: (input) =>
        input.endsWith(".js")
          ? assetGate.then(() => new Response("js", { status: 200 }))
          : undefined,
    });
    let installPromise: Promise<unknown> | undefined;

    handler({
      waitUntil: (promise) => {
        installPromise = promise;
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).not.toHaveBeenCalled();

    releaseAsset?.();
    await installPromise;

    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).toHaveBeenCalledWith(
      "/slideshow",
      expect.any(Response),
    );
  });

  it("installs when a build-generated icon is missing", async () => {
    // The icons are cosmetic and generated at build time. Rejecting install over
    // one missing PNG would silently leave the PWA with no offline support,
    // since registration failures are only logged.
    const { handler } = loadInstallHandler({
      respondTo: (input) =>
        input === "/pwa-icon-192.png"
          ? Promise.resolve(new Response("", { status: 404 }))
          : undefined,
    });
    let installPromise: Promise<unknown> | undefined;

    handler({
      waitUntil: (promise) => {
        installPromise = promise;
      },
    });

    await expect(installPromise).resolves.not.toThrow();
  });

  it("installs when the optional embeddings database is absent", async () => {
    const { handler } = loadInstallHandler({
      respondTo: (input) =>
        input === "/search-embeddings.sqlite"
          ? Promise.resolve(new Response("", { status: 404 }))
          : undefined,
    });
    let installPromise: Promise<unknown> | undefined;

    handler({
      waitUntil: (promise) => {
        installPromise = promise;
      },
    });

    await expect(installPromise).resolves.not.toThrow();
  });

  it("refuses to install without the app manifest", async () => {
    // The manifest is what makes the app installable, so unlike the icons it is
    // not best-effort: a PWA cached without it is not worth having.
    const { handler } = loadInstallHandler({
      respondTo: (input) =>
        input === "/manifest.webmanifest"
          ? Promise.resolve(new Response("", { status: 404 }))
          : undefined,
    });
    let installPromise: Promise<unknown> | undefined;

    handler({
      waitUntil: (promise) => {
        installPromise = promise;
      },
    });

    await expect(installPromise).rejects.toThrow(/manifest\.webmanifest/);
  });

  it("caches WebAssembly, which is fetched with an empty destination", async () => {
    // SQLite's wasm is requested by its own glue code, so it carries no request
    // destination and is named nowhere in the HTML for install to discover. Left
    // uncached it is the one artifact that breaks a cold offline start: the
    // shell and the database both restore, then SQLite cannot initialise.
    const wasm = new Response("wasm bytes", { status: 200 });
    const fetchHandler = loadFetchHandler({
      cachedResponse: undefined as unknown as Response,
      networkResponse: wasm,
    });
    let responded: Promise<Response> | undefined;

    fetchHandler({
      request: request("/_next/static/media/sqlite3.abc123.wasm"),
      respondWith: (promise) => {
        responded = promise;
      },
      waitUntil: () => {},
    });

    expect(responded).toBeDefined();
    await expect(responded).resolves.toBe(wasm);
  });

  it("serves the vendored map worker from the network, falling back to cache offline", async () => {
    // MapLibre's worker is the one script with a stable, unhashed URL, and the
    // main bundle it pairs with is hashed. Served stale-while-revalidate, a
    // cached copy — stale from an upgrade, or truncated by a bad moment on the
    // network — keeps being handed out, and the symptom is a map that reaches
    // "ready" and never "loaded": the worker fetches the tiles, so when it does
    // not come up the basemap stays blank. Fresh whenever the network answers.
    const network = new Response("current worker");
    const cached = new Response("older worker");
    const online = loadFetchHandler({ cachedResponse: cached, networkResponse: network });
    let fresh: Promise<Response> | undefined;
    online({
      request: request("/vendor/maplibre-gl-worker.mjs"),
      respondWith: (response) => {
        fresh = response;
      },
      waitUntil: () => {},
    });
    await expect(fresh).resolves.toBe(network);

    const offline = loadFetchHandler({
      cachedResponse: cached,
      networkError: new Error("offline"),
    });
    let fallback: Promise<Response> | undefined;
    offline({
      request: request("/vendor/maplibre-gl-shared.mjs"),
      respondWith: (response) => {
        fallback = response;
      },
      waitUntil: () => {},
    });
    await expect(fallback).resolves.toBe(cached);
  });

  it("falls back from a configured slideshow URL to the cached offline shell", async () => {
    const shell = new Response("cached slideshow shell");
    const fetchHandler = loadFetchHandler({
      cachedResponse: shell,
      networkError: new Error("offline"),
      cacheMatch: async (candidate) => (candidate === "/slideshow" ? shell : undefined),
    });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: {
        ...request("/slideshow?mode=similar&filter=favourites"),
        mode: "navigate",
      },
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    await expect(responsePromise).resolves.toBe(shell);
  });

  it("caches renderer-generated scripts by destination rather than URL convention", async () => {
    const cached = new Response("cached script");
    const network = new Response("current script");
    const fetchHandler = loadFetchHandler({ cachedResponse: cached, networkResponse: network });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: request("/assets/app-a1b2c3.js", "script"),
      waitUntil: () => {},
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    await expect(responsePromise).resolves.toBe(cached);
  });

  it("keeps stale asset revalidation alive until the replacement is stored", async () => {
    let finishCaching!: () => void;
    const caching = new Promise<void>((resolve) => {
      finishCaching = resolve;
    });
    const cached = new Response("cached script");
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkResponse: new Response("current script"),
      cachePut: () => caching,
    });
    let responsePromise: Promise<Response> | undefined;
    let lifetimePromise: Promise<unknown> | undefined;

    fetchHandler({
      request: request("/assets/app.js", "script"),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await expect(responsePromise).resolves.toBe(cached);
    expect(lifetimePromise).toBeDefined();
    let stored = false;
    void lifetimePromise?.then(() => {
      stored = true;
    });
    await Promise.resolve();
    expect(stored).toBe(false);
    finishCaching();
    await expect(lifetimePromise).resolves.toBeDefined();
  });

  it("settles a newly fetched image response without waiting for it to be cached", async () => {
    // A full cache.keys() scan under trimCache (up to 4000 entries) must not
    // delay first paint of a cold image. The response resolves as soon as the
    // network responds; storing it and trimming the cache happen afterwards,
    // kept alive separately via waitUntil.
    let finishCaching!: () => void;
    const caching = new Promise<void>((resolve) => {
      finishCaching = resolve;
    });
    const network = new Response("new image");
    const fetchHandler = loadFetchHandler({
      cachedResponse: new Response("unused"),
      networkResponse: network,
      cachePut: () => caching,
      cacheMatch: async () => undefined,
    });
    let responsePromise: Promise<Response> | undefined;
    let lifetimePromise: Promise<unknown> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/photo.avif", "image"),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    // The mocked cache.put hangs on `caching`, which is never resolved before
    // this assertion — the response must still settle.
    await expect(responsePromise).resolves.toBe(network);
    expect(lifetimePromise).toBeDefined();

    let stored = false;
    void lifetimePromise?.then(() => {
      stored = true;
    });
    await Promise.resolve();
    expect(stored).toBe(false);
    finishCaching();
    await expect(lifetimePromise).resolves.toBeUndefined();
  });

  it("revalidates the map search index while retaining an offline fallback", async () => {
    const cached = new Response("stale index");
    const network = new Response("current index");
    const fetchHandler = loadFetchHandler({ cachedResponse: cached, networkResponse: network });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: request("/data/map-search-index.json"),
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    await expect(responsePromise).resolves.toBe(network);
  });

  it("retains the slideshow database for offline restarts", async () => {
    const cached = new Response("cached sqlite database");
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkError: new Error("offline"),
    });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: request("/configured/slideshow-data.sqlite"),
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    await expect(responsePromise).resolves.toBe(cached);
  });

  it("serves cached media immediately while revalidating it in the background", async () => {
    // Album media are keyed by original filename, not a content hash, so a
    // re-edited photo reuses its URL. Cache-first would pin the first bytes
    // forever; stale-while-revalidate serves them at once yet refreshes them.
    const cached = new Response("cached image");
    const network = new Response("network image");
    const put = jest.fn().mockResolvedValue(undefined);
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkResponse: network,
      cachePut: put,
    });
    let responsePromise: Promise<Response> | undefined;
    let lifetimePromise: Promise<unknown> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/photo.avif"),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await expect(responsePromise).resolves.toBe(cached);
    expect(lifetimePromise).toBeDefined();
    await lifetimePromise;
    expect(put).toHaveBeenCalled();
  });

  it("revalidates cached media conditionally so long-lived caches cannot skip it", async () => {
    // A default-cache-mode fetch would be satisfied by the HTTP cache under a
    // long max-age header and never actually revalidate. `no-cache` forces a
    // conditional request (ETag/Last-Modified) instead.
    const fetchHandler = loadFetchHandler({
      cachedResponse: new Response("cached image"),
      networkResponse: new Response("network image"),
    });
    let responsePromise: Promise<Response> | undefined;
    let lifetimePromise: Promise<unknown> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/photo.avif", "image"),
      respondWith: (promise) => {
        responsePromise = promise;
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await responsePromise;
    await lifetimePromise;
    expect(fetchMockOf(fetchHandler)).toHaveBeenCalledWith(expect.anything(), {
      cache: "no-cache",
    });
  });

  it("revalidates a given media URL at most once per worker lifetime", async () => {
    // Without a per-lifetime cap a kiosk re-downloads full image bytes on every
    // hit. The second hit of the same URL must serve from cache without a
    // background refetch; put() is a proxy for a revalidation having happened.
    const put = jest.fn().mockResolvedValue(undefined);
    const fetchHandler = loadFetchHandler({
      cachedResponse: new Response("cached image"),
      networkResponse: new Response("network image"),
      cachePut: put,
    });
    const lifetimes: Promise<unknown>[] = [];
    const hit = async () => {
      let responsePromise: Promise<Response> | undefined;
      fetchHandler({
        request: request("/data/albums/trip/photo.avif", "image"),
        respondWith: (promise) => {
          responsePromise = promise;
        },
        waitUntil: (promise) => {
          lifetimes.push(promise);
        },
      });
      await responsePromise;
    };

    await hit();
    await hit();
    await Promise.all(lifetimes);

    // Only the first hit scheduled a revalidation; the second was throttled.
    expect(lifetimes).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(fetchMockOf(fetchHandler)).toHaveBeenCalledTimes(1);
  });

  it("retries a background image revalidation after a failed attempt", async () => {
    // A failed revalidation (network error) must not permanently mark the URL
    // as done for the worker's lifetime, or a kiosk that briefly drops offline
    // during a background refresh would never revalidate that image again.
    const cached = new Response("cached image");
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkError: new Error("offline"),
    });
    const lifetimes: Promise<unknown>[] = [];
    const hit = async () => {
      let responsePromise: Promise<Response> | undefined;
      fetchHandler({
        request: request("/data/albums/trip/photo.avif", "image"),
        respondWith: (promise) => {
          responsePromise = promise;
        },
        waitUntil: (promise) => {
          lifetimes.push(promise);
        },
      });
      await responsePromise;
    };

    await hit();
    await Promise.all(lifetimes);
    await hit();
    await Promise.all(lifetimes);

    // Both hits scheduled a background revalidation attempt because the first
    // one failed and must not have been left marked as done.
    expect(lifetimes).toHaveLength(2);
    expect(fetchMockOf(fetchHandler)).toHaveBeenCalledTimes(2);
  });

  it("marks a cold download as fresh so its first hit does not immediately revalidate", async () => {
    // The miss path just fetched the full bytes; treating the URL as still
    // needing revalidation would re-fetch it on the very next hit, roughly
    // doubling first-cycle bandwidth on a kiosk looping a cold album.
    const cached = new Response("cached image");
    let missed = false;
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkResponse: new Response("network image"),
      cacheMatch: () => {
        if (!missed) {
          missed = true;
          return Promise.resolve(undefined);
        }
        return Promise.resolve(cached);
      },
    });
    const lifetimes: Promise<unknown>[] = [];
    const hit = async () => {
      let responsePromise: Promise<Response> | undefined;
      fetchHandler({
        request: request("/data/albums/trip/photo.avif", "image"),
        respondWith: (promise) => {
          responsePromise = promise;
        },
        waitUntil: (promise) => {
          lifetimes.push(promise);
        },
      });
      await responsePromise;
    };

    await hit();
    await Promise.all(lifetimes);
    await hit();
    await Promise.all(lifetimes);

    // One network fetch total: the cold download. The following cache hit must
    // not schedule a background revalidation of bytes fetched moments earlier.
    expect(fetchMockOf(fetchHandler)).toHaveBeenCalledTimes(1);
  });

  it("keeps a URL marked done after a revalidation that answered non-ok", async () => {
    // A server-side deletion (404 while the stale copy stays cached) must not
    // turn into an unbounded refetch-per-hit loop for the worker's lifetime;
    // only thrown network errors (offline) unmark the URL for retry.
    const cached = new Response("cached image");
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkResponse: new Response(null, { status: 404 }),
    });
    const lifetimes: Promise<unknown>[] = [];
    const hit = async () => {
      let responsePromise: Promise<Response> | undefined;
      fetchHandler({
        request: request("/data/albums/trip/photo.avif", "image"),
        respondWith: (promise) => {
          responsePromise = promise;
        },
        waitUntil: (promise) => {
          lifetimes.push(promise);
        },
      });
      await responsePromise;
    };

    await hit();
    await Promise.all(lifetimes);
    await hit();
    await Promise.all(lifetimes);

    expect(lifetimes).toHaveLength(1);
    expect(fetchMockOf(fetchHandler)).toHaveBeenCalledTimes(1);
  });

  it("ignores a failed image revalidation so the cached copy still serves offline", async () => {
    const cached = new Response("cached image");
    const fetchHandler = loadFetchHandler({
      cachedResponse: cached,
      networkError: new Error("offline"),
    });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/photo.avif", "image"),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: () => {},
    });

    await expect(responsePromise).resolves.toBe(cached);
  });

  it("evicts the oldest image entries once the cache exceeds its cap", async () => {
    // Without a bound the unversioned media cache grows forever. keys() is in
    // insertion order, so the two entries past the 4000 cap here are the oldest.
    const network = new Response("fresh image");
    const keys = Array.from(
      { length: 4002 },
      (_, index) => `https://photos.example.com/data/albums/trip/photo-${index}.avif`,
    );
    const del = jest.fn().mockResolvedValue(true);
    const fetchHandler = loadFetchHandler({
      cachedResponse: undefined as unknown as Response,
      networkResponse: network,
      cacheMatch: async () => undefined,
      cacheKeys: async () => keys,
      cacheDelete: del,
    });
    let responsePromise: Promise<Response> | undefined;
    let lifetimePromise: Promise<unknown> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/new.avif", "image"),
      respondWith: (response) => {
        responsePromise = response;
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await expect(responsePromise).resolves.toBe(network);
    // Trimming happens in the background store, not before the response settles.
    await lifetimePromise;
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith(keys[0]);
    expect(del).toHaveBeenCalledWith(keys[1]);
  });

  it("uses the latest cached index when the network fails or returns an error", async () => {
    const cached = new Response("last good index");
    const rejectedHandler = loadFetchHandler({
      cachedResponse: cached,
      networkError: new Error("offline"),
    });
    let rejectedResponse: Promise<Response> | undefined;
    rejectedHandler({
      request: request("/data/map-search-index.json"),
      respondWith: (response) => {
        rejectedResponse = response;
      },
    });

    await expect(rejectedResponse).resolves.toBe(cached);

    const unavailableHandler = loadFetchHandler({
      cachedResponse: cached,
      networkResponse: new Response("unavailable", { status: 503 }),
    });
    let unavailableResponse: Promise<Response> | undefined;
    unavailableHandler({
      request: request("/data/map-search-index.json"),
      respondWith: (response) => {
        unavailableResponse = response;
      },
    });

    await expect(unavailableResponse).resolves.toBe(cached);
  });

  it("keeps the network-first request alive until its offline copy is stored", async () => {
    let finishCaching!: () => void;
    const caching = new Promise<void>((resolve) => {
      finishCaching = resolve;
    });
    const network = new Response("current index");
    const fetchHandler = loadFetchHandler({
      cachedResponse: new Response("stale index"),
      networkResponse: network,
      cachePut: () => caching,
    });
    let responsePromise: Promise<Response> | undefined;
    fetchHandler({
      request: request("/data/map-search-index.json"),
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    let settled = false;
    void responsePromise?.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCaching();
    await expect(responsePromise).resolves.toBe(network);
  });
});
