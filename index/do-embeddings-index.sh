#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

EMBED_DB="${1:-all-embeddings.sqlite}"
OUTPUT_DB="${2:-../src/public/search-embeddings.sqlite}"

uv run --extra inference python index.py index \
  --glob "../albums/**/*.jpg" \
  --dbpath "$EMBED_DB" \
  --model-profile siglip2

uv run --extra inference python - <<'PY' "$EMBED_DB" "$OUTPUT_DB"
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

# 4096-byte pages (the SQLite default) — set explicitly to document the departure
# from the legacy 1024-byte pages, which only paid off for sql.js-httpvfs range
# reads; the browser now downloads the DB in full.
dest.execute("PRAGMA page_size=4096")
dest.execute(
    "CREATE TABLE IF NOT EXISTS embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_blob BLOB, embedding_scale REAL, PRIMARY KEY(path, model_id))"
)
dest.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_path ON embeddings(path)")

rows = src.execute(
    "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings"
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
    "INSERT OR REPLACE INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) VALUES (?, ?, ?, ?, ?)",
    rows,
)
dest.commit()
dest.execute("VACUUM")
dest.commit()

src.close()
dest.close()

tmp_db.replace(output_db)
PY

uv run --extra inference python - <<'PY' "$OUTPUT_DB"
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
embeddings = db.execute("SELECT count(*) FROM embeddings").fetchone()[0]
print({"embeddings": embeddings})
db.close()
PY
