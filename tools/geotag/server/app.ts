import { Hono } from "hono";
import path from "node:path";
import sharp from "sharp";
import tzLookup from "tz-lookup";
import { DEFAULT_ROOT, isImageFile, listFolder } from "./folders.ts";
import { writeGps } from "./geotagWrite.ts";
import { writeLens } from "./lensWrite.ts";
import type { LensMetadata } from "../src/lens.ts";
import type { WriteAssignment } from "../../../src/util/gpsWriteModel";

export const app = new Hono();

// No wildcard CORS: the browser talks to Vite (same origin) which proxies here,
// so cross-origin access is neither needed nor wanted now that any folder is
// reachable. Mutating requests additionally require a custom header a random
// web page can't send cross-origin without a (here-failing) preflight.
const requireToolHeader = (header: string | undefined): boolean => header === "1";

app.get("/api/health", (c) => c.json({ ok: true, defaultRoot: DEFAULT_ROOT }));

// IANA timezone for a coordinate — the one thing the interpolation offset ladder
// needs from the server (everything else runs in the browser via shared modules).
app.get("/api/tz", (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: "lat/lng required" }, 400);
  try {
    return c.json({ zone: tzLookup(lat, lng) });
  } catch {
    return c.json({ zone: null });
  }
});

// Browse + load any directory: its sub-folders (to navigate) and its photos.
app.get("/api/folder", async (c) => {
  const requested = c.req.query("path") || undefined;
  try {
    return c.json(await listFolder(requested));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "cannot open folder" }, 400);
  }
});

// Downscaled, auto-oriented thumbnail by absolute file path.
app.get("/api/thumb", async (c) => {
  const file = c.req.query("path") ?? "";
  const resolved = path.resolve(file);
  if (!isImageFile(resolved)) return c.json({ error: "not an image file" }, 400);

  const width = Math.min(Math.max(Number(c.req.query("w") ?? 240), 32), 1600);
  try {
    const buf = await sharp(resolved).rotate().resize(width).jpeg({ quality: 72 }).toBuffer();
    return c.body(buf, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" });
  } catch {
    return c.json({ error: "thumbnail failed" }, 500);
  }
});

type WriteRequestItem = {
  filename: string;
  path: string;
  lat: number;
  lng: number;
  interpolated?: boolean;
};

app.post("/api/write", async (c) => {
  if (!requireToolHeader(c.req.header("x-geotag-tool"))) {
    return c.json({ error: "missing x-geotag-tool header" }, 403);
  }
  const body = (await c.req.json().catch(() => null)) as {
    root?: string;
    items?: WriteRequestItem[];
  } | null;
  const root = body?.root;
  const items = body?.items;
  if (typeof root !== "string" || !Array.isArray(items) || items.length === 0) {
    return c.json({ error: "root + items[] required" }, 400);
  }

  // Anti-footgun: every write must land inside the folder currently open in the
  // UI, so a stray `..` or mismatched request can't touch files elsewhere.
  const rootPrefix = path.resolve(root) + path.sep;
  if (!items.every((it) => typeof it.path === "string" && path.resolve(it.path).startsWith(rootPrefix))) {
    return c.json({ error: "refusing to write outside the open folder" }, 400);
  }

  const assignments: WriteAssignment[] = items.map((it) => ({
    filename: it.filename,
    path: it.path,
    before: null,
    after: { lat: it.lat, lng: it.lng, interpolated: it.interpolated },
  }));

  return c.json({ results: await writeGps(assignments) });
});

type LensWriteRequestItem = {
  filename: string;
  path: string;
  lens: LensMetadata;
};

const validOptionalNumber = (value: unknown): boolean =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value > 0);

app.post("/api/write-lens", async (c) => {
  if (!requireToolHeader(c.req.header("x-geotag-tool"))) {
    return c.json({ error: "missing x-geotag-tool header" }, 403);
  }
  const body = (await c.req.json().catch(() => null)) as {
    root?: string;
    items?: LensWriteRequestItem[];
  } | null;
  const root = body?.root;
  const items = body?.items;
  if (typeof root !== "string" || !Array.isArray(items) || items.length === 0) {
    return c.json({ error: "root + items[] required" }, 400);
  }

  const rootPrefix = path.resolve(root) + path.sep;
  const valid = items.every(
    (item) =>
      typeof item.filename === "string" &&
      typeof item.path === "string" &&
      path.resolve(item.path).startsWith(rootPrefix) &&
      typeof item.lens?.model === "string" &&
      item.lens.model.trim().length > 0 &&
      typeof item.lens.make === "string" &&
      validOptionalNumber(item.lens.focalLength) &&
      validOptionalNumber(item.lens.focalLength35mm),
  );
  if (!valid) return c.json({ error: "invalid lens assignment or path outside open folder" }, 400);

  return c.json({ results: await writeLens(items) });
});
