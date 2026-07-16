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

const loadInstallHandler = () => {
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
    if (input === "/" || input === "/slideshow") {
      const route = input === "/" ? "home" : "slideshow";
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

const loadFetchHandler = (options: {
  cachedResponse: Response;
  networkResponse?: Response;
  networkError?: Error;
  cachePut?: () => Promise<void>;
  cacheMatch?: (request: unknown) => Promise<Response | undefined>;
}): ((event: FetchEvent) => void) => {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const cache = {
    addAll: jest.fn(),
    match: jest.fn(options.cacheMatch ?? (() => Promise.resolve(options.cachedResponse))),
    put: jest.fn(options.cachePut ?? (() => Promise.resolve())),
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
  return handlers.get("fetch")!;
};

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

    expect(fetchMock).toHaveBeenCalledWith("/slideshow");
    expect(fetchMock).toHaveBeenCalledWith("https://photos.example.com/assets/slideshow.js");
    expect(fetchMock).toHaveBeenCalledWith("https://photos.example.com/assets/slideshow.css");
    expect(cacheByName.get("snapshots-pwa-test-build-shell")?.put).toHaveBeenCalledWith(
      "/slideshow",
      expect.any(Response),
    );
    expect(cacheByName.get("snapshots-pwa-test-build-runtime")?.put).toHaveBeenCalledWith(
      "https://photos.example.com/assets/slideshow.js",
      expect.any(Response),
    );
    expect(fetchMock).toHaveBeenCalledWith("/search.sqlite");
    expect(fetchMock).toHaveBeenCalledWith("/search-embeddings.sqlite");
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

  it("finishes storing a newly fetched image before settling the response", async () => {
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

    fetchHandler({
      request: request("/data/albums/trip/photo.avif", "image"),
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

  it("keeps immutable media on the cache-first path", async () => {
    const cached = new Response("cached image");
    const network = new Response("network image");
    const fetchHandler = loadFetchHandler({ cachedResponse: cached, networkResponse: network });
    let responsePromise: Promise<Response> | undefined;

    fetchHandler({
      request: request("/data/albums/trip/photo.avif"),
      respondWith: (response) => {
        responsePromise = response;
      },
    });

    await expect(responsePromise).resolves.toBe(cached);
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
