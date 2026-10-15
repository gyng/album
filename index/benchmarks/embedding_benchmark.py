"""Reproducible local embedding comparison; never modifies the gallery databases.

Run stages with the isolated runtimes documented in docs/embedding-benchmark.md.
Large artefacts live beneath .cache/embedding-benchmark, which is gitignored.
"""

import argparse
import concurrent.futures
import contextlib
import hashlib
import json
import sqlite3
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".cache/embedding-benchmark"
QUERIES = json.loads((Path(__file__).with_name("embedding-queries.json")).read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def file_digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def normalise(array):
    array = np.asarray(array, dtype=np.float32)
    if not np.isfinite(array).all():
        raise ValueError("Non-finite embedding")
    norms = np.linalg.norm(array, axis=-1, keepdims=True)
    if (norms == 0).any():
        raise ValueError("Zero embedding")
    return array / norms


def prepare():
    core = sqlite3.connect(f"file:{ROOT}/src/public/search.sqlite?mode=ro", uri=True)
    vectors = sqlite3.connect(
        f"file:{ROOT}/src/public/search-embeddings.sqlite?mode=ro", uri=True
    )
    rows = core.execute(
        "SELECT path, alt_text, tags FROM images ORDER BY path"
    ).fetchall()
    ids = [
        row[0]
        for row in vectors.execute(
            "SELECT path FROM embeddings WHERE model_id = 'google/siglip-base-patch16-224' ORDER BY path"
        )
    ]
    indexed = {row[0]: row for row in rows}
    corpus = []
    for path in ids:
        source = (ROOT / "src" / path).resolve()
        if source.suffix.lower() in {".youtube", ".mov", ".mp4", ".webm"}:
            source = (
                ROOT
                / "src/public/data/albums"
                / source.parent.name
                / ".resized_videos"
                / (source.name + "@poster.jpg")
            )
        if not source.is_file():
            raise FileNotFoundError(source)
        row = indexed[path]
        corpus.append(
            {
                "path": path,
                "source": str(source),
                "caption": row[1] or "",
                "tags": row[2] or "",
            }
        )
    write_json(WORK / "corpus.json", corpus)
    write_json(WORK / "queries.json", QUERIES)
    arrays = {}
    for key, model_id in [
        ("siglip1", "google/siglip-base-patch16-224"),
        ("siglip2", "google/siglip2-base-patch16-224"),
    ]:
        by_path = {
            path: np.frombuffer(blob, dtype=np.int8).astype(np.float32) * scale
            for path, blob, scale in vectors.execute(
                "SELECT path, embedding_blob, embedding_scale FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        }
        arrays[key] = normalise([by_path[path] for path in ids])
    np.savez(WORK / "existing-images.npz", **arrays)
    write_json(
        WORK / "dataset.json",
        {
            "images": len(ids),
            "path_sha256": hashlib.sha256("\n".join(ids).encode()).hexdigest(),
            "core_sha256": file_digest(ROOT / "src/public/search.sqlite"),
            "embeddings_sha256": file_digest(
                ROOT / "src/public/search-embeddings.sqlite"
            ),
        },
    )
    print(
        f"Prepared {len(ids)} common images and {len(QUERIES)} fixed queries",
        flush=True,
    )


def baselines():
    import torch
    from transformers import AutoModel, AutoTokenizer

    torch.set_num_threads(4)
    stats = {}
    arrays = {}
    for key, model_id in [
        ("siglip1", "google/siglip-base-patch16-224"),
        ("siglip2", "google/siglip2-base-patch16-224"),
    ]:
        start = time.perf_counter()
        model = (
            AutoModel.from_pretrained(model_id, local_files_only=True).to("cuda").eval()
        )
        tokenizer = AutoTokenizer.from_pretrained(
            model_id, revision=model.config._commit_hash
        )
        loaded = time.perf_counter() - start
        times, results = [], []
        with torch.inference_mode():
            for query in QUERIES:
                inputs = tokenizer(
                    query["text"].lower(),
                    padding="max_length",
                    truncation=True,
                    max_length=64,
                    return_tensors="pt",
                ).to("cuda")
                torch.cuda.synchronize()
                start = time.perf_counter()
                result = model.get_text_features(**inputs)
                torch.cuda.synchronize()
                times.append((time.perf_counter() - start) * 1000)
                if not isinstance(result, torch.Tensor):
                    result = result.pooler_output
                results.append(result.float().cpu().numpy()[0])
        arrays[key] = normalise(results)
        stats[key] = {
            "model": model_id,
            "revision": model.config._commit_hash,
            "dtype": "fp32",
            "device": "RTX 3080 CUDA",
            "load_seconds": loaded,
            "query_ms": times,
        }
        del model
        torch.cuda.empty_cache()
    np.savez(WORK / "baseline-queries.npz", **arrays)
    write_json(WORK / "baseline-stats.json", stats)


def gemma(batch_size):
    import gc

    import torch
    from PIL import Image, ImageOps
    from transformers import AutoConfig, AutoModel, AutoProcessor

    torch.set_num_threads(4)
    corpus = json.loads((WORK / "corpus.json").read_text())
    config = AutoConfig.from_pretrained(WORK / "google")
    config.audio_config = None
    start = time.perf_counter()
    model = (
        AutoModel.from_pretrained(
            WORK / "google",
            config=config,
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
        )
        .to("cuda")
        .eval()
    )
    processor = AutoProcessor.from_pretrained(WORK / "google")
    stats = {
        "device": "RTX 3080 CUDA",
        "dtype": "bf16",
        "load_seconds": time.perf_counter() - start,
        "batch_size": batch_size,
        "query_ms": [],
        "image_batches": [],
        "caption_batches": [],
    }

    def encode(text=None, images=None):
        inputs = processor(
            text=text, images=images, padding=True, return_tensors="pt"
        ).to("cuda")
        with torch.inference_mode():
            output = model(**inputs).last_hidden_state.float()
            mask = inputs["attention_mask"].unsqueeze(-1)
            result = (output * mask).sum(1) / mask.sum(1)
        return normalise(result.cpu().numpy())

    if (WORK / "gemma-stats.json").exists():
        previous = json.loads((WORK / "gemma-stats.json").read_text())
        stats["image_batches"] = previous.get("image_batches", [])
        stats["caption_batches"] = previous.get("caption_batches", [])
        stats["resume_load_seconds"] = stats["load_seconds"]
        stats["load_seconds"] = previous.get("load_seconds", stats["load_seconds"])
    queries = []
    for query in QUERIES:
        torch.cuda.synchronize()
        start = time.perf_counter()
        queries.append(encode(text="task: search result | query: " + query["text"])[0])
        stats["query_ms"].append((time.perf_counter() - start) * 1000)
    np.save(WORK / "gemma-queries.npy", np.asarray(queries))
    for combined, filename in [
        (False, "gemma-images.npy"),
        (True, "gemma-caption-images.npy"),
    ]:
        target = WORK / filename
        checkpoint = WORK / (filename + ".partial.npz")
        if target.exists():
            print(f"Reusing {filename}", flush=True)
            continue
        results = []
        if checkpoint.exists():
            results = list(np.load(checkpoint)["vectors"])
        resume_start = len(results)
        for idx in range(resume_start, len(corpus), batch_size):
            batch = corpus[idx : idx + batch_size]

            def open_photo(photo):
                with Image.open(photo["source"]) as image:
                    return [ImageOps.exif_transpose(image).convert("RGB")]

            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                images = list(pool.map(open_photo, batch))
            text = (
                ["<|image|> title: none | text: " + item["caption"] for item in batch]
                if combined
                else None
            )
            start = time.perf_counter()
            result = encode(text=text, images=images)
            results.extend(result)
            stats["caption_batches" if combined else "image_batches"].append(
                {
                    "start": idx,
                    "count": len(batch),
                    "seconds": time.perf_counter() - start,
                }
            )
            if (idx - resume_start) % (batch_size * 10) == 0:
                np.savez(checkpoint, vectors=np.asarray(results))
                write_json(WORK / "gemma-stats.json", stats)
                print(
                    f"{'image+caption' if combined else 'image'} {len(results)}/{len(corpus)}",
                    flush=True,
                )
            del images
        np.save(target, normalise(results))
        checkpoint.unlink(missing_ok=True)
    stats["peak_gpu_bytes"] = torch.cuda.max_memory_allocated()
    write_json(WORK / "gemma-stats.json", stats)
    model = None
    gc.collect()
    torch.cuda.empty_cache()


def gguf():
    import subprocess
    import urllib.request

    stats = {}
    with contextlib.ExitStack() as stack:
        for key, name in [("unsloth-q4", "UD-Q4_K_XL"), ("unsloth-q8", "Q8_0")]:
            model = WORK / "unsloth" / f"embeddinggemma-2-{name}.gguf"
            binary = WORK / "llama/llama-b11669/llama-server"
            logfile = stack.enter_context(open(WORK / f"{key}.log", "w"))
            start = time.perf_counter()
            process = subprocess.Popen(
                [
                    str(binary),
                    "-m",
                    str(model),
                    "--embedding",
                    "--pooling",
                    "mean",
                    "-c",
                    "2048",
                    "-b",
                    "512",
                    "-ub",
                    "512",
                    "-t",
                    "4",
                    "--parallel",
                    "1",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "43135",
                ],
                stdout=logfile,
                stderr=logfile,
            )
            try:
                for attempt in range(120):
                    if process.poll() is not None:
                        raise RuntimeError(f"{key} exited: see {key}.log")
                    try:
                        with urllib.request.urlopen(
                            "http://127.0.0.1:43135/health", timeout=1
                        ) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        time.sleep(0.5)
                else:
                    raise TimeoutError(key)
                info = {
                    "load_seconds": time.perf_counter() - start,
                    "dtype": name,
                    "device": "native CPU, 4 threads",
                    "query_ms": [],
                    "file_bytes": model.stat().st_size,
                }
                results = []
                for query in QUERIES:
                    data = json.dumps(
                        {
                            "input": "task: search result | query: " + query["text"],
                            "encoding_format": "float",
                        }
                    ).encode()
                    start = time.perf_counter()
                    request = urllib.request.Request(
                        "http://127.0.0.1:43135/v1/embeddings",
                        data=data,
                        headers={"Content-Type": "application/json"},
                    )
                    with urllib.request.urlopen(request, timeout=60) as response:
                        output = json.load(response)
                    results.append(output["data"][0]["embedding"])
                    info["query_ms"].append((time.perf_counter() - start) * 1000)
                write_json(WORK / f"{key}-queries.json", normalise(results).tolist())
                stats[key] = info
            except (OSError, RuntimeError, ValueError, KeyError) as error:
                stats[key] = {"error": str(error), "log": f"{key}.log"}
                print(key, error, flush=True)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                logfile.close()
            write_json(WORK / "gguf-stats.json", stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["prepare", "baselines", "gemma", "gguf"])
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    if args.stage == "gemma":
        gemma(args.batch_size)
    else:
        globals()[args.stage]()
