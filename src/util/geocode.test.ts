import { getGeocodeLabel, getGeocodeCountry, getGeocodeCity } from "./geocode";

// Geocode format: lat\nlon\nname\nadmin1\nadmin2\ncc\ncountry
// Produced by format_mapping_values() in index.py

const TOKYO =
  "35.6895\n139.6917\nShinjuku-ku\nTokyo\nTokyo\nJP\nJapan";
const OSAKA =
  "34.6937\n135.5023\nNamba\nOsaka Prefecture\nOsaka\nJP\nJapan";
const SINGAPORE =
  "1.3521\n103.8198\nSingapore\nCentral Singapore\nSingapore\nSG\nSingapore";
const PARIS =
  "48.8566\n2.3522\nParis\nIle-de-France\nParis\nFR\nFrance";
const MINIMAL = "35.0\n135.0\nKyoto\nKyoto Prefecture\nKyoto\nJP\nJapan";

describe("getGeocodeLabel", () => {
  it("returns null for null/undefined/empty", () => {
    expect(getGeocodeLabel(null)).toBeNull();
    expect(getGeocodeLabel(undefined)).toBeNull();
    expect(getGeocodeLabel("")).toBeNull();
  });

  it("returns null for coordinate-only strings", () => {
    expect(getGeocodeLabel("35.6895\n139.6917")).toBeNull();
  });

  it("strips coordinates and country codes", () => {
    expect(getGeocodeLabel(TOKYO)).toBe("Shinjuku-ku, Tokyo, Japan");
  });

  it("deduplicates repeated region names", () => {
    // Singapore has city = country = "Singapore"
    expect(getGeocodeLabel(SINGAPORE)).toBe(
      "Singapore, Central Singapore",
    );
  });

  it("handles Paris correctly", () => {
    expect(getGeocodeLabel(PARIS)).toBe("Paris, Ile-de-France, France");
  });

  it("handles Osaka with prefecture suffix", () => {
    expect(getGeocodeLabel(OSAKA)).toBe(
      "Namba, Osaka Prefecture, Osaka, Japan",
    );
  });
});

describe("getGeocodeCountry", () => {
  it("returns the last non-code line as country", () => {
    expect(getGeocodeCountry(TOKYO)).toBe("Japan");
    expect(getGeocodeCountry(PARIS)).toBe("France");
  });

  it("returns null for empty", () => {
    expect(getGeocodeCountry(null)).toBeNull();
    expect(getGeocodeCountry("35.0\n139.0")).toBeNull();
  });
});

describe("getGeocodeCity", () => {
  it("returns the first non-coord, non-code line", () => {
    expect(getGeocodeCity(TOKYO)).toBe("Shinjuku-ku");
    expect(getGeocodeCity(OSAKA)).toBe("Namba");
    expect(getGeocodeCity(MINIMAL)).toBe("Kyoto");
  });

  it("returns null for empty", () => {
    expect(getGeocodeCity(null)).toBeNull();
  });
});
