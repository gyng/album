#!/bin/bash
set -euox pipefail

uv run index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" --model-profile hybrid
uv run index.py prune --glob "../albums/**/*.jpg" --dbpath "search.sqlite"
uv run index.py search --query "burger" --dbpath "search.sqlite"
sqlite3 search.sqlite "VACUUM;"
uv run python - <<'PY'
import shutil
import sqlite3
from pathlib import Path

source_db = Path("search.sqlite")
core_output = Path("../src/public/search.sqlite")
embeddings_output = Path("../src/public/search-embeddings.sqlite")

tmp_core = core_output.with_suffix(core_output.suffix + ".tmp")
tmp_embeddings = embeddings_output.with_suffix(embeddings_output.suffix + ".tmp")

if tmp_core.exists():
    tmp_core.unlink()
if tmp_embeddings.exists():
    tmp_embeddings.unlink()

shutil.copy2(source_db, tmp_core)

core = sqlite3.connect(tmp_core)
core.execute("DROP TABLE IF EXISTS embeddings")
core.commit()
core.execute("VACUUM")
core.commit()
core.close()

source = sqlite3.connect(source_db)
embeddings = sqlite3.connect(tmp_embeddings)
embeddings.execute(
    "CREATE TABLE embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_json TEXT, PRIMARY KEY(path, model_id))"
)
embeddings.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_path ON embeddings(path)")
rows = source.execute(
    "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings"
).fetchall()

existing_rows = 0
if embeddings_output.exists():
    existing = sqlite3.connect(embeddings_output)
    try:
        existing_rows = existing.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
    except sqlite3.Error:
        existing_rows = 0
    finally:
        existing.close()

new_rows = len(rows)
if existing_rows > 0 and new_rows < int(existing_rows * 0.9):
    raise SystemExit(
        f"Refusing to replace {embeddings_output}: new embeddings row count {new_rows} is much smaller than existing {existing_rows}."
    )

embeddings.executemany(
    "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?)",
    rows,
)
embeddings.commit()
embeddings.execute("VACUUM")
embeddings.commit()

source.close()
embeddings.close()

tmp_core.replace(core_output)
tmp_embeddings.replace(embeddings_output)
PY
