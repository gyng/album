import { describe, it, expect } from "vitest";
import { formatOffsetMinutes, parseLatLng } from "./api.ts";

describe("parseLatLng", () => {
  it("parses comma- and space-separated pairs", () => {
    expect(parseLatLng("35.6, 139.7")).toEqual({ lat: 35.6, lng: 139.7 });
    expect(parseLatLng("-33.8688 151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseLatLng("")).toBeNull();
    expect(parseLatLng("nope")).toBeNull();
    expect(parseLatLng("100, 0")).toBeNull();
    expect(parseLatLng("0, 999")).toBeNull();
  });
});

describe("formatOffsetMinutes", () => {
  it("formats signed HH:MM", () => {
    expect(formatOffsetMinutes(540)).toBe("+09:00");
    expect(formatOffsetMinutes(-330)).toBe("-05:30");
    expect(formatOffsetMinutes(0)).toBe("+00:00");
  });
});
