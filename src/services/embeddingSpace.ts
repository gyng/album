import fs from "node:fs";
import path from "node:path";
import { loadEmbeddingSpacePoints, type EmbeddingSpacePoint } from "../util/computeEmbeddingStats";
import { getAlbums } from "./album";

export type EmbeddingSpaceAtlas = {
  /** One cell's side, in pixels. */
  cell: number;
  /** One sheet's side, in pixels. */
  sheet: number;
  /** How many photographs fit on a sheet. */
  perSheet: number;
  /** The sheets themselves, in slot order. */
  files: string[];
};

export type EmbeddingSpacePayload = {
  points: EmbeddingSpacePoint[];
  atlas: EmbeddingSpaceAtlas | null;
};

const ATLAS_MANIFEST = path.join(process.cwd(), "public", "data", "embedding-atlas.json");

/**
 * The contact sheet built by `prepare:embedding-atlas`, if that prepass ran.
 *
 * Optional by design: without it the cloud falls back to dominant colours and a
 * handful of full-size thumbnails, which is what it did before the sheet
 * existed. A build with no optimised images — the E2E fixtures, a fresh fork —
 * simply has no sheet.
 */
const readAtlas = (): { atlas: EmbeddingSpaceAtlas; slots: Record<string, number> } | null => {
  if (!fs.existsSync(ATLAS_MANIFEST)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(ATLAS_MANIFEST, "utf8")) as {
      cell: number;
      sheet: number;
      perSheet: number;
      files: string[];
      slots: Record<string, number>;
    };
    return {
      atlas: {
        cell: manifest.cell,
        sheet: manifest.sheet,
        perSheet: manifest.perSheet,
        files: manifest.files,
      },
      slots: manifest.slots ?? {},
    };
  } catch (error) {
    console.error("Failed to read the embedding atlas manifest", error);
    return null;
  }
};

/**
 * The portable payload behind the explore page's embedding cloud.
 *
 * A stable URL rather than page props: the cloud is a few hundred kilobytes of
 * coordinates that only matter once a reader scrolls to it, and every other
 * explore section would otherwise carry it in their HTML.
 */
export const loadEmbeddingSpace = async (): Promise<EmbeddingSpacePayload> => {
  const sheet = readAtlas();
  const points = await loadEmbeddingSpacePoints(await getAlbums(), undefined, sheet?.slots ?? {});

  return { points, atlas: sheet?.atlas ?? null };
};
