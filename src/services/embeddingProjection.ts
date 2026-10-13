import fs from "node:fs";
import crypto from "node:crypto";
import type { SpacePoint } from "../util/embeddingSpace";

export const loadSemanticProjection = (
  databasePath: string,
  cachePath: string,
  modelId: string,
): Map<string, SpacePoint> => {
  const empty = new Map<string, SpacePoint>();
  try {
    if (!fs.existsSync(cachePath)) return empty;
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const digest = crypto.createHash("sha256").update(fs.readFileSync(databasePath)).digest("hex");
    if (
      cache.modelId !== modelId ||
      cache.databaseSha256 !== digest ||
      !cache.points ||
      typeof cache.points !== "object"
    )
      return empty;
    return new Map(
      Object.entries(cache.points).flatMap(([path, value]) => {
        const point = value as SpacePoint | null;
        return point && [point.x, point.y, point.z].every(Number.isFinite)
          ? [[path, point] as [string, SpacePoint]]
          : [];
      }),
    );
  } catch {
    // An optional view must not make the archive unavailable.
    return empty;
  }
};
