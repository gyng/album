import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_SIMPLE = path.resolve(here, "../../../albums/test-simple");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const postLens = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/write-lens", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("read endpoints", () => {
  it("health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("tz resolves a coordinate to its IANA zone", async () => {
    const res = await app.request("/api/tz?lat=35.68&lng=139.76");
    expect((await res.json()).zone).toBe("Asia/Tokyo");
  });

  it("folder lists a directory's photos", async () => {
    const res = await app.request(`/api/folder?path=${encodeURIComponent(TEST_SIMPLE)}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.photos.length).toBeGreaterThan(0);
  });

  it("folder 400s on a bad path", async () => {
    const res = await app.request(`/api/folder?path=${encodeURIComponent("/no/such/xyz")}`);
    expect(res.status).toBe(400);
  });
});

describe("write guards", () => {
  const item = { filename: "x.jpg", path: "/tmp/opened/x.jpg", lat: 1, lng: 1 };

  it("refuses without the x-geotag-tool header (403)", async () => {
    const res = await post({ root: "/tmp/opened", items: [item] });
    expect(res.status).toBe(403);
  });

  it("refuses a path outside the open folder (400)", async () => {
    const res = await post(
      { root: "/tmp/opened", items: [{ ...item, path: "/etc/hostname" }] },
      { "x-geotag-tool": "1" },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/outside/);
  });

  it("requires root + items (400)", async () => {
    const res = await post({ items: [] }, { "x-geotag-tool": "1" });
    expect(res.status).toBe(400);
  });

  it("applies the same header and open-folder guards to lens writes", async () => {
    const lensItem = {
      filename: "x.jpg",
      path: "/tmp/opened/x.jpg",
      lens: {
        make: "Voigtländer",
        model: "NOKTON 35mm F1.2",
        focalLength: 35,
        focalLength35mm: 53,
      },
    };
    expect((await postLens({ root: "/tmp/opened", items: [lensItem] })).status).toBe(403);
    expect(
      (
        await postLens(
          { root: "/tmp/opened", items: [{ ...lensItem, path: "/etc/hostname" }] },
          { "x-geotag-tool": "1" },
        )
      ).status,
    ).toBe(400);
  });

  it("rejects incomplete lens metadata", async () => {
    const res = await postLens(
      {
        root: "/tmp/opened",
        items: [{ filename: "x.jpg", path: "/tmp/opened/x.jpg", lens: { model: "" } }],
      },
      { "x-geotag-tool": "1" },
    );
    expect(res.status).toBe(400);
  });
});
