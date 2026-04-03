# index

Indexes images for search with the following fields

| Table        | Column              | Frontend     | Notes                             |
| ------------ | ------------------- | ------------ | --------------------------------- |
| fts5(images) | path                |              |                                   |
| fts5(images) | album_relative_path |              |                                   |
| fts5(images) | filename            |              |                                   |
| fts5(images) | EXIF                | searched     | excluding binary data             |
| fts5(images) | geocode             | searched     | geocoded to country and city      |
| fts5(images) | tags                | searched     | classified using the selected caption backend |
| fts5(images) | colors              | placeholder  | median cut (top 5); `[r, g, b][]` |
| tags         | tag                 |              | primary key, from caption backend |
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
$ uv run python index.py benchmark-classifier --backend gemma4-gguf --model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --path "../albums/test-simple/DSCF0506-2.jpg" --repeat 1 --output ".gemma4-gguf-benchmark.json"
$ uv run python index.py compare-captioners --glob "../albums/test-simple/*.[jJ][pP][gG]" --baseline-dbpath "./test-simple.sqlite" --sample-size 5 --candidate-backend gemma4-gguf --candidate-model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --candidate-quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --output-json ".caption-comparison.json" --output-md ".caption-comparison.md"
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

# Perform a full index and copy split core + embeddings DBs to /public in the Next.js app
$ ./do-full-index.sh

# Generate the frontend embeddings DB only
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

To benchmark the working `llama.cpp` GGUF path locally:

```sh
$ uv run python index.py benchmark-classifier --backend gemma4-gguf --model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --path "../albums/test-simple/DSCF0506-2.jpg" --repeat 1 --output ".gemma4-gguf-benchmark.json"
```

To compare the current DB captions against Gemma on a balanced sample and generate a review artifact:

```sh
$ uv run python index.py compare-captioners --glob "../albums/test-simple/*.[jJ][pP][gG]" --baseline-dbpath "./test-simple.sqlite" --sample-size 5 --candidate-backend gemma4-gguf --candidate-model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --candidate-quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --output-json ".caption-comparison.json" --output-md ".caption-comparison.md"
```

The JSON artifact stores the side-by-side rows. The Markdown report is the first-pass human review summary for deciding whether the quality gain is worth any speed regression.

## Model profiles

- `janus`: generate tags, short alt text, subject text, and metadata only.
- `siglip2`: generate image embeddings only.
- `hybrid`: generate caption metadata and SigLIP embeddings in one pass.

The caption prompt is intentionally limited to the fields currently used by the frontend search UX: `identified_objects`, `themes`, `alt_text`, and `subject`.

## Caption backends

- `janus`: current default and rollback path.
- `gemma4`: retained experimental backend for future work. In practice, this needs a newer `transformers` runtime than the default Janus environment.
- `gemma4-gguf`: `llama.cpp` backend for local GGUF Gemma 4 runs. The best local quantised result so far is `unsloth/gemma-4-E4B-it-GGUF:Q8_0` with `mmproj-BF16`.

Current compatibility note:
Janus-Pro-1B is the default production path in this repo. The GGUF Gemma path is kept as experimental groundwork for future image and video work. The full-precision `transformers` Gemma path is also retained in code, but it is not the normal runtime and should be treated as separate experimental work.

Current local-debugging note:
In local testing, the `transformers` `bnb-4bit` Gemma path repeatedly hallucinated placeholder-like "gray image" descriptions for normal photos. Keep the GGUF path as the preferred quantised experiment instead.

Recommended local rollout:

1. Keep Janus-Pro-1B as the default captioner.
2. Use the GGUF Gemma path for focused evaluation and future roadmap work.
3. Compare outputs on a balanced sample before changing any production DB build.
4. If video work starts, build it first as sampled-frame processing on top of the retained Gemma groundwork.

`do-full-index.sh` uses `hybrid`. `do-embeddings-index.sh` is useful when you want to preserve the current metadata-backed `search.sqlite` and only refresh the embeddings table.

## Frontend Search Pipeline

The generated SQLite databases drive all search features in the Next.js app:

- `search.sqlite` carries FTS, tags, and metadata for keyword and browse features.
- `search-embeddings.sqlite` carries the embeddings table used by semantic and similarity search.
- `Keyword search` reads the FTS tables locally in the browser.
- `Similarity search` ranks rows from the embeddings DB against another image embedding.
- `Semantic search` embeds user text in the browser and compares it against the same stored image vectors.
- `Hybrid search` fuses the keyword and semantic rankings with Reciprocal Rank Fusion.

The browser text encoder uses SigLIP v1 (`Xenova/siglip-base-patch16-224`, ONNX, q4) because the v2 model is too large to ship to the browser — do not upgrade without a viable ONNX-quantised v2 alternative. If you change the embedding model, update the browser text encoder to match: semantic and hybrid search require both to share the same embedding space. Similar-photo search works with image embeddings alone and is not affected by the model family constraint.

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
