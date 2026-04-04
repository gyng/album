#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

EMBED_DB="${1:-all-embeddings.sqlite}"
OUTPUT_DB="${2:-../src/public/search-embeddings.sqlite}"

uv run python index.py index \
  --glob "../albums/**/*.jpg" \
  --dbpath "$EMBED_DB" \
  --model-profile siglip2

uv run python - <<'PY' "$EMBED_DB" "$OUTPUT_DB"
import sqlite3
import sys
from pathlib import Path

embedding_db = Path(sys.argv[1])
output_db = Path(sys.argv[2])

tmp_db = output_db.with_suffix(output_db.suffix + ".tmp")
if tmp_db.exists():
    tmp_db.unlink()

dest = sqlite3.connect(tmp_db)
src = sqlite3.connect(embedding_db)

dest.execute(
    "CREATE TABLE IF NOT EXISTS embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_json TEXT, PRIMARY KEY(path, model_id))"
)
dest.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_path ON embeddings(path)")

rows = src.execute(
    "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings"
).fetchall()

existing_rows = 0
if output_db.exists():
    existing = sqlite3.connect(output_db)
    try:
        existing_rows = existing.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
    except sqlite3.Error:
        existing_rows = 0
    finally:
        existing.close()

new_rows = len(rows)
if existing_rows > 0 and new_rows < int(existing_rows * 0.9):
    raise SystemExit(
        f"Refusing to replace {output_db}: new embeddings row count {new_rows} is much smaller than existing {existing_rows}."
    )

dest.executemany(
    "INSERT OR REPLACE INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?)",
    rows,
)
dest.commit()
dest.execute("VACUUM")
dest.commit()

src.close()
dest.close()

tmp_db.replace(output_db)
PY

uv run python - <<'PY' "$OUTPUT_DB"
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
embeddings = db.execute("SELECT count(*) FROM embeddings").fetchone()[0]
print({"embeddings": embeddings})
db.close()
PY
