import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loadSemanticProjection } from "./embeddingProjection";
it("uses only a matching embedding database and model, and rejects invalid positions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-projection-"));
  try {
    const db = path.join(dir, "db");
    const cache = path.join(dir, "cache");
    fs.writeFileSync(db, "embeddings");
    fs.writeFileSync(
      cache,
      JSON.stringify({
        modelId: "model",
        databaseSha256: crypto.createHash("sha256").update("embeddings").digest("hex"),
        points: { photo: { x: 1, y: 0, z: 0 }, bad: { x: null, y: 0, z: 0 } },
      }),
    );
    expect([...loadSemanticProjection(db, cache, "model")]).toEqual([
      ["photo", { x: 1, y: 0, z: 0 }],
    ]);
    expect(loadSemanticProjection(db, cache, "another").size).toBe(0);
    fs.writeFileSync(db, "changed");
    expect(loadSemanticProjection(db, cache, "model").size).toBe(0);
    expect(loadSemanticProjection(db, path.join(dir, "missing"), "model").size).toBe(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
