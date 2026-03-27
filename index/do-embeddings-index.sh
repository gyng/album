#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

EMBED_DB="${1:-all-embeddings.sqlite}"
SOURCE_DB="${2:-../src/public/search.sqlite}"
OUTPUT_DB="${3:-../src/public/search.sqlite}"
BACKUP_DB="${OUTPUT_DB}.bak"

uv run python index.py index \
  --glob "../albums/**/*.jpg" \
  --dbpath "$EMBED_DB" \
  --model-profile siglip2

cp "$SOURCE_DB" "$BACKUP_DB"

uv run python - <<'PY' "$SOURCE_DB" "$EMBED_DB" "$OUTPUT_DB"
import sqlite3
import sys
from pathlib import Path

source_db = Path(sys.argv[1])
embedding_db = Path(sys.argv[2])
output_db = Path(sys.argv[3])

tmp_db = output_db.with_suffix(output_db.suffix + ".tmp")
tmp_db.write_bytes(source_db.read_bytes())

dest = sqlite3.connect(tmp_db)
src = sqlite3.connect(embedding_db)

dest.execute(
    "CREATE TABLE IF NOT EXISTS embeddings (path VARCHAR PRIMARY KEY, model_id TEXT, embedding_dim INTEGER, embedding_json TEXT)"
)

rows = src.execute(
    "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings"
).fetchall()

dest.executemany(
    "INSERT OR REPLACE INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?)",
    rows,
)
dest.commit()

src.close()
dest.close()

tmp_db.replace(output_db)
PY

uv run python - <<'PY' "$OUTPUT_DB"
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
images = db.execute("SELECT count(*) FROM images").fetchone()[0]
embeddings = db.execute("SELECT count(*) FROM embeddings").fetchone()[0]
print({"images": images, "embeddings": embeddings})
db.close()
PY