# index

Indexes images for search with the following fields

| Table        | Column              | Frontend     | Notes                             |
| ------------ | ------------------- | ------------ | --------------------------------- |
| fts5(images) | path                |              |                                   |
| fts5(images) | album_relative_path |              |                                   |
| fts5(images) | filename            |              |                                   |
| fts5(images) | EXIF                | searched     | excluding binary data             |
| fts5(images) | geocode             | searched     | geocoded to country and city      |
| fts5(images) | tags                | searched     | classified using Janus-Pro-1B     |
| fts5(images) | colors              | placeholder  | median cut (top 5); `[r, g, b][]` |
| tags         | tag                 |              | primary key, Janus-Pro-1B         |
| tags         | count               | autocomplete | tags count                        |
| metadata     | path                |              | primary key                       |
| metadata     | lat_deg             | map          |                                   |
| metadata     | lng_deg             | map          |                                   |
| metadata     | iso8601             |              | assumed UTC                       |
| embeddings   | path                | similarity   | primary key                       |
| embeddings   | model_id            | similarity   | embedding model identifier        |
| embeddings   | embedding_dim       | similarity   | vector dimensionality             |
| embeddings   | embedding_json      | similarity   | normalised image embedding vector |

The [FTS5 SQLite extension](https://www.sqlite.org/fts5.html) requires sqlite3 >= 3.34.0 and creates a virtual table.

Full indexing of ~1000 images takes around 3+ minutes. First run will download model weights which takes some time.

The SQLite write path can be benchmarked independently of model loading with the built-in synthetic benchmark command.

## Usage

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```sh
$ uv sync

$ uv run ruff --fix
$ uv run black .

$ uv run index.py --help
$ uv run python index.py index --glob "../albums/test-simple/*.[jJ][pP][gG]"
$ uv run python index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" --dry-run --model-profile hybrid
$ uv run python index.py benchmark-index --rows 200 --repeat 3 --output ".index-benchmark.json"
$ uv run index.py search --query "singapore"
$ uv run python index.py search-similar-path --dbpath "search.sqlite" --path "../albums/2511japan/DSCF6007-06.jpg"

$ uv run index.py dump
$ uv run index.py search-tags --query "dam"
$ uv run index.py search-metadata --query "D"

$ uv run index.py prune --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" --dry-run

$ cp search.sqlite ../src/public/search.sqlite

# Test
$ ./create-test-db.sh
$ ./do-test-index.sh

# Perform a full index and copy it to /public in the Next.js app
$ ./do-full-index.sh

# Generate embeddings only and merge them into the active public database
$ ./do-embeddings-index.sh
```

## Benchmarking

Use the synthetic benchmark to measure the SQLite-heavy portion of indexing without paying model download or inference costs:

```sh
$ uv run python index.py benchmark-index --rows 200 --repeat 3 --output ".index-benchmark.json"
```

The command reports median setup and insert timings and can write a JSON artifact for comparing future optimisations.

To benchmark the Janus classifier path directly on a sample image:

```sh
$ uv run python index.py benchmark-janus --path "../src/test/fixtures/monkey.jpg" --repeat 3 --output ".janus-benchmark.json"
```

## Model profiles

- `janus`: generate tags, short alt text, subject text, and metadata only.
- `siglip2`: generate image embeddings only.
- `hybrid`: generate Janus metadata and SigLIP embeddings in one pass.

The Janus prompt is intentionally limited to the fields currently used by the frontend search UX: `identified_objects`, `themes`, `alt_text`, and `subject`.

`do-full-index.sh` uses `hybrid`. `do-embeddings-index.sh` is useful when you want to preserve the current metadata-backed `search.sqlite` and only refresh the embeddings table.

## Frontend Search Pipeline

The generated SQLite database drives all search features in the Next.js app:

- `Keyword search` reads the FTS tables locally in the browser.
- `Similarity search` ranks rows from the `embeddings` table against another image embedding.
- `Semantic search` embeds user text in the browser and compares it against the same stored image vectors.
- `Hybrid search` fuses the keyword and semantic rankings with Reciprocal Rank Fusion.

If you change the embedding model family, keep the frontend text encoder and the stored image embeddings in the same embedding space. Similar-photo search can still work with image embeddings alone, but semantic text-to-image and hybrid ranking depend on that compatibility.

## Prerequisites

- CUDA/GPU access ([WSL2 instructions](https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local))
- Python 3.12
- sqlite3 >= 3.34.0

## WSL2

- CUDA/GPU access ([WSL2 instructions](https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local))

If you encounter `Could not load library libcudnn_cnn_infer.so.8`

Add this to `~/.bashrc`

```
export LD_LIBRARY_PATH=/usr/lib/wsl/lib:$LD_LIBRARY_PATH
```

Don't forget to source it

```sh
$ source ~/.bashrc
```

See: https://discuss.pytorch.org/t/libcudnn-cnn-infer-so-8-library-can-not-found/164661
