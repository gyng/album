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
| metadata     | iso8601             |              | camera-local naive ISO timestamp  |
| embeddings   | path                | similarity   | composite key with `model_id`     |
| embeddings   | model_id            | similarity   | embedding model identifier        |
| embeddings   | embedding_dim       | similarity   | vector dimensionality             |
| embeddings   | embedding_blob      | similarity   | int8-quantised embedding vector    |
| embeddings   | embedding_scale     | similarity   | per-vector dequantisation scale    |
| image_tags   | path, tag, source    | tag counts   | authoritative per-image tags       |
| pipeline_state | path, stage        | indexing     | digest, version, model provenance  |

The [FTS5 SQLite extension](https://www.sqlite.org/fts5.html) requires sqlite3 >= 3.34.0 and creates a virtual table.

The first inference run downloads pinned model snapshots. Later runs process only
missing, changed, or pipeline-version-stale stages. Source freshness uses SHA-256,
so replacing a file while preserving its timestamp and size is still detected.

The SQLite write path can be benchmarked independently of model loading with the built-in synthetic benchmark command.

## Usage

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```sh
$ uv sync                    # lightweight CLI and test dependencies
$ uv sync --extra inference  # required for model inference/indexing

$ uv run ruff check --fix .
$ uv run ruff format .

$ uv run index.py --help
$ uv run --extra inference python index.py index --glob "../albums/test-simple/*.[jJ][pP][gG]"
$ uv run --extra inference python index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" --dry-run --model-profile hybrid
$ uv run python index.py validate --glob "../albums/**/*.jpg" --dbpath "search.sqlite" --model-profile hybrid
$ uv run python index.py benchmark-index --rows 200 --repeat 3 --output ".index-benchmark.json"
$ uv run --extra inference python index.py benchmark-janus-batch --glob "../albums/**/*.jpg" --batch-sizes 1,2,4 --repeat 2 --output ".janus-batch-benchmark.json"
$ uv run --extra inference python index.py benchmark-classifier --backend gemma4-gguf --model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --path "../albums/test-simple/DSCF0506-2.jpg" --repeat 1 --output ".gemma4-gguf-benchmark.json"
$ uv run --extra inference python index.py compare-captioners --glob "../albums/test-simple/*.[jJ][pP][gG]" --baseline-dbpath "./test-simple.sqlite" --sample-size 5 --candidate-backend gemma4-gguf --candidate-model-id "/tmp/gemma4-e4b-gguf/gemma-4-E4B-it-Q8_0.gguf" --candidate-quantization "/tmp/gemma4-e4b-gguf/mmproj-BF16.gguf" --output-json ".caption-comparison.json" --output-md ".caption-comparison.md"
$ uv run index.py search --query "singapore"
$ uv run python index.py search-similar-path --dbpath "search.sqlite" --path "../albums/2511japan/DSCF6007-06.jpg"

$ uv run index.py dump
$ uv run index.py search-tags --query "dam"
$ uv run index.py search-metadata --query "D"

$ uv run index.py prune --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" --dry-run

# Test
$ ./create-test-db.sh              # rebuild committed fixtures; installs inference extra
$ ./do-test-index.sh              # model-free default; suitable for CI
$ ./do-test-index-inference.sh    # opt-in Janus/CUDA integration check

# Perform a full index and copy split core + embeddings DBs to /public in the Next.js app
$ ./do-full-index.sh

# Generate the frontend embeddings DB only
$ ./do-embeddings-index.sh
```

Live model inference is deliberately excluded from the default suite. Set
`INDEX_RUN_MODEL_INFERENCE=1` only through `do-test-index-inference.sh`; normal CI
must remain deterministic and must not download or execute model weights.

## Benchmarking

Use the synthetic benchmark to measure the SQLite-heavy portion of indexing without paying model download or inference costs:

```sh
$ uv run python index.py benchmark-index --rows 200 --repeat 3 --output ".index-benchmark.json"
```

The synthetic command reports median setup and current chunked-insert timings.
Normal `index --benchmark-output ...` runs also record caption, v1, and v2 load
and inference durations plus incomplete-stage counts for comparing future changes.

Profile the model-free photo pipeline on a deterministic, album-balanced sample:

```sh
$ uv run python index.py benchmark-cpu --sample-size 128 --repeat 3 --hash-workers 8 --exif-workers 1 --colour-workers 4 --output ".index-cpu-benchmark.json"
$ uv run python index.py benchmark-colours --sample-size 128 --max-dimension 512 --quality 10 --output ".index-colour-benchmark.json"
```

Production colour extraction is deliberately full-resolution. `benchmark-colours`
compares it against a bounded-thumbnail candidate (JPEG draft decode plus a BOX
thumbnail) and reports wall-time alongside dominant and whole-palette CIE76 ΔE.

Read those two ΔE figures together. The thumbnail is ~4.5x faster in isolation and
its whole-palette ΔE stays low, but it reorders the median-cut clusters: across 300
real photos it moved `palette[0]` by more than ΔE 18 for 23% of them, sometimes
inverting light and dark. `palette[0]` is the dominant colour behind map markers,
timeline entries, photo placeholders and slideshow pairing, so a low whole-palette
ΔE alone does not mean a candidate is safe to publish. Colours are extracted on
background threads concurrently with GPU inference, so the speedup is hidden behind
captioning and buys no measurable wall-clock on a full index.

Content hashing uses eight I/O workers; EXIF parsing skips MakerNote/thumbnail
details because none of those fields are kept (verified byte-identical on the
retained fields across real photos).

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

- `janus`: generate search tags, short alt text, and metadata only.
- `siglip2`: generate both browser-compatible SigLIP v1 and visual-similarity
  SigLIP v2 embeddings only; it does not parse EXIF, extract colours, or touch
  caption rows.
- `hybrid`: generate caption metadata and SigLIP embeddings in one pass.

The caption prompt emits only `tags` and `alt_text`. The primary subject is the
first tag, followed by other concrete objects and useful visual themes. A separate
subject field and separate object/theme arrays were removed because the frontend
merged or treated them as fallbacks, so they added generation cost without
preserving distinct behaviour.

## Caption backends

- `janus`: current default and rollback path.
- `gemma4`: retained experimental backend for future work. In practice, this needs a newer `transformers` runtime than the default Janus environment.
- `gemma4-gguf`: `llama.cpp` backend for local GGUF Gemma 4 runs. The best local quantised result so far is `unsloth/gemma-4-E4B-it-GGUF:Q8_0` with `mmproj-BF16`.

### Running a GGUF backend locally

The GGUF path shells out to `llama-mtmd-cli`, which is resolved in this order:

1. `$LLAMA_MTMD_CLI`, if set (must exist).
2. `llama-mtmd-cli` on `PATH`.
3. `~/.local/opt/llama.cpp/build/bin/llama-mtmd-cli`, then `/usr/local/bin/llama-mtmd-cli`.

Build it somewhere persistent — a `/tmp` build is wiped on reboot and turns a
working backend into "could not find llama-mtmd-cli":

```
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/.local/opt/llama.cpp
cd ~/.local/opt/llama.cpp
cmake -B build -G Ninja -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86 -DLLAMA_CURL=ON
cmake --build build --target llama-mtmd-cli
```

Pass a quant with the `--model-id` repo tag (`unsloth/gemma-4-E4B-it-GGUF:UD-Q5_K_XL`),
or point `--model-id` at a local `.gguf` and give the mmproj path via `--quantization`.

Quantisation choice is VRAM-bound. On a 10GB card, `Q8_0` (8.19GB) plus
`mmproj-BF16` (0.99GB) leaves almost nothing for the KV cache at the default
32768 context, so `--gpu-layers auto` offloads to CPU. The Unsloth Dynamic quants
(`UD-Q5_K_XL` 6.66GB, `UD-Q4_K_XL` 5.13GB) fit fully on-GPU with headroom. Use
`benchmark-caption-quality --backend gemma4-gguf --model-id <repo:quant>` to
compare them before changing any default.

Current compatibility note:
Janus-Pro-1B is the default production path in this repo. The GGUF Gemma path is kept as experimental groundwork for future image and video work. The full-precision `transformers` Gemma path is also retained in code, but it is not the normal runtime and should be treated as separate experimental work.

Current local-debugging note:
In local testing, the `transformers` `bnb-4bit` Gemma path repeatedly hallucinated placeholder-like "gray image" descriptions for normal photos. Keep the GGUF path as the preferred quantised experiment instead.

Recommended local rollout:

1. Keep Janus-Pro-1B as the default captioner.
2. Use the GGUF Gemma path for focused evaluation and future roadmap work.
3. Compare outputs on a balanced sample before changing any production DB build.
4. If video work starts, build it first as sampled-frame processing on top of the retained Gemma groundwork.

`do-full-index.sh` uses `hybrid`. `do-embeddings-index.sh` is useful when you want
to preserve the current metadata-backed `search.sqlite` and only refresh the
embeddings table; it uses the same working DB by default, avoiding a second
incremental source that can drift. Both scripts work on a staging copy, prune and validate exact
source coverage, then atomically promote the working DB and compact public DBs.
The last good databases remain untouched when indexing or validation fails, and
the staging DB is retained so the next invocation resumes completed batches.

Both derive the same staging name (`search.sqlite` → `search.staging.sqlite`) and
seed it through `index.py prepare-staging`, so a paused full index is resumable
from either workflow instead of one silently re-seeding from the stale working DB.
`prepare-staging` refuses to resume a staging database that fails `PRAGMA
quick_check`, and seeds via a temporary file renamed into place: a `cp` interrupted
by Ctrl-C or ENOSPC would otherwise leave a truncated file that the next run treats
as resumable and commits GPU hours to.

## Incremental stage model

Core metadata/colours, captions, SigLIP v1, and SigLIP v2 are independent stages.
A partial profile updates only the stages it owns. Each successful stage records
the source SHA-256, pipeline version, model ID, pinned revision, and completion
time in `pipeline_state`. Failed captions or unreadable embeddings do not receive
a completion record, so the next run retries them without erasing the previous
successful output.

A database predating `pipeline_state` has its core and embedding rows imported as
a baseline, because that output is reproducible from the pinned pipeline and model.
Captions are the exception: a legacy caption may have come from the retired
four-field v1 prompt and nothing in the row proves which prompt produced it, so it
is re-captioned rather than imported. Importing it under the current version would
assert provenance that cannot be shown, and `validate` could never catch it because
the claimed version would be the expected one by construction.

`publish` refuses to replace a live output whose row count would drop below 90% of
the published index (`--allow-shrink` overrides). `quick_check` only proves the
generated file is structurally sound; it says nothing about content.

Because `rename` unlinks the previous inode, `publish` first keeps one copy of each
database it is about to replace, as `index/published-<name>.bak` (`--backup-dir`
overrides). These live beside the source, never in `public/`, which is copied
wholesale into the site build and would serve them as multi-MB static assets. The
copy is a hard link, so it costs no disk and cannot be caught half-written; publish
only ever replaces outputs by rename, so the retained link keeps the old bytes. An
output on another filesystem cannot be linked and falls back to a staged copy. Only
the most recent replaced copy is kept.

The core and embeddings renames are each atomic, but the pair is not, and no POSIX
call can swap two files together. The site loads both databases as one index, so a
half-applied publish means photos with no vectors and vectors for paths that no
longer exist. Rather than prevent skew, `publish` makes it unable to persist: it
records the intended moves in `index/.publish-journal.json` before touching
anything, restores the pair from the backups if a rename fails in process, and
restores it on the next publish if the process was killed outright. Recovery rolls
back to the backups rather than forward, because those are by definition the last
mutually consistent pair, while the half-built temporaries may already have been
cleaned up. A publish that completed but died before clearing its journal is rolled
back too, harmlessly — the same run republishes immediately afterwards.

`prune` additionally refuses when an album directory still holds indexed rows but
matches no source files, because counts cannot separate an unmounted album from
ordinary curation. Only the two largest albums here are big enough to trip the
percentage guard, so an album of ~100 photos failing to mount would otherwise be
pruned, validated against the same shrunken glob, published, and then written over
the working DB.

The failure is quiet rather than obvious. Album pages are built from the album
directories and treat the index as optional enrichment, so the album still renders;
it just disappears from text, facet, and semantic search, and loses `colors`, which
drops its map markers back to `transparent`. Restoring it means re-running GPU
inference for the whole album, not re-copying a file. Deleting individual photos
leaves the album matching, so curation is unaffected; `--force` covers deliberately
removing a whole album.

Tag frequencies are rebuilt from `image_tags`; classifier and geocode tags can
therefore be replaced or removed without count drift. `schema_migrations` is the
explicit source of migration state, including for galleries with no GPS rows.
These build-only tables and `file_signatures` are removed from the compact public
core DB; browsers receive only the runtime search, tag, and metadata tables.

## Generation guardrails

- Janus defaults to the measured production batch size of 4. Representative
  profiling showed 3.28× single-image throughput and about 5.53 GB peak reserved
  VRAM. Batch 6 reserved about 6.36 GB but was slower because decoder stragglers
  held the larger batch open; larger batches therefore require
  `--allow-experimental-classifier-batch-size`.
- The Transformers runtime and model revisions are locked. Janus retains its
  model-defined composite processor settings; forcing `use_fast=False` also
  selects an incompatible slow Llama tokenizer for this checkpoint.
- A CUDA OOM automatically bisects the failed caption batch down to single
  images while retaining already committed work.
- Generation has a 120-second batch deadline, low-VRAM warning/stop thresholds,
  and periodic heartbeats.
- Parsed captions reject missing fields, empty payloads, excessive tags or text,
  overlong tags, and leaked model control tokens. Failed captions remain
  incomplete and retry on the next run.
- Non-EOS/token-capped rows are identified within a padded decoder batch and
  retried singly. A measured 192-token batch straggler completed as valid JSON in
  79 tokens when retried alone, without raising the global token cap.
- Run statistics include generated token counts, non-EOS/token-limit counts,
  OOM fallbacks, minimum free VRAM, per-stage time, and failure counts. Use these
  measurements before changing the 192-token default.

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
