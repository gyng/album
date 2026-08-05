/**
 * @jest-environment jsdom
 */

import {
  AUTO_MAP_STYLE,
  DEFAULT_MAP_STYLE,
  MAP_STYLE_GROUPS,
  MAP_STYLE_NAMES,
  MAP_STYLE_STORAGE_KEY,
  defaultMapStyleForTheme,
  getMapStyleName,
  mapStyleForChoice,
  mapStyleUrl,
  resetMapStyleCache,
  resolveMapStyleChoice,
  resolveMapStyleName,
  getStoredMapStyleChoice,
  setMapStyleChoice,
  subscribeMapStyleName,
} from "./mapStyles";

beforeEach(() => {
  window.localStorage.clear();
  resetMapStyleCache();
});

// Three sources now: OpenFreeMap's catalogue, a style this site serves itself,
// and the metered provider for what neither offers. Every URL must belong to
// one of them, and no two choices may resolve to the same basemap or the picker
// offers the same map twice.
it("builds every choice's URL against one of its three sources", () => {
  const urls = MAP_STYLE_NAMES.map((name) => mapStyleUrl(name));

  urls.forEach((url) => {
    expect(url).toMatch(
      /^(https:\/\/tiles\.openfreemap\.org\/styles\/[\w-]+|\/map-styles\/[\w-]+\.json)$/,
    );
  });
  expect(new Set(urls).size).toBe(MAP_STYLE_NAMES.length);
});

// The point of the split: a rate limit on the metered provider cannot take the
// whole picker down with it.
it("keeps most of the picker on the free provider", () => {
  const free = MAP_STYLE_NAMES;

  expect(free.length).toBeGreaterThanOrEqual(4);
  expect(free).toContain("3d");
});

it("falls back to the default for anything it does not recognise", () => {
  expect(resolveMapStyleName("streets")).toBe("streets");
  // The preference's first name for the gallery's own style, kept working.
  expect(resolveMapStyleName("default")).toBe("gallery");
  expect(resolveMapStyleName("no-such-style")).toBeNull();
  expect(resolveMapStyleName(undefined)).toBeNull();
  window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "no-such-style");
  expect(getMapStyleName()).toBe(DEFAULT_MAP_STYLE);
});

it("remembers the choice and tells the map about it", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeMapStyleName(listener);

  setMapStyleChoice("watercolour");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getMapStyleName()).toBe("watercolour");
  expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe("watercolour");

  unsubscribe();
  setMapStyleChoice("dark");
  expect(listener).toHaveBeenCalledTimes(1);
});

it("picks up a choice made in another tab", () => {
  const listener = jest.fn();
  subscribeMapStyleName(listener);
  expect(getMapStyleName()).toBe(DEFAULT_MAP_STYLE);

  window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "halftone");
  window.dispatchEvent(new StorageEvent("storage", { key: MAP_STYLE_STORAGE_KEY }));

  expect(getMapStyleName()).toBe("halftone");
  expect(listener).toHaveBeenCalled();
});

it("keeps working when storage is unavailable", () => {
  // Private browsing and blocked storage both throw from the accessor itself,
  // which is a state the map has to survive rather than crash in.
  const real = window.localStorage;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("denied");
    },
  });

  try {
    expect(getMapStyleName()).toBe(DEFAULT_MAP_STYLE);
    expect(() => setMapStyleChoice("streets")).not.toThrow();
    // The choice still applies for this session, it just cannot be remembered.
    expect(getMapStyleName()).toBe("streets");
  } finally {
    Object.defineProperty(window, "localStorage", { configurable: true, value: real });
  }
});

describe("what the basemaps cost", () => {
  // There is no metered provider here any more: every style is either
  // OpenFreeMap's or a document this site serves itself, so no basemap can go
  // dark because a quota ran out or a key was restricted to another domain.
  it("serves every style from the free provider or from here", () => {
    for (const name of MAP_STYLE_NAMES) {
      const url = mapStyleUrl(name);
      expect(url.startsWith("https://tiles.openfreemap.org/") || url.startsWith("/")).toBe(true);
      expect(url).not.toContain("maptiler");
    }
  });

  it("defaults to a style it actually offers", () => {
    expect(MAP_STYLE_NAMES).toContain(DEFAULT_MAP_STYLE);
  });
});

describe("the basemap that follows the page", () => {
  // The map has as many documents as the site has themes, and picks the one
  // the page is wearing.
  it("resolves to the style composed for the active theme", () => {
    expect(mapStyleUrl("theme", "slate")).toBe("/map-styles/theme-slate.json");
    expect(mapStyleUrl("theme", "ember")).toBe("/map-styles/theme-ember.json");
  });

  it("costs nothing, like the rest of the composed styles", () => {
    for (const name of ["theme", "minimal", "sketch"] as const) {
      expect(mapStyleUrl(name)).not.toContain("maptiler");
      expect(mapStyleUrl(name)).not.toContain("maptiler");
    }
  });
});

describe("defaultMapStyleForTheme", () => {
  // A theme with an obvious map of its own supplies it — but only as a default:
  // a reader's own choice is read from storage and outranks this entirely.
  it("gives a theme its own map where there is one", () => {
    expect(defaultMapStyleForTheme("terminal")).toBe("crt");
    expect(defaultMapStyleForTheme("paper")).toBe("paper");
    expect(defaultMapStyleForTheme("ink")).toBe("sketch");
  });

  it("sends the painterly themes to maps made here", () => {
    expect(defaultMapStyleForTheme("watercolour")).toBe("watercolour");
    expect(defaultMapStyleForTheme("herbarium")).toBe("herbarium");
    expect(defaultMapStyleForTheme("slate")).toBe("blueprint");
  });

  // A decorative theme with no map of its own opens on the basemap that wears
  // its palette.
  it("sends the rest of the decorative themes to the map wearing them", () => {
    for (const theme of ["ember", "arcana", "desktop"] as const) {
      expect(defaultMapStyleForTheme(theme)).toBe("theme");
    }
  });

  // Light and dark are the schemes people read in, and a legible default
  // matters more there than a matching one.
  it("leaves the reading schemes on the configured default", () => {
    expect(defaultMapStyleForTheme("light")).toBe(DEFAULT_MAP_STYLE);
    expect(defaultMapStyleForTheme("dark")).toBe(DEFAULT_MAP_STYLE);
    expect(defaultMapStyleForTheme(null)).toBe(DEFAULT_MAP_STYLE);
  });
});

// Following the theme used to be the absence of a choice, which a reader could
// leave but never return to. It is a choice of its own now.
describe("matching the theme as a choice", () => {
  it("starts there, and says so rather than naming a basemap", () => {
    expect(getStoredMapStyleChoice()).toBeNull();
    expect(resolveMapStyleChoice(AUTO_MAP_STYLE)).toBe(AUTO_MAP_STYLE);
    expect(resolveMapStyleChoice("no-such-style")).toBeNull();
  });

  it("can be chosen back after a basemap was pinned", () => {
    setMapStyleChoice("neon");
    expect(getStoredMapStyleChoice()).toBe("neon");

    setMapStyleChoice(AUTO_MAP_STYLE);
    expect(getStoredMapStyleChoice()).toBe(AUTO_MAP_STYLE);
    expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe(AUTO_MAP_STYLE);
  });

  it("loads the theme's own map, and a pinned one whatever the theme", () => {
    expect(mapStyleForChoice(AUTO_MAP_STYLE, "terminal")).toBe("crt");
    expect(mapStyleForChoice(AUTO_MAP_STYLE, "light")).toBe(DEFAULT_MAP_STYLE);
    expect(mapStyleForChoice("halftone", "terminal")).toBe("halftone");
  });

  // A caller with no theme in hand — the server, or a non-React one — cannot
  // resolve it, so it gets the configured default rather than a guess.
  it("resolves to the configured default where there is no theme to read", () => {
    setMapStyleChoice(AUTO_MAP_STYLE);
    expect(getMapStyleName()).toBe(DEFAULT_MAP_STYLE);
  });

  // Another tab clearing the preference puts this one back on the theme's map,
  // not on the configured default.
  it("goes back to following the theme when another tab clears the choice", () => {
    setMapStyleChoice("neon");
    const unsubscribe = subscribeMapStyleName(() => {});

    window.localStorage.removeItem(MAP_STYLE_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: MAP_STYLE_STORAGE_KEY }));

    expect(getStoredMapStyleChoice()).toBeNull();
    unsubscribe();
  });
});

// A style built for one embedded map is not a choice. The slideshow's inset is
// white linework on pure black — over a photograph it is the picture's own map,
// and on a page without one it is a black rectangle.
describe("styles that are not choices", () => {
  it("keeps an internal style out of the picker and out of the preference", () => {
    expect(MAP_STYLE_NAMES).not.toContain("trace");
    expect(resolveMapStyleName("trace")).toBeNull();
    expect(MAP_STYLE_GROUPS.flatMap((group) => group.names)).not.toContain("trace");
  });

  it("still resolves its document, because an embedded map asks for it by name", () => {
    expect(mapStyleUrl("trace")).toBe("/map-styles/trace.json");
  });
});
