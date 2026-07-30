/**
 * @jest-environment jsdom
 */

import { siteConfig } from "../lib/siteConfig";
import {
  DEFAULT_MAP_STYLE,
  FALLBACK_STYLE_URL,
  getMapStyleName,
  MAP_STYLE_NAMES,
  MAP_STYLE_STORAGE_KEY,
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

it("builds every choice's URL against the same provider and key", () => {
  const urls = MAP_STYLE_NAMES.map((name) => mapStyleUrl(name));
  urls.forEach((url) => {
    expect(url).toMatch(/^https:\/\/api\.maptiler\.com\/maps\/[\w-]+\/style\.json\?key=\w+$/);
  });
  // Distinct styles, or the picker would be offering the same map twice.
  expect(new Set(urls).size).toBe(MAP_STYLE_NAMES.length);
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
    expect(mapStyleUrl("streets", "")).toBe(FALLBACK_STYLE_URL);
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
