/**
 * @jest-environment jsdom
 */

import { siteConfig } from "../lib/siteConfig";
import {
  DEFAULT_MAP_STYLE,
  FALLBACK_STYLE_URL,
  MAP_STYLE_NAMES,
  MAP_STYLE_STORAGE_KEY,
  defaultMapStyleForTheme,
  getMapStyleName,
  isFreeMapStyle,
  mapStyleUrl,
  mapTilerStyleUrl,
  resetMapStyleCache,
  resolveMapStyleName,
  setMapStyleName,
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
      /^(https:\/\/api\.maptiler\.com\/maps\/[\w-]+\/style\.json\?key=\w+|https:\/\/tiles\.openfreemap\.org\/styles\/[\w-]+|\/map-styles\/[\w-]+\.json)$/,
    );
  });
  expect(new Set(urls).size).toBe(MAP_STYLE_NAMES.length);
});

// The point of the split: a rate limit on the metered provider cannot take the
// whole picker down with it.
it("keeps most of the picker on the free provider", () => {
  const free = MAP_STYLE_NAMES.filter(isFreeMapStyle);

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

  setMapStyleName("watercolour");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getMapStyleName()).toBe("watercolour");
  expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe("watercolour");

  unsubscribe();
  setMapStyleName("dark");
  expect(listener).toHaveBeenCalledTimes(1);
});

it("picks up a choice made in another tab", () => {
  const listener = jest.fn();
  subscribeMapStyleName(listener);
  expect(getMapStyleName()).toBe(DEFAULT_MAP_STYLE);

  window.localStorage.setItem(MAP_STYLE_STORAGE_KEY, "topographic");
  window.dispatchEvent(new StorageEvent("storage", { key: MAP_STYLE_STORAGE_KEY }));

  expect(getMapStyleName()).toBe("topographic");
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
    expect(() => setMapStyleName("streets")).not.toThrow();
    // The choice still applies for this session, it just cannot be remembered.
    expect(getMapStyleName()).toBe("streets");
  } finally {
    Object.defineProperty(window, "localStorage", { configurable: true, value: real });
  }
});

describe("provider configuration", () => {
  it("degrades to a keyless basemap when no provider key is configured", () => {
    expect(mapTilerStyleUrl("streets-v2", "")).toBe(FALLBACK_STYLE_URL);
    // Satellite is the metered provider's; with no key it has nothing to load.
    expect(mapStyleUrl("satellite", "")).toBe(FALLBACK_STYLE_URL);
  });

  // The free styles are the point of the split: they need no key, so they are
  // unaffected by whether one is configured and cannot be rate-limited away.
  it("serves the free styles from OpenFreeMap whether or not a key exists", () => {
    expect(mapStyleUrl("dark", "")).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(mapStyleUrl("dark", "a-key")).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(mapStyleUrl("3d", "a-key")).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("builds a catalogue style id that is not one of the curated choices", () => {
    expect(mapTilerStyleUrl("ocean", "abc123")).toBe(
      "https://api.maptiler.com/maps/ocean/style.json?key=abc123",
    );
  });

  // The gallery style is scoped to the account that made it, so a fork must
  // never be offered a choice that would 403 against its own key.
  it("offers the gallery style only when one is configured", () => {
    const offersGallery = MAP_STYLE_NAMES.includes("gallery");
    expect(offersGallery).toBe(siteConfig.map.galleryStyleId !== null);
  });

  it("defaults to a style it actually offers", () => {
    expect(MAP_STYLE_NAMES).toContain(DEFAULT_MAP_STYLE);
  });

  it("rejects a stored preference naming a style this fork does not offer", () => {
    for (const name of ["gallery", "default"]) {
      const resolved = resolveMapStyleName(name);
      if (siteConfig.map.galleryStyleId === null) {
        expect(resolved).toBeNull();
      } else {
        expect(resolved).toBe("gallery");
      }
    }
  });
});

describe("the basemap that follows the page", () => {
  // The map has as many documents as the site has themes, and picks the one
  // the page is wearing.
  it("resolves to the style composed for the active theme", () => {
    expect(mapStyleUrl("theme", "", "slate")).toBe("/map-styles/theme-slate.json");
    expect(mapStyleUrl("theme", "", "ember")).toBe("/map-styles/theme-ember.json");
  });

  it("costs nothing, like the rest of the composed styles", () => {
    for (const name of ["theme", "minimal", "sketch"] as const) {
      expect(isFreeMapStyle(name)).toBe(true);
      expect(mapStyleUrl(name, "a-key")).not.toContain("maptiler");
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

  // Light and dark are the schemes people read in, and a legible default
  // matters more there than a matching one.
  it("leaves the reading schemes on the configured default", () => {
    expect(defaultMapStyleForTheme("light")).toBe(DEFAULT_MAP_STYLE);
    expect(defaultMapStyleForTheme("dark")).toBe(DEFAULT_MAP_STYLE);
    expect(defaultMapStyleForTheme(null)).toBe(DEFAULT_MAP_STYLE);
  });
});
