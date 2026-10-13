"""Build the optional semantic cloud layout from existing image embeddings.

Run: uv run --no-project --with umap-learn==0.5.12 src/bin/prepare-umap.py
No model inference. Normal builds can use the overview when this cache is absent.
"""

import hashlib
import json
from pathlib import Path
import sqlite3

import numpy as np
from umap import UMAP

root = Path(__file__).resolve().parent.parent
source = root / "public/search-embeddings.sqlite"
output = root / "public/data/embedding-umap.json"
digest = hashlib.sha256(source.read_bytes()).hexdigest()
with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as db:
    models = [row[0] for row in db.execute("SELECT DISTINCT model_id FROM embeddings")]
    preferred = ["google/siglip2-base-patch16-224", "google/siglip-base-patch16-224"]
    model = next((name for name in preferred if name in models), models[0])
    rows = list(db.execute(
        "SELECT path, embedding_blob, embedding_scale FROM embeddings "
        "WHERE model_id=? ORDER BY path",
        (model,),
    ))
    vectors = np.asarray([
        np.frombuffer(blob, dtype=np.int8).astype(np.float32) * scale
        for _, blob, scale in rows
    ])
vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)
positions = UMAP(
    n_components=3,
    n_neighbors=min(15, len(rows) - 1),
    min_dist=0.15,
    metric="cosine",
    random_state=42,
    n_jobs=1,
).fit_transform(vectors)
# One scale for all axes keeps distances intact when fitting the view's cube.
centre = (positions.max(axis=0) + positions.min(axis=0)) / 2
scale = max(float(np.ptp(positions, axis=0).max()) / 2, 1e-9)
positions = (positions - centre) / scale
output.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "databaseSha256": digest,
    "modelId": model,
    "points": {
        row[0]: dict(zip(["x", "y", "z"], map(float, position)))
        for row, position in zip(rows, positions)
    },
}
if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
    raise RuntimeError("The embedding database changed. Run the layout preparation again.")
temporary = output.with_suffix(".tmp")
temporary.write_text(json.dumps(payload, separators=(",", ":")))
temporary.replace(output)
print(f"Prepared semantic layout for {len(rows)} photographs: {output}")
