from __future__ import annotations

import click
from pathlib import Path
import pprint
import fast_colorthief
import numpy as np
import exifread
import reverse_geocode
import sqlite3
import typing
from PIL import Image
from typing import IO, Mapping, Optional, Tuple
import os
import fcntl
import gc
import hashlib
import json
import re
import math
import struct
import tempfile
import statistics
import random
import subprocess
import shutil
import threading
from contextlib import contextmanager

try:
    import torch
    from transformers import (
        AutoImageProcessor,
        AutoModel,
        AutoModelForCausalLM,
        AutoProcessor,
    )
except ModuleNotFoundError as model_runtime_error:
    _MODEL_RUNTIME_ERROR = model_runtime_error

    class _UnavailableCuda:
        @staticmethod
        def is_available() -> bool:
            return False

        @staticmethod
        def memory_allocated() -> int:
            return 0

        @staticmethod
        def memory_reserved() -> int:
            return 0

        @staticmethod
        def mem_get_info() -> tuple[int, int]:
            return (0, 0)

        @staticmethod
        def max_memory_allocated() -> int:
            return 0

        @staticmethod
        def max_memory_reserved() -> int:
            return 0

        @staticmethod
        def empty_cache() -> None:
            return None

        @staticmethod
        def reset_peak_memory_stats() -> None:
            return None

        @staticmethod
        def get_device_name(_device: int) -> str:
            raise RuntimeError("CUDA requires the indexer's inference dependencies")

        @staticmethod
        def get_device_properties(_device: int):
            raise RuntimeError("CUDA requires the indexer's inference dependencies")

    class _UnavailableTorch:
        cuda = _UnavailableCuda()

        @staticmethod
        def inference_mode():
            return lambda function: function

        def __getattr__(self, _name: str):
            raise RuntimeError(
                "Model inference dependencies are not installed. "
                "Run `uv sync --extra inference`."
            ) from _MODEL_RUNTIME_ERROR

    class _UnavailableModelFactory:
        @classmethod
        def from_pretrained(cls, *_args, **_kwargs):
            raise RuntimeError(
                "Model inference dependencies are not installed. "
                "Run `uv sync --extra inference`."
            ) from _MODEL_RUNTIME_ERROR

    torch = _UnavailableTorch()
    AutoImageProcessor = _UnavailableModelFactory
    AutoModel = _UnavailableModelFactory
    AutoModelForCausalLM = _UnavailableModelFactory
    AutoProcessor = _UnavailableModelFactory

import concurrent.futures
import time
from datetime import datetime


def log(message: str) -> None:
    """Print an indexing progress line prefixed with an ISO 8601 local-tz timestamp."""
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"[{stamp}] {message}", flush=True)


def acquire_single_instance_lock(dbpath: str, global_lock: bool = False) -> int:
    """Take an advisory lock so two index runs cannot share one GPU or DB file.

    Two concurrent runs against the same database would contend for GPU VRAM
    (deadlocking mid-batch once the card fills up) and write the same SQLite
    file at once. Mutation commands use a database-specific lock; inference uses
    one process-wide indexer lock. The OS releases either automatically on exit —
    including crash or ``kill -9`` — so there is no stale lock to clean up the
    way a PID file would leave behind.

    Returns the held file descriptor (kept open intentionally). Raises
    ``click.ClickException`` if another run already holds the lock.
    """
    lock_path = (
        os.path.join(
            tempfile.gettempdir(),
            "photo-gallery-indexer-"
            f"{hashlib.sha256(os.path.abspath(__file__).encode()).hexdigest()[:12]}.lock",
        )
        if global_lock
        else f"{dbpath}.lock"
    )
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        try:
            holder = os.pread(fd, 64, 0).decode(errors="replace").strip()
        except OSError:
            holder = ""
        os.close(fd)
        raise click.ClickException(
            f"Another index run is already using {dbpath} (PID {holder or 'unknown'}). "
            "Two runs would contend for the GPU and write the same SQLite file. "
            "Wait for it to finish or kill it, then retry."
        )
    os.ftruncate(fd, 0)
    os.write(fd, str(os.getpid()).encode())
    return fd


def log_gpu_status() -> None:
    """Log GPU name and free/total VRAM, warning if too little is free.

    A run that is about to OOM or stall on a full card looks identical to a
    healthy one until it hangs — surfacing free VRAM up front makes the cause
    visible (e.g. another process, or a leaked CUDA context, holding memory)."""
    if not torch.cuda.is_available():
        log("CUDA not available — running on CPU")
        return
    free, total = torch.cuda.mem_get_info()
    log(
        f"GPU: {torch.cuda.get_device_name(0)} — "
        f"{(total - free) / 1e9:.1f}/{total / 1e9:.1f} GB used, {free / 1e9:.1f} GB free"
    )
    if free < 2e9:
        log(
            "WARNING: under 2 GB GPU free — model loading may OOM or stall. "
            "Check for another process holding VRAM (nvidia-smi)."
        )


def log_vram(label: str) -> None:
    """Log GPU memory after a step: what this run holds vs how full the card is.

    ``allocated`` is live tensors, ``reserved`` is the caching allocator's total
    hold; ``used/total card-wide`` is the figure that decides whether we tip over
    into slow shared system memory on WSL2 (the driver spills instead of OOMing).
    Use after each model load and inference phase to see where VRAM actually goes."""
    if not torch.cuda.is_available():
        return
    allocated = torch.cuda.memory_allocated() / 1e9
    reserved = torch.cuda.memory_reserved() / 1e9
    free, total = torch.cuda.mem_get_info()
    log(
        f"  VRAM after {label}: {allocated:.2f} GB tensors / {reserved:.2f} GB reserved "
        f"(this run) · {(total - free) / 1e9:.2f}/{total / 1e9:.2f} GB used card-wide, "
        f"{free / 1e9:.2f} GB free"
    )


def log_vram_peak() -> None:
    """Report the high-water mark of this run's GPU allocation across all phases.

    The peak is what determines spill, not the steady-state — a batch's transient
    activations can briefly dwarf the resident model weights."""
    if not torch.cuda.is_available():
        return
    log(
        f"Peak VRAM this run: {torch.cuda.max_memory_allocated() / 1e9:.2f} GB tensors / "
        f"{torch.cuda.max_memory_reserved() / 1e9:.2f} GB reserved"
    )


@contextmanager
def heartbeat(label: str, interval_s: float = 15.0):
    """Emit a periodic "still running" line while a long, silent call runs.

    A single GPU ``generate()`` can run for many seconds with no output, which
    is indistinguishable from a hang to someone watching the terminal. A moving
    elapsed counter means it's alive; a frozen one means investigate."""
    stop = threading.Event()
    started = time.perf_counter()

    def _beat() -> None:
        while not stop.wait(interval_s):
            elapsed = time.perf_counter() - started
            log(f"  {label} still running… {elapsed:.0f}s elapsed")

    thread = threading.Thread(target=_beat, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1.0)


def is_cuda_oom(error: BaseException) -> bool:
    oom_type = getattr(torch, "OutOfMemoryError", None)
    if oom_type is not None and isinstance(error, oom_type):
        return True
    return "out of memory" in str(error).lower() and "cuda" in str(error).lower()


def predict_caption_batch_resilient(
    classifier: "BaseCaptionClassifier",
    items: list[tuple[str, Optional[Mapping]]],
) -> tuple[list[str], list[dict[str, typing.Any]]]:
    """Run a caption batch, recursively bisecting it after a CUDA OOM."""
    try:
        results = classifier.predict_batch(items)
        metrics = list(getattr(classifier, "last_generation_metrics", []))
        if len(metrics) < len(results):
            metrics.extend({} for _ in range(len(results) - len(metrics)))
        return results, metrics[: len(results)]
    except BaseException as err:
        if not is_cuda_oom(err) or len(items) <= 1:
            raise
        split = len(items) // 2
        log(
            f"WARNING: CUDA OOM for caption batch of {len(items)}; "
            f"retrying as {split} + {len(items) - split}"
        )
        gc.collect()
        torch.cuda.empty_cache()
        left_results, left_metrics = predict_caption_batch_resilient(
            classifier, items[:split]
        )
        right_results, right_metrics = predict_caption_batch_resilient(
            classifier, items[split:]
        )
        for metric in [*left_metrics, *right_metrics]:
            metric["oomFallback"] = True
        return left_results + right_results, left_metrics + right_metrics


def cache_tokenizer_vocab(tokenizer: typing.Any) -> None:
    """Resolve the tokenizer's vocabulary once instead of on every lookup.

    VLChatProcessor exposes ``image_id``/``image_start_id``/``image_end_id`` as
    properties that read ``tokenizer.vocab``, and transformers rebuilds the whole
    ~100k-entry dict on every access. Profiling the processor showed
    ``get_vocab`` at ~200ms a call, six calls per image: ~1.2s of the ~1.9s spent
    preparing each caption, dwarfing the bicubic resize that looks like the
    obvious cost. The vocabulary is fixed once the tokenizer is loaded, so this
    returns the same dict and the same token ids — captions are unchanged,
    verified byte-identical across a 16-photo sample.
    """
    cached_vocab = tokenizer.get_vocab()
    tokenizer.get_vocab = lambda *_args, **_kwargs: cached_vocab


def effective_free_vram_gb() -> float:
    """VRAM the next batch can actually draw on.

    Device-free alone is the wrong signal. The caching allocator reserves memory
    and reuses it across batches without returning it, so a perfectly healthy run
    settles at roughly zero device-free while allocating nothing new. Measured
    over ten identical Janus batches: device-free fell 5.1 GB to zero while live
    tensors stayed flat at 4.84 GB, reserved plateaued, and batch time did not
    move. Aborting on device-free stopped runs that were fine, which is why a
    294-batch job never finished and looked like a leak.

    Adding the allocator's reusable cache tells that apart from the case the
    guard is actually for: a card oversubscribed by another process, where torch
    cannot reserve and WSL2's WDDM silently spills to host RAM — batches went
    from ~3s to ~22s — instead of raising OutOfMemoryError.
    """
    free, _total = torch.cuda.mem_get_info()
    reusable = torch.cuda.memory_reserved() - torch.cuda.memory_allocated()
    return (free + reusable) / 1e9


def enforce_vram_headroom(label: str) -> float:
    """Warn on low post-batch headroom and stop before the card is exhausted."""
    if not torch.cuda.is_available():
        return math.inf
    free_gb = effective_free_vram_gb()
    if free_gb < JANUS_WARN_FREE_VRAM_GB and not getattr(
        enforce_vram_headroom, "_warning_emitted", False
    ):
        log(f"WARNING: only {free_gb:.2f} GB VRAM free after {label}")
        enforce_vram_headroom._warning_emitted = True
    if free_gb < JANUS_MIN_FREE_VRAM_GB:
        # Hand the allocator's cache back so another process on the card can use
        # it. This does not change the verdict — the same bytes simply move from
        # reusable to device-free — but it is the neighbourly thing to do before
        # giving up, and it lets the retry land in a cleaner state.
        torch.cuda.empty_cache()
        free_gb = effective_free_vram_gb()
        if free_gb < JANUS_MIN_FREE_VRAM_GB:
            raise click.ClickException(
                f"Only {free_gb:.2f} GB VRAM remains after {label}; "
                "stopping with completed batches preserved"
            )
    return free_gb


MODEL_PROFILE_JANUS = "janus"
MODEL_PROFILE_SIGLIP2 = "siglip2"
MODEL_PROFILE_HYBRID = "hybrid"
CLASSIFIER_BACKEND_JANUS = "janus"
CLASSIFIER_BACKEND_GEMMA4 = "gemma4"
CLASSIFIER_BACKEND_GEMMA4_GGUF = "gemma4-gguf"
DEFAULT_GEMMA4_MODEL_ID = "google/gemma-4-E2B-it"
DEFAULT_GEMMA4_QUANTIZATION = None
DEFAULT_GEMMA4_BATCH_SIZE = 1
DEFAULT_GEMMA4_LOW_IMPACT_HEADROOM_GB = 3.0
DEFAULT_GEMMA4_CPU_MAX_MEMORY = "24GiB"
DEFAULT_GEMMA4_GGUF_MODEL_ID = "unsloth/gemma-4-E4B-it-GGUF:Q8_0"
DEFAULT_GEMMA4_GGUF_BATCH_SIZE = 1
DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS = 256
DEFAULT_GEMMA4_GGUF_IMAGE_MIN_TOKENS = 70
DEFAULT_GEMMA4_GGUF_IMAGE_MAX_TOKENS = 140
DEFAULT_GEMMA4_GGUF_THREADS = 8
DEFAULT_GEMMA4_GGUF_CTX_SIZE = 32768
JANUS_RESPONSE_FIELDS = (
    "tags",
    "alt_text",
)
JANUS_MAX_NEW_TOKENS = 192
JANUS_BATCH_MAX_NEW_TOKENS = 128
JANUS_BATCH_SIZE = 4
JANUS_MAX_PRODUCTION_BATCH_SIZE = 4
JANUS_MAX_GENERATION_SECONDS = 120.0
JANUS_WARN_FREE_VRAM_GB = 0.75
JANUS_MIN_FREE_VRAM_GB = 0.25
MAX_CLASSIFIER_TAGS = 10
MAX_CLASSIFIER_TAG_WORDS = 4
MAX_CLASSIFIER_TAG_LENGTH = 60
MAX_CLASSIFIER_ALT_TEXT_WORDS = 35
MAX_CLASSIFIER_ALT_TEXT_LENGTH = 320
JANUS_IMAGE_DECODE_WORKERS = 4
GEMMA4_MAX_NEW_TOKENS = 192
EMBEDDER_BATCH_SIZE = 16
COLORTHIEF_WORKERS = 4
# Comparison-tooling defaults only; the published palette is full-resolution.
COLOUR_THUMBNAIL_MAX_DIMENSION = 512
COLOUR_THUMBNAIL_QUALITY = 10
FILE_HASH_WORKERS = 8
INSERT_CHUNK_SIZE = 64
CORE_STAGE = "core"
CAPTION_STAGE = "caption"
SIGLIP_V1_STAGE = "embedding:siglip-v1"
SIGLIP_V2_STAGE = "embedding:siglip-v2"
# Unchanged from v1 on purpose: the published core output (EXIF fields, geocode,
# full-resolution palette) is byte-identical to what v1 produced, verified across
# real photos. `details=False` only drops MakerNote/thumbnail tags that were never
# retained. Bumping this would force a needless recompute of every existing row.
CORE_PIPELINE_VERSION = "core-exif-geocode-colour-v1"
CAPTION_PROMPT_VERSION = "caption-search-json-v2"
JANUS_MODEL_ID = "deepseek-ai/Janus-Pro-1B"
JANUS_MODEL_REVISION = "960ab33191f61342a4c60ae74d8dc356a39fafcb"
SIGLIP_V1_MODEL_REVISION = "7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed"
SIGLIP_V2_MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
IMAGE_TAGS_MIGRATION = "image-tags-v1"
IMAGES_SCHEMA_MIGRATION = "images-schema-v2"
STRUCTURED_GEOCODE_MIGRATION = "structured-geocode-v1"
EXIF_SEARCH_FIELDS = (
    "Image Make",
    "Image Model",
    "EXIF LensMake",
    "EXIF LensModel",
    "EXIF LensSpecification",
    "EXIF FocalLength",
    "EXIF FocalLengthIn35mmFilm",
    "EXIF FNumber",
    "EXIF ExposureTime",
    "EXIF ISOSpeedRatings",
    "EXIF DateTimeOriginal",
    "EXIF OffsetTime",
    "GPS GPSLatitude",
    "GPS GPSLatitudeRef",
    "GPS GPSLongitude",
    "GPS GPSLongitudeRef",
)
JANUS_FALLBACK_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "its",
    "near",
    "of",
    "on",
    "or",
    "photo",
    "shows",
    "taken",
    "that",
    "the",
    "their",
    "there",
    "this",
    "to",
    "was",
    "with",
}


def build_classifier_prompt(_geocode: Optional[Mapping]) -> str:
    schema = '{ "tags": string[], "alt_text": string }'

    return (
        "Return strict JSON only. "
        "Describe the photo for search indexing using this schema: "
        f"{schema}."
        f" Use at most {MAX_CLASSIFIER_TAGS} unique tags; each must be a concrete "
        "one-to-four-word phrase. Put the primary subject first, then include other "
        "visible objects and useful visual themes."
        f" Write alt_text as one factual sentence of at most "
        f"{MAX_CLASSIFIER_ALT_TEXT_WORDS} words."
        " Do not return prose outside the JSON object."
    )


def build_janus_prompt(geocode: Optional[Mapping]) -> str:
    return f"<image_placeholder>{build_classifier_prompt(geocode)}"


def keywordise_text(text: str, limit: int = 6) -> list[str]:
    keywords = []
    for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", text.lower()):
        if len(word) < 4 or word in JANUS_FALLBACK_STOPWORDS:
            continue
        normalised = word.replace("-", "_")
        if normalised in keywords:
            continue
        keywords.append(normalised)
        if len(keywords) >= limit:
            break
    return keywords


def _coerce_str(value: typing.Any) -> str:
    """Coerce a VLM field to a plain string; non-coercible values become ""."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def _coerce_str_list(value: typing.Any) -> list[str]:
    """Coerce a VLM list field to a list of strings.

    ``null`` → ``[]``; a bare string → ``[string]``; list members are coerced to
    ``str`` and non-coercible members (nested lists/dicts/None) are dropped."""
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    coerced = []
    for item in value:
        if isinstance(item, str):
            coerced.append(item)
        elif isinstance(item, (int, float, bool)):
            coerced.append(str(item))
        # drop anything non-coercible (nested lists/dicts/None)
    return coerced


def normalise_classifier_tags(result: Mapping[str, typing.Any]) -> list[str]:
    resolved = []
    legacy_tags = list(result.get("identified_objects") or []) + list(
        result.get("themes") or []
    )
    for tag in list(result.get("tags") or legacy_tags):
        normalised = "_".join(tag.strip().lower().split())
        if normalised and normalised not in resolved:
            resolved.append(normalised)
    return resolved


def repair_classifier_json_syntax(value: str) -> str:
    """Repair only two observed, unambiguous Janus JSON punctuation errors."""
    repaired = re.sub(r",\s*([}\]])", r"\1", value)
    repaired = re.sub(r"\]\s*(\"alt_text\"\s*:)", r"], \1", repaired, flags=re.DOTALL)
    repaired = re.sub(
        r"(\"(?:\\.|[^\"\\])*\")\s*(\"tags\"\s*:)",
        r"\1, \2",
        repaired,
        flags=re.DOTALL,
    )
    return repaired


def parse_classifier_response(raw_result: str) -> Mapping[str, typing.Any]:
    JSON_BLOCK_PATTERN = re.compile(r"\{.*?\}", re.DOTALL | re.MULTILINE)
    blocks = JSON_BLOCK_PATTERN.findall(raw_result)

    if len(blocks) > 0:
        result = None
        last_error = None
        for block in reversed(blocks):
            try:
                result = json.loads(block)
                break
            except json.JSONDecodeError as err:
                last_error = err
                repaired = repair_classifier_json_syntax(block)
                if repaired != block:
                    try:
                        result = json.loads(repaired)
                        break
                    except json.JSONDecodeError as repaired_err:
                        last_error = repaired_err
        if result is None:
            raise last_error or ValueError("No valid JSON block found")
    else:
        cleaned = " ".join(raw_result.split()).strip()
        if not cleaned:
            raise ValueError("Empty Janus response")
        sentence_match = re.match(r"(.+?[.!?])(?:\s|$)", cleaned)
        if sentence_match is None:
            raise ValueError("Plain-text classifier response had no complete sentence")
        alt_text = sentence_match.group(1)[:MAX_CLASSIFIER_ALT_TEXT_LENGTH]
        keywords = keywordise_text(alt_text)
        result = {
            "tags": keywords,
            "alt_text": alt_text,
        }

    if not isinstance(result, dict):
        raise ValueError("Janus response was not an object")
    # A JSON block missing a required key is treated as malformed so the caller
    # (parse_caption_with_retry) can re-run the model rather than silently writing
    # an empty caption. Present-but-wrong-typed values are coerced below so a
    # bad-but-valid response (null lists, numeric alt_text, …) can never crash the
    # batch insert downstream.
    if "alt_text" not in result:
        raise KeyError("alt_text")
    if "tags" in result:
        tags = _coerce_str_list(result.get("tags"))
    elif "identified_objects" in result and "themes" in result:
        # Read old comparison artifacts during the schema transition, but always
        # return the new two-field contract to downstream code.
        tags = _coerce_str_list(result.get("identified_objects")) + _coerce_str_list(
            result.get("themes")
        )
    else:
        raise KeyError("tags")
    unique_tags = []
    seen_tags = set()
    for tag in tags:
        key = tag.strip().casefold()
        if key and key not in seen_tags:
            seen_tags.add(key)
            unique_tags.append(tag)
    result = {
        "tags": unique_tags,
        "alt_text": _coerce_str(result.get("alt_text")),
    }
    if not result["tags"] and not result["alt_text"].strip():
        raise ValueError("Classifier response contained no usable caption fields")
    if len(result["tags"]) > MAX_CLASSIFIER_TAGS:
        raise ValueError("Classifier response contained too many tags")
    if any(
        len(tag) > MAX_CLASSIFIER_TAG_LENGTH
        or len(re.findall(r"\b[\w'-]+\b", tag)) > MAX_CLASSIFIER_TAG_WORDS
        for tag in result["tags"]
    ):
        raise ValueError("Classifier response contained an overlong tag")
    if (
        len(result["alt_text"]) > MAX_CLASSIFIER_ALT_TEXT_LENGTH
        or len(re.findall(r"\b[\w'-]+\b", result["alt_text"]))
        > MAX_CLASSIFIER_ALT_TEXT_WORDS
    ):
        raise ValueError("Classifier response contained overlong alt text")
    control_markers = ("<|channel>", "<channel|>", "<image_placeholder>")
    if any(
        marker in value
        for marker in control_markers
        for value in [*result["tags"], result["alt_text"]]
    ):
        raise ValueError("Classifier response leaked a control token")
    return result


def parse_janus_response(raw_result: str) -> Mapping[str, typing.Any]:
    return parse_classifier_response(raw_result)


def parse_caption_with_retry(
    classifier: "BaseCaptionClassifier",
    path: str,
    geocode: Optional[Mapping],
    raw_caption: str,
    max_attempts: int = 2,
) -> Optional[Mapping[str, typing.Any]]:
    """Parse a batched Janus caption, re-running the live model on parse failure.

    Janus occasionally emits malformed JSON. Generation is deterministic
    (``do_sample=False``), so re-running the model on the same image yields a
    byte-identical caption — there is no point retrying more than once. We cap at
    ``max_attempts=2``: attempt 1 re-parses the batched ``raw_caption``, attempt 2
    runs a single-image ``classifier.predict`` (which can differ from the batched
    decode because batching/padding changes the numerics). This must run while the
    classifier is still loaded — the one-model-per-pass design releases it before
    per-image assembly — so it lives here in the Janus pass rather than in
    analyse_image. Returns the parsed result dict, or ``None`` once attempts are
    exhausted."""
    raw_result = raw_caption
    for attempt in range(max_attempts):
        try:
            return parse_classifier_response(raw_result)
        except Exception:
            log(
                f"Caption parse attempt {attempt + 1}/{max_attempts} failed for {path}, got {raw_result}"
            )
            if attempt + 1 >= max_attempts:
                log(
                    f"Failed to classify {path} after {max_attempts} attempts, skipping."
                )
                return None
            raw_result = classifier.predict(path=path, geocode=geocode)
    return None


def resolve_caption_result(
    classifier: "BaseCaptionClassifier",
    path: str,
    geocode: Optional[Mapping],
    raw_caption: str,
    generation_metric: Mapping[str, typing.Any],
    metric_sink: Optional[list[dict[str, typing.Any]]] = None,
) -> Optional[Mapping[str, typing.Any]]:
    """Accept a completed batch result or retry one non-EOS straggler singly."""
    if (
        generation_metric.get("completedWithEos") is not False
        or generation_metric.get("completedWithJson")
        or generation_metric.get("completedWithSchema")
    ):
        caption_to_parse = raw_caption
        if generation_metric.get("completedWithSchema") and not generation_metric.get(
            "completedWithJson"
        ):
            caption_to_parse = (
                complete_classifier_json_prefix(raw_caption) or raw_caption
            )
        try:
            parsed = parse_classifier_response(caption_to_parse)
            if isinstance(generation_metric, dict):
                generation_metric["parseSuccess"] = True
            return parsed
        except (ValueError, KeyError, json.JSONDecodeError) as err:
            if isinstance(generation_metric, dict):
                generation_metric["parseSuccess"] = False
            log(f"Caption JSON was malformed for {path}: {err}; retrying singly")
    else:
        if isinstance(generation_metric, dict):
            generation_metric["parseSuccess"] = False
        log(f"Caption generation did not reach EOS for {path}; retrying singly")

    with heartbeat(f"single caption retry for {os.path.basename(path)}"):
        retry_raw = classifier.predict(path=path, geocode=geocode)
    retry_metric = (
        dict(classifier.last_generation_metrics[0])
        if classifier.last_generation_metrics
        else {}
    )
    retry_metric["singleRetry"] = True
    if metric_sink is not None:
        metric_sink.append(retry_metric)
    if retry_metric.get("completedWithEos") is False:
        retry_metric["parseSuccess"] = False
        log(
            f"Single-image caption retry also failed to reach EOS for {path}; "
            "leaving it incomplete"
        )
        return None
    try:
        parsed = parse_classifier_response(retry_raw)
        retry_metric["parseSuccess"] = True
        return parsed
    except (ValueError, KeyError, json.JSONDecodeError) as err:
        retry_metric["parseSuccess"] = False
        log(
            f"Single-image caption retry remained malformed for {path}: {err}; "
            "leaving it incomplete"
        )
        return None


def complete_json_object_end(value: str) -> Optional[int]:
    """Return the end offset of the first complete top-level JSON object.

    This deliberately only recognises balanced object syntax; semantic validation
    remains the parser's job. Braces inside strings and escaped quotes do not end
    generation early.
    """
    start = value.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for position, character in enumerate(value[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return position + 1
            if depth < 0:
                return None
    return None


def complete_classifier_json_prefix(value: str) -> Optional[str]:
    """Repair only a schema-complete top-level object missing its final brace.

    Janus occasionally starts repeating fields after producing all four valid
    values. Appending one brace to the current prefix is safe only when the result
    is valid JSON and passes the full bounded classifier response contract.
    """
    start = value.find("{")
    if start < 0:
        return None
    candidate = value[start:].rstrip()
    if candidate.endswith(","):
        candidate = candidate[:-1].rstrip()
    candidate += "}"
    try:
        parse_classifier_response(candidate)
    except (ValueError, KeyError, json.JSONDecodeError):
        pass
    else:
        return candidate

    # Janus can loop inside the final tags array. Because alt_text is generated
    # first, salvage only after observing at least four distinct tags and then a
    # duplicate — evidence of the measured repetition failure, not ordinary
    # in-progress generation. json.loads decodes quoted strings safely.
    alt_match = re.search(r'"alt_text"\s*:\s*("(?:\\.|[^"\\])*")', value, re.DOTALL)
    tags_match = re.search(r'"tags"\s*:\s*\[(.*)$', value, re.DOTALL)
    if not alt_match or not tags_match:
        return None
    if "]" in tags_match.group(1):
        return None
    try:
        alt_text = json.loads(alt_match.group(1))
        emitted_tags = [
            json.loads(match.group(0))
            for match in re.finditer(r'"(?:\\.|[^"\\])*"', tags_match.group(1))
        ]
    except (TypeError, json.JSONDecodeError):
        return None
    unique_tags = []
    seen = set()
    for tag in emitted_tags:
        key = tag.strip().casefold()
        if key and key not in seen:
            seen.add(key)
            unique_tags.append(tag)
    repeated = len(emitted_tags) > len(unique_tags)
    if not repeated or len(unique_tags) < 4:
        return None
    repaired = json.dumps(
        {"alt_text": alt_text, "tags": unique_tags[:MAX_CLASSIFIER_TAGS]}
    )
    try:
        parse_classifier_response(repaired)
    except (ValueError, KeyError, json.JSONDecodeError):
        return None
    return repaired


def has_repeated_open_classifier_tags(value: str) -> bool:
    """Detect the measured Janus loop inside an as-yet-unclosed tags array."""
    tags_match = re.search(r'"tags"\s*:\s*\[(.*)$', value, re.DOTALL)
    if not tags_match or "]" in tags_match.group(1):
        return False
    try:
        emitted_tags = [
            json.loads(match.group(0))
            for match in re.finditer(r'"(?:\\.|[^"\\])*"', tags_match.group(1))
        ]
    except json.JSONDecodeError:
        return False
    unique = {tag.strip().casefold() for tag in emitted_tags if tag.strip()}
    return len(unique) >= 4 and len(emitted_tags) > len(unique)


class JsonCompletionLogitsProcessor:
    """Force EOS independently for rows whose top-level JSON is complete."""

    def __init__(self, tokenizer, eos_token_id: int) -> None:
        self.tokenizer = tokenizer
        self.eos_token_id = eos_token_id
        try:
            closing_ids = tokenizer.encode("]", add_special_tokens=False)
        except (AttributeError, TypeError):
            closing_ids = []
        self.closing_bracket_token_id = (
            closing_ids[0]
            if isinstance(closing_ids, list) and len(closing_ids) == 1
            else None
        )

    def __call__(self, input_ids, scores):
        for row_index, row in enumerate(input_ids):
            text = self.tokenizer.decode(row.detach().cpu().tolist())
            if complete_json_object_end(
                text
            ) is not None or complete_classifier_json_prefix(text):
                scores[row_index].fill_(float("-inf"))
                scores[row_index, self.eos_token_id] = 0.0
            elif (
                self.closing_bracket_token_id is not None
                and has_repeated_open_classifier_tags(text)
            ):
                scores[row_index].fill_(float("-inf"))
                scores[row_index, self.closing_bracket_token_id] = 0.0
        return scores


def filter_exif_for_search(
    exif: Optional[Mapping[str, typing.Any]],
) -> Mapping[str, typing.Any]:
    if not exif or not hasattr(exif, "get"):
        return {}

    filtered = {}
    for field in EXIF_SEARCH_FIELDS:
        value = exif.get(field)
        if value is None:
            continue
        resolved = str(value).strip()
        if resolved == "":
            continue
        filtered[field] = value
    return filtered


class BaseCaptionClassifier:
    backend = "base"
    batch_size = 1

    def __init__(self) -> None:
        self.last_generation_metrics: list[dict[str, typing.Any]] = []

    def init_model(self) -> None:
        raise NotImplementedError

    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        raise NotImplementedError

    def predict_batch(self, items: list[tuple[str, Optional[Mapping]]]) -> list[str]:
        return [self.predict(path, geocode) for path, geocode in items]

    def release(self) -> None:
        """Free GPU memory held by this model so the next pass can load alone.

        Drops every attribute a subclass might have put weights in, then forces a
        GC pass (nn.Module graphs are reference cycles) and empties the CUDA cache.
        Idempotent and safe on a never-initialised or CPU-only (GGUF) instance."""
        for attr in (
            "vl_gpt",
            "model",
            "vl_chat_processor",
            "processor",
            "tokenizer",
            "_load_pil_images",
        ):
            if hasattr(self, attr):
                setattr(self, attr, None)
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


class JanusClassifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_JANUS
    batch_size = JANUS_BATCH_SIZE

    def __init__(
        self,
        batch_size: int = JANUS_BATCH_SIZE,
        max_new_tokens: int = JANUS_MAX_NEW_TOKENS,
        batch_max_new_tokens: int = JANUS_BATCH_MAX_NEW_TOKENS,
        max_generation_seconds: float = JANUS_MAX_GENERATION_SECONDS,
    ) -> None:
        super().__init__()
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.batch_max_new_tokens = min(batch_max_new_tokens, max_new_tokens)
        self.max_generation_seconds = max_generation_seconds
        self._decode_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=JANUS_IMAGE_DECODE_WORKERS
        )

    def _record_generation_metrics(
        self,
        outputs,
        max_new_tokens: Optional[int] = None,
        per_item_metrics: Optional[list[Mapping[str, typing.Any]]] = None,
    ) -> None:
        token_limit = max_new_tokens or self.max_new_tokens
        eos_token_id = self.tokenizer.eos_token_id
        self.last_generation_metrics = []
        for position, output in enumerate(outputs):
            tokens = output.detach().cpu().tolist()
            decoded = self.tokenizer.decode(tokens, skip_special_tokens=True)
            completed_with_json = complete_json_object_end(decoded) is not None
            completed_with_schema = (
                completed_with_json
                or complete_classifier_json_prefix(decoded) is not None
            )
            try:
                token_count = tokens.index(eos_token_id) + 1
                completed_with_eos = True
            except ValueError:
                token_count = len(tokens)
                completed_with_eos = False
            metric = {
                "tokenCount": token_count,
                "completedWithEos": completed_with_eos,
                "completedWithJson": completed_with_json,
                "completedWithSchema": completed_with_schema,
                "hitTokenLimit": token_count >= token_limit and not completed_with_eos,
            }
            if per_item_metrics and position < len(per_item_metrics):
                metric.update(per_item_metrics[position])
            self.last_generation_metrics.append(metric)

    @staticmethod
    def _conversation(path: str, geocode: Optional[Mapping]):
        return [
            {
                "role": "User",
                "content": build_janus_prompt(geocode),
                "images": [path],
            },
            {"role": "Assistant", "content": ""},
        ]

    @staticmethod
    def _decode_image(path: str) -> Image.Image:
        with Image.open(path) as image:
            return image.convert("RGB")

    def _decode_images_parallel(
        self, paths: list[str]
    ) -> tuple[list[Image.Image], float]:
        started_at = time.perf_counter()
        if len(paths) == 1:
            images = [self._decode_image(paths[0])]
        else:
            images = list(self._decode_executor.map(self._decode_image, paths))
        return images, (time.perf_counter() - started_at) * 1000

    def release(self) -> None:
        executor = getattr(self, "_decode_executor", None)
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
            self._decode_executor = None
        super().release()

    def _generation_kwargs(self, max_new_tokens: int):
        return {
            "pad_token_id": self.tokenizer.eos_token_id,
            "bos_token_id": self.tokenizer.bos_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
            "max_new_tokens": max_new_tokens,
            "max_time": self.max_generation_seconds,
            "do_sample": False,
            "use_cache": True,
            "logits_processor": [
                JsonCompletionLogitsProcessor(
                    self.tokenizer, self.tokenizer.eos_token_id
                )
            ],
        }

    def _import_janus_modules(self):
        # Janus currently expects pre-Transformers-5 PretrainedConfig subclass behaviour.
        # The temporary shim keeps Janus importable while the rest of the process uses the
        # newer Gemma-capable transformers build.
        from transformers import PretrainedConfig

        original_init_subclass = PretrainedConfig.__init_subclass__

        def compat_init_subclass(cls, **kwargs):
            return super(PretrainedConfig, cls).__init_subclass__(**kwargs)

        PretrainedConfig.__init_subclass__ = classmethod(compat_init_subclass)
        try:
            from janus.models import MultiModalityCausalLM, VLChatProcessor
            from janus.utils.io import load_pil_images
        finally:
            PretrainedConfig.__init_subclass__ = original_init_subclass

        return MultiModalityCausalLM, VLChatProcessor, load_pil_images

    def init_model(self) -> None:
        if not torch.cuda.is_available():
            raise RuntimeError("Janus indexing requires a CUDA-capable GPU")
        log("Loading Janus-Pro-1B...")
        # use 1B for speed/lower requirements
        model_path = JANUS_MODEL_ID
        MultiModalityCausalLM, VLChatProcessor, load_pil_images = (
            self._import_janus_modules()
        )
        self._load_pil_images = load_pil_images
        self.vl_chat_processor = VLChatProcessor.from_pretrained(
            model_path, revision=JANUS_MODEL_REVISION
        )
        self.tokenizer = self.vl_chat_processor.tokenizer

        cache_tokenizer_vocab(self.tokenizer)

        vl_gpt = AutoModelForCausalLM.from_pretrained(
            model_path, revision=JANUS_MODEL_REVISION, trust_remote_code=True
        )
        self.vl_gpt = vl_gpt.to(torch.bfloat16).cuda().eval()
        log("Loaded Janus-Pro-1B.")

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        conversation = self._conversation(path, geocode)
        pil_images, decode_ms = self._decode_images_parallel([path])
        processor_started_at = time.perf_counter()
        prepare_inputs = self.vl_chat_processor(
            conversations=conversation, images=pil_images, force_batchify=True
        ).to(self.vl_gpt.device)
        processor_ms = (time.perf_counter() - processor_started_at) * 1000
        vision_started_at = time.perf_counter()
        inputs_embeds = self.vl_gpt.prepare_inputs_embeds(**prepare_inputs)
        vision_ms = (time.perf_counter() - vision_started_at) * 1000
        generate_started_at = time.perf_counter()
        outputs = self.vl_gpt.language_model.generate(
            inputs_embeds=inputs_embeds,
            attention_mask=prepare_inputs.attention_mask,
            **self._generation_kwargs(self.max_new_tokens),
        )
        generate_ms = (time.perf_counter() - generate_started_at) * 1000

        answer = self.tokenizer.decode(
            outputs[0].cpu().tolist(), skip_special_tokens=True
        )
        self._record_generation_metrics(
            outputs,
            self.max_new_tokens,
            [
                {
                    "attempt": "single",
                    "batchSize": 1,
                    "maxNewTokens": self.max_new_tokens,
                    "decodeMs": round(decode_ms, 2),
                    "processorMs": round(processor_ms, 2),
                    "visionPreparationMs": round(vision_ms, 2),
                    "generateBatchMs": round(generate_ms, 2),
                }
            ],
        )
        return answer

    def _prepare_inputs_cpu(
        self, item: tuple[str, Optional[Mapping]]
    ) -> tuple[typing.Any, float, float]:
        """The CPU half of preparation: decode, resize, normalise, tokenise.

        Split out so it can run on a worker thread. PIL, torchvision and numpy
        all release the GIL, so this parallelises: measured over 16 real photos,
        decode+resize goes from 457 ms/image serially to 148 at 4 workers and 110
        at 16 (32 is slower again — those libraries thread internally and
        oversubscribe the cores).

        The GPU half deliberately stays on the calling thread: the host copy and
        the vision tower touch the CUDA context from one place, and the embeds
        keep item order.
        """
        path, geocode = item
        decode_started_at = time.perf_counter()
        with Image.open(path) as image:
            pil_image = image.convert("RGB")
        decode_ms = (time.perf_counter() - decode_started_at) * 1000
        processor_started_at = time.perf_counter()
        prepare_inputs = self.vl_chat_processor(
            conversations=self._conversation(path, geocode),
            images=[pil_image],
            force_batchify=True,
        )
        processor_ms = (time.perf_counter() - processor_started_at) * 1000
        return prepare_inputs, decode_ms, processor_ms

    @torch.inference_mode()
    def predict_batch(self, items: list[tuple[str, Optional[Mapping]]]) -> list[str]:
        """Run Janus inference on a batch of images in one GPU forward pass."""
        if not items:
            return []
        if len(items) == 1:
            return [self.predict(items[0][0], items[0][1])]

        all_embeds = []
        all_masks = []
        preparation_metrics: list[dict[str, typing.Any]] = []

        # Preparation cost more than the inference it feeds: ~4.5 s of serial CPU
        # per batch against ~4.1 s of batched GPU. `map` preserves order, so the
        # embeds still line up with `items`.
        prep_started_at = time.perf_counter()
        prepared = list(self._decode_executor.map(self._prepare_inputs_cpu, items))
        prep_wall_ms = (time.perf_counter() - prep_started_at) * 1000
        log(
            f"    prepped {len(items)} image(s) in {prep_wall_ms:.0f}ms "
            f"({JANUS_IMAGE_DECODE_WORKERS} threads)"
        )

        for (_path, _geocode), (prepare_inputs, decode_ms, processor_ms) in zip(
            items, prepared
        ):
            vision_started_at = time.perf_counter()
            gpu_inputs = prepare_inputs.to(self.vl_gpt.device)
            embeds = self.vl_gpt.prepare_inputs_embeds(**gpu_inputs)
            vision_ms = (time.perf_counter() - vision_started_at) * 1000
            all_embeds.append(embeds)
            all_masks.append(gpu_inputs.attention_mask)
            preparation_metrics.append(
                {
                    "attempt": "batch",
                    "batchSize": len(items),
                    "maxNewTokens": self.batch_max_new_tokens,
                    "decodeMs": round(decode_ms, 2),
                    "processorMs": round(processor_ms, 2),
                    "visionPreparationMs": round(vision_ms, 2),
                }
            )

        log(f"    generating {len(items)} caption(s)...")
        generate_started_at = time.perf_counter()

        # Left-pad to the longest sequence (standard for decoder-only batch generation)
        max_len = max(e.shape[1] for e in all_embeds)
        embed_dim = all_embeds[0].shape[2]
        device = all_embeds[0].device
        dtype = all_embeds[0].dtype

        padded_embeds = []
        padded_masks = []
        for embeds, mask in zip(all_embeds, all_masks):
            pad_len = max_len - embeds.shape[1]
            if pad_len > 0:
                pad = torch.zeros(1, pad_len, embed_dim, device=device, dtype=dtype)
                embeds = torch.cat([pad, embeds], dim=1)
                mask_pad = torch.zeros(1, pad_len, device=device, dtype=mask.dtype)
                mask = torch.cat([mask_pad, mask], dim=1)
            padded_embeds.append(embeds)
            padded_masks.append(mask)

        batched_embeds = torch.cat(padded_embeds, dim=0)
        batched_masks = torch.cat(padded_masks, dim=0)

        outputs = self.vl_gpt.language_model.generate(
            inputs_embeds=batched_embeds,
            attention_mask=batched_masks,
            **self._generation_kwargs(self.batch_max_new_tokens),
        )
        generate_ms = (time.perf_counter() - generate_started_at) * 1000
        log(f"    generated {len(items)} caption(s) in {generate_ms:.0f}ms")

        for metric in preparation_metrics:
            metric["generateBatchMs"] = round(generate_ms, 2)
        self._record_generation_metrics(
            outputs, self.batch_max_new_tokens, preparation_metrics
        )

        return [
            self.tokenizer.decode(output.cpu().tolist(), skip_special_tokens=True)
            for output in outputs
        ]


class Gemma4Classifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_GEMMA4

    def __init__(
        self,
        model_id: str = DEFAULT_GEMMA4_MODEL_ID,
        quantization: Optional[str] = DEFAULT_GEMMA4_QUANTIZATION,
        batch_size: int = DEFAULT_GEMMA4_BATCH_SIZE,
        max_new_tokens: int = GEMMA4_MAX_NEW_TOKENS,
        gpu_headroom_gb: Optional[float] = None,
        low_impact: bool = False,
    ):
        super().__init__()
        self.model_id = model_id
        self.quantization = quantization
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.gpu_headroom_gb = gpu_headroom_gb
        self.low_impact = low_impact
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _build_max_memory(self) -> Optional[dict[typing.Any, str]]:
        if not torch.cuda.is_available():
            return None

        requested_headroom = self.gpu_headroom_gb
        if requested_headroom is None and self.low_impact:
            requested_headroom = DEFAULT_GEMMA4_LOW_IMPACT_HEADROOM_GB
        if requested_headroom is None:
            return None

        total_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        usable_gb = max(4.0, total_gb - requested_headroom)
        usable_mib = max(4096, int(usable_gb * 1024))
        reserved_gb = round(total_gb - (usable_mib / 1024), 2)
        log(
            "Gemma 4 headroom mode: "
            f"reserving about {reserved_gb} GiB of GPU memory for interactive work."
        )
        return {
            0: f"{usable_mib}MiB",
            "cpu": DEFAULT_GEMMA4_CPU_MAX_MEMORY,
        }

    def init_model(self) -> None:
        try:
            from transformers import AutoModelForMultimodalLM
        except ImportError as err:
            raise RuntimeError(
                "Gemma 4 full-precision support requires a newer transformers build with AutoModelForMultimodalLM. Keep Janus as the default in this environment, or install the experimental Gemma runtime separately."
            ) from err
        log(
            f"Loading Gemma 4 classifier ({self.model_id}, quantization={self.quantization or 'none'})..."
        )
        if self.quantization == "bnb-4bit":
            log(
                "Warning: local testing found Gemma 4 vision captions can become placeholder-like under bitsandbytes 4-bit quantisation. Prefer full precision for quality checks."
            )
        self.processor = AutoProcessor.from_pretrained(self.model_id, use_fast=False)

        model_kwargs: dict[str, typing.Any] = {}
        max_memory = self._build_max_memory()
        if self.quantization == "bnb-4bit":
            try:
                from transformers import BitsAndBytesConfig
            except ImportError as err:
                raise RuntimeError(
                    "Gemma 4 4-bit loading requires bitsandbytes-compatible transformers support."
                ) from err

            compute_dtype = (
                torch.bfloat16 if torch.cuda.is_available() else torch.float32
            )
            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=compute_dtype,
            )
            model_kwargs["device_map"] = "auto"
            if max_memory is not None:
                model_kwargs["max_memory"] = max_memory
        else:
            model_kwargs["dtype"] = (
                torch.bfloat16 if torch.cuda.is_available() else torch.float32
            )
            if max_memory is not None:
                model_kwargs["device_map"] = "auto"
                model_kwargs["max_memory"] = max_memory

        self.model = AutoModelForMultimodalLM.from_pretrained(
            self.model_id,
            **model_kwargs,
        )
        if "device_map" not in model_kwargs:
            self.model = self.model.to(self.device)
        self.model = self.model.eval()
        log(f"Loaded Gemma 4 classifier {self.model_id}.")

    def _build_prompt(self, geocode: Optional[Mapping]) -> str:
        return build_classifier_prompt(geocode)

    def _build_inputs(
        self, path: str, geocode: Optional[Mapping]
    ) -> dict[str, torch.Tensor]:
        prompt = self._build_prompt(geocode)
        with Image.open(path) as raw_image:
            image = raw_image.convert("RGB")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            add_generation_prompt=True,
        )

        resolved_device = getattr(self.model, "device", None)
        if resolved_device is None or str(resolved_device) == "meta":
            resolved_device = self.device
        return {k: v.to(resolved_device) for k, v in inputs.items()}

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        inputs = self._build_inputs(path, geocode)
        input_ids = inputs.get("input_ids")
        generated = self.model.generate(
            **inputs,
            max_new_tokens=self.max_new_tokens,
            do_sample=False,
            use_cache=True,
        )

        if input_ids is not None:
            prompt_len = input_ids.shape[-1]
            generated_tokens = generated[:, prompt_len:]
        else:
            generated_tokens = generated

        return self.processor.batch_decode(
            generated_tokens,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
        )[0]


class Gemma4GgufClassifier(BaseCaptionClassifier):
    backend = CLASSIFIER_BACKEND_GEMMA4_GGUF

    def __init__(
        self,
        model_id: str = DEFAULT_GEMMA4_GGUF_MODEL_ID,
        quantization: Optional[str] = None,
        batch_size: int = DEFAULT_GEMMA4_GGUF_BATCH_SIZE,
        max_new_tokens: int = DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS,
        gpu_headroom_gb: Optional[float] = None,
        low_impact: bool = False,
    ):
        super().__init__()
        self.model_id = model_id
        self.quantization = quantization
        self.batch_size = batch_size
        self.max_new_tokens = max_new_tokens
        self.gpu_headroom_gb = gpu_headroom_gb
        self.low_impact = low_impact
        self.command = None
        self._json_schema_path = None

    def init_model(self) -> None:
        command = shutil.which("llama-mtmd-cli")
        if command is None:
            candidate = "/tmp/llama.cpp/build/bin/llama-mtmd-cli"
            if os.path.exists(candidate):
                command = candidate
        if command is None:
            raise RuntimeError(
                "Could not find llama-mtmd-cli. Install llama.cpp or add it to PATH."
            )
        self.command = command
        schema = {
            "type": "object",
            "properties": {
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "alt_text": {"type": "string"},
            },
            "required": list(JANUS_RESPONSE_FIELDS),
            "additionalProperties": False,
        }
        schema_file = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            prefix="gemma4-gguf-schema-",
            delete=False,
            encoding="utf-8",
        )
        json.dump(schema, schema_file)
        schema_file.flush()
        schema_file.close()
        self._json_schema_path = schema_file.name
        log(
            f"Using llama.cpp Gemma 4 GGUF classifier ({self.model_id}) via {self.command}."
        )

    def _build_prompt(self, geocode: Optional[Mapping]) -> str:
        return build_classifier_prompt(geocode)

    def _extract_answer_text(self, raw_output: str) -> str:
        answer = raw_output.strip()
        if "<|channel>final" in answer:
            answer = answer.split("<|channel>final", 1)[1]
        elif "<|channel>analysis" in answer:
            answer = answer.split("<|channel>analysis", 1)[-1]
        elif "<|channel>thought" in answer and "{ " in answer:
            answer = answer[answer.find("{ ") :]

        if "<|channel>" in answer:
            answer = answer.split("<|channel>", 1)[-1]
        if "<channel|>" in answer:
            answer = answer.split("<channel|>")[-1]
        answer = answer.replace("```json", "").replace("```", "").strip()
        return answer

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        if self.command is None:
            raise RuntimeError(
                "Gemma4GgufClassifier.init_model() must be called first."
            )

        prompt = self._build_prompt(geocode)
        command = [
            self.command,
            "--image",
            path,
            "--image-min-tokens",
            str(DEFAULT_GEMMA4_GGUF_IMAGE_MIN_TOKENS),
            "--image-max-tokens",
            str(DEFAULT_GEMMA4_GGUF_IMAGE_MAX_TOKENS),
            "--ctx-size",
            str(DEFAULT_GEMMA4_GGUF_CTX_SIZE),
            "--threads",
            str(DEFAULT_GEMMA4_GGUF_THREADS),
            "--gpu-layers",
            "auto",
            "--predict",
            str(self.max_new_tokens),
            "--jinja",
            "--json-schema-file",
            self._json_schema_path,
            "--no-warmup",
            "-p",
            prompt,
        ]
        if self.model_id.endswith(".gguf") and os.path.exists(self.model_id):
            mmproj_path = self.quantization
            if mmproj_path is None:
                sibling = os.path.join(
                    os.path.dirname(self.model_id), "mmproj-BF16.gguf"
                )
                if os.path.exists(sibling):
                    mmproj_path = sibling
            if mmproj_path is None:
                raise RuntimeError(
                    "Local GGUF model path requires an mmproj file path via quantization or a sibling mmproj-BF16.gguf."
                )
            command[1:1] = ["--model", self.model_id, "--mmproj", mmproj_path]
        else:
            command[1:1] = ["--hf-repo", self.model_id]

        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            env=os.environ.copy(),
        )
        output = completed.stdout.strip()
        if not output:
            stderr = completed.stderr.strip()
            output = self._extract_answer_text(stderr)
        if not output:
            raise RuntimeError("llama.cpp returned no parseable output.")
        return self._extract_answer_text(output)

    def release(self) -> None:
        super().release()
        if self._json_schema_path:
            Path(self._json_schema_path).unlink(missing_ok=True)
            self._json_schema_path = None
        self.command = None


class BaseImageEmbedder:
    MODEL_ID: str
    MODEL_REVISION: str

    def init_model(self) -> None:
        self.model_id = self.MODEL_ID
        log(f"Loading image embedder {self.model_id}...")
        self.processor = AutoImageProcessor.from_pretrained(
            self.model_id, revision=self.MODEL_REVISION, use_fast=False
        )
        self.model = AutoModel.from_pretrained(
            self.model_id, revision=self.MODEL_REVISION
        )
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = self.model.to(self.device).eval()
        log(f"Loaded image embedder {self.model_id} on {self.device}.")

    @torch.inference_mode()
    def predict_image_embedding(self, path: str) -> list[float]:
        return self.predict_image_embeddings_batch([path])[0]

    @torch.inference_mode()
    def predict_image_embeddings_batch(
        self, paths: list[str]
    ) -> list[Optional[list[float]]]:
        # Thread image opens — JPEG decode releases the GIL (~2.5x vs serial for large files).
        # A single truncated/corrupt file must not abort the whole GPU run, so an
        # unreadable image yields None (aligned to its input position) instead of
        # raising; the caller skips None entries.
        def _open(path: str) -> Optional["Image.Image"]:
            try:
                return Image.open(path).convert("RGB")
            except Exception as err:
                log(f"Skipping unreadable image {path}: {err}")
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            opened = list(ex.map(_open, paths))

        results: list[Optional[list[float]]] = [None] * len(paths)
        valid = [(i, img) for i, img in enumerate(opened) if img is not None]
        if not valid:
            return results

        inputs = self.processor(images=[img for _, img in valid], return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        features = self.model.get_image_features(**inputs)
        # Normalise for cosine similarity; store as float list for SQLite JSON.
        features = torch.nn.functional.normalize(features, p=2, dim=-1)
        vectors = features.detach().float().cpu().tolist()
        for (position, _), vector in zip(valid, vectors):
            results[position] = vector
        return results

    def release(self) -> None:
        """Free the embedder's GPU weights so the next pass loads into a clear card."""
        self.model = None
        self.processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


class SiglipEmbedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip-base-patch16-224"
    MODEL_REVISION = SIGLIP_V1_MODEL_REVISION


class Siglip2Embedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip2-base-patch16-224"
    MODEL_REVISION = SIGLIP_V2_MODEL_REVISION


def create_classifier(
    backend: str,
    model_id: Optional[str] = None,
    quantization: Optional[str] = None,
    batch_size: Optional[int] = None,
    max_new_tokens: Optional[int] = None,
    batch_max_new_tokens: Optional[int] = None,
    gpu_headroom_gb: Optional[float] = None,
    low_impact: bool = False,
) -> BaseCaptionClassifier:
    if backend == CLASSIFIER_BACKEND_JANUS:
        return JanusClassifier(
            batch_size=batch_size or JANUS_BATCH_SIZE,
            max_new_tokens=max_new_tokens or JANUS_MAX_NEW_TOKENS,
            batch_max_new_tokens=(batch_max_new_tokens or JANUS_BATCH_MAX_NEW_TOKENS),
        )

    if backend == CLASSIFIER_BACKEND_GEMMA4:
        return Gemma4Classifier(
            model_id=model_id or DEFAULT_GEMMA4_MODEL_ID,
            quantization=(
                quantization
                if quantization is not None
                else DEFAULT_GEMMA4_QUANTIZATION
            ),
            batch_size=batch_size or DEFAULT_GEMMA4_BATCH_SIZE,
            max_new_tokens=max_new_tokens or GEMMA4_MAX_NEW_TOKENS,
            gpu_headroom_gb=gpu_headroom_gb,
            low_impact=low_impact,
        )

    if backend == CLASSIFIER_BACKEND_GEMMA4_GGUF:
        return Gemma4GgufClassifier(
            model_id=model_id or DEFAULT_GEMMA4_GGUF_MODEL_ID,
            quantization=quantization,
            batch_size=batch_size or DEFAULT_GEMMA4_GGUF_BATCH_SIZE,
            max_new_tokens=max_new_tokens or DEFAULT_GEMMA4_GGUF_MAX_NEW_TOKENS,
            gpu_headroom_gb=gpu_headroom_gb,
            low_impact=low_impact,
        )

    raise ValueError(f"Unsupported classifier backend: {backend}")


def convert_to_degress(value: exifread.utils.Ratio, lat_or_lng_ref: str) -> float:
    is_s_or_w = str(lat_or_lng_ref) == "W" or str(lat_or_lng_ref) == "S"
    sign = -1 if is_s_or_w else 1
    d = float(value.values[0].num) / float(value.values[0].den)
    m = float(value.values[1].num) / float(value.values[1].den)
    s = float(value.values[2].num) / float(value.values[2].den)
    return sign * (d + (m / 60.0) + (s / 3600.0))


def get_image_geocode(lat_deg: float, lng_deg: float) -> Mapping:
    # No cache: reverse_geocode.search is an in-process k-d tree lookup (~0ms).
    # A coordinate cache would rarely hit anyway — GPS precision means two photos
    # taken nearby have different float values.
    results = reverse_geocode.search([(lat_deg, lng_deg)])
    if len(results) > 0:
        return results[0]
    else:
        return {}


def get_exif(fh: IO[any]):
    # MakerNote decoding and embedded-thumbnail extraction are intentionally
    # skipped: the index keeps only standard camera/lens/date/GPS fields. On the
    # fixed CPU benchmark this is 31% faster with identical retained fields.
    tags = exifread.process_file(fh, details=False)
    return tags


def prepare_colour_thumbnail(
    path: str, max_dimension: int = COLOUR_THUMBNAIL_MAX_DIMENSION
) -> np.ndarray:
    """Decode a bounded RGBA thumbnail for palette extraction.

    JPEG ``draft`` asks the decoder for a lower DCT resolution before pixels are
    materialised; ``thumbnail`` then bounds non-JPEG inputs too. Median-cut colour
    clustering does not need the source's multi-megapixel spatial resolution.
    """
    with Image.open(path) as image:
        image.draft("RGB", (max_dimension, max_dimension))
        image.thumbnail((max_dimension, max_dimension), resample=Image.Resampling.BOX)
        return np.array(image.convert("RGBA"), dtype=np.uint8)


def extract_colour_palette(path: str) -> list[tuple[int, int, int]]:
    """Extract the published palette from the full-resolution source.

    Deliberately full-resolution. Bounding the source to a thumbnail first is
    ~4.5x faster in isolation but reorders the median-cut clusters: measured over
    300 real photos it moves ``palette[0]`` by more than deltaE 18 for 23% of them,
    and ``palette[0]`` is the dominant colour the map, timeline, photo placeholder
    and slideshow pairing all read. Colours are extracted on background threads
    concurrently with GPU inference, so that cost is hidden behind captioning and
    the speedup buys no measurable wall-clock on a full index. See
    ``benchmark-colours`` for the comparison.
    """
    return fast_colorthief.get_palette(path)


def extract_thumbnail_colour_palette(
    path: str,
    max_dimension: int = COLOUR_THUMBNAIL_MAX_DIMENSION,
    quality: int = COLOUR_THUMBNAIL_QUALITY,
) -> list[tuple[int, int, int]]:
    """Bounded-thumbnail palette. Comparison tooling only — never published."""
    thumbnail = prepare_colour_thumbnail(path, max_dimension=max_dimension)
    return fast_colorthief.get_palette(thumbnail, quality=quality)


def get_album_relative_path(path: str) -> str:
    # Specific hack for album project
    # album-relative is /myalbum/asdf.jpg
    p = Path(path)
    try:
        return f"/album/{p.parts[-2]}#{p.parts[-1]}"
    except Exception:
        return str(p)


def get_filename(path: str) -> str:
    return str(os.path.basename(Path(path)))


EMBEDDINGS_TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS embeddings ("
    "path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, "
    "embedding_blob BLOB, embedding_scale REAL, PRIMARY KEY(path, model_id))"
)


def _optional_bool_int(value: typing.Any) -> Optional[int]:
    return None if value is None else int(bool(value))


def encode_embedding(embedding: list[float]) -> Tuple[bytes, float]:
    """Quantise a float vector to int8 bytes with a per-vector scale.

    scale = max|v| / 127 maps the largest component to ±127; decoding multiplies
    each int8 back by the scale. Measured on the production DB (1495 photos,
    both SigLIP spaces): mean top-10 neighbour overlap ≥98.4%, max cosine error
    5e-3 — ranking flips occur only among near-ties, for a 23× smaller table
    than the JSON text it replaces."""
    if not embedding:
        return b"", 1.0
    scale = max(abs(value) for value in embedding) / 127.0
    if scale == 0.0:
        scale = 1.0
    quantised = struct.pack(
        f"{len(embedding)}b",
        *(max(-127, min(127, round(value / scale))) for value in embedding),
    )
    return quantised, scale


def decode_embedding(blob: bytes, scale: float) -> list[float]:
    """Inverse of encode_embedding: int8 bytes × scale → float vector."""
    return [component * scale for component in struct.unpack(f"{len(blob)}b", blob)]


# Repository for our search + metadata table
class Sqlite3Client:
    def __init__(
        self,
        db_path: typing.Union[str, bytes, os.PathLike],
        read_only: bool = False,
    ):
        self.db_path = str(db_path)
        self.read_only = read_only
        if read_only:
            absolute = os.path.abspath(self.db_path)
            self.con = sqlite3.connect(f"file:{absolute}?mode=ro", uri=True)
        else:
            self.con = sqlite3.connect(db_path)
        # page_size MUST be set before any page is written (before the first
        # CREATE TABLE) or it is silently
        # ignored — an existing DB keeps its page size until a VACUUM. 4096 is the
        # SQLite default; it is set explicitly to document the departure from the
        # legacy 1024-byte pages (a sql.js-httpvfs range-read optimisation — the
        # browser now downloads the DB in full).
        if not read_only:
            self.con.execute("PRAGMA page_size=4096;")
        self._images_columns = None

    @contextmanager
    def transaction(self):
        cur = self.con.cursor()
        cur.execute("BEGIN")
        try:
            yield cur
        except Exception:
            cur.execute("ROLLBACK")
            raise
        else:
            cur.execute("COMMIT")

    def info(self):
        version = sqlite3.sqlite_version
        entries = 0
        try:
            entries = self.con.execute("SELECT COUNT(*) FROM images").fetchone()[0]
        except sqlite3.Error:
            pass
        return {"version": version, "entries": entries}

    def table_exists(self, name: str) -> bool:
        return (
            self.con.execute(
                "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
                (name,),
            ).fetchone()
            is not None
        )

    def setup_tables(self):
        if self.read_only:
            raise RuntimeError("Cannot migrate a read-only database")
        cur = self.con.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        images_existed = self.table_exists("images")
        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject, tokenize='porter trigram')"
        )
        desired_image_columns = [
            "path",
            "album_relative_path",
            "filename",
            "geocode",
            "exif",
            "tags",
            "colors",
            "alt_text",
            "subject",
        ]
        existing_image_columns = [
            row[1] for row in cur.execute("PRAGMA table_info(images)").fetchall()
        ]
        if existing_image_columns != desired_image_columns or (
            images_existed and not self.migration_applied(IMAGES_SCHEMA_MIGRATION)
        ):
            cur.execute("DROP TABLE IF EXISTS images_migrating")
            cur.execute(
                "CREATE VIRTUAL TABLE images_migrating USING fts5("
                "path, album_relative_path, filename, geocode, exif, tags, colors, "
                "alt_text, subject, tokenize='porter trigram')"
            )
            select_fields = [
                column if column in existing_image_columns else f"NULL AS {column}"
                for column in desired_image_columns
            ]
            cur.execute(
                "INSERT INTO images_migrating("
                + ", ".join(desired_image_columns)
                + ") SELECT "
                + ", ".join(select_fields)
                + " FROM images"
            )
            cur.execute("DROP TABLE images")
            cur.execute("ALTER TABLE images_migrating RENAME TO images")
            self._images_columns = None
        self.mark_migration(IMAGES_SCHEMA_MIGRATION, cur)
        cur.execute(
            "CREATE TABLE IF NOT EXISTS tags (tag VARCHAR PRIMARY KEY, count INTEGER DEFAULT 0)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS metadata (path VARCHAR PRIMARY KEY, lat_deg REAL, lng_deg REAL, iso8601 TEXT)"
        )
        # Structured geocode components so facets match a place exactly on the
        # right admin level (city "Tokyo" no longer also matches region "Tokyo")
        # instead of any line of the newline-joined blob. Added by migration so
        # existing DBs gain the columns; populated on (re)index.
        metadata_columns = {
            row[1] for row in cur.execute("PRAGMA table_info(metadata)").fetchall()
        }
        for column in ("geo_city", "geo_region", "geo_subregion", "geo_country"):
            if column not in metadata_columns:
                cur.execute(f"ALTER TABLE metadata ADD COLUMN {column} TEXT")
        # Per-file fingerprint (mtime + size) so a photo re-exported under the
        # same filename is detected as changed and re-indexed, instead of being
        # skipped forever by the path-presence check. Added IF NOT EXISTS so an
        # existing DB gains it on the next run; already-indexed paths get their
        # baseline signature backfilled during planning (no forced re-index).
        cur.execute(
            "CREATE TABLE IF NOT EXISTS file_signatures (path VARCHAR PRIMARY KEY, mtime REAL, size INTEGER)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS image_tags (path TEXT NOT NULL, tag TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(path, tag, source))"
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag)")
        cur.execute(
            "CREATE TABLE IF NOT EXISTS pipeline_state ("
            "path TEXT NOT NULL, stage TEXT NOT NULL, source_sha256 TEXT NOT NULL, "
            "pipeline_version TEXT NOT NULL, model_id TEXT, completed_at TEXT NOT NULL, "
            "PRIMARY KEY(path, stage))"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS caption_generation_metrics ("
            "id INTEGER PRIMARY KEY, path TEXT NOT NULL, pipeline_version TEXT NOT NULL, "
            "attempted_at TEXT NOT NULL, attempt TEXT NOT NULL, batch_size INTEGER, "
            "max_new_tokens INTEGER, token_count INTEGER, completed_with_eos INTEGER, "
            "completed_with_json INTEGER, completed_with_schema INTEGER, "
            "hit_token_limit INTEGER, parse_success INTEGER, oom_fallback INTEGER, "
            "decode_ms REAL, processor_ms REAL, vision_preparation_ms REAL, "
            "generate_batch_ms REAL)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_caption_generation_metrics_path "
            "ON caption_generation_metrics(path, pipeline_version)"
        )
        metric_columns = {
            row[1]
            for row in cur.execute(
                "PRAGMA table_info(caption_generation_metrics)"
            ).fetchall()
        }
        if "completed_with_json" not in metric_columns:
            cur.execute(
                "ALTER TABLE caption_generation_metrics "
                "ADD COLUMN completed_with_json INTEGER"
            )
        if "completed_with_schema" not in metric_columns:
            cur.execute(
                "ALTER TABLE caption_generation_metrics "
                "ADD COLUMN completed_with_schema INTEGER"
            )
        cur.execute(EMBEDDINGS_TABLE_SQL)
        # Rebuild older embeddings schemas in place. Two legacy shapes exist:
        # PRIMARY KEY(path) only (pre v1+v2 coexistence) and JSON-text vectors
        # (embedding_json). Both carry embedding_json, so one pass re-encodes
        # every row as an int8 blob + per-vector scale.
        embedding_columns = cur.execute("PRAGMA table_info(embeddings)").fetchall()
        embedding_column_names = {row[1] for row in embedding_columns}
        pk_columns = [
            row[1]
            for row in sorted(embedding_columns, key=lambda row: row[5])
            if row[5] > 0
        ]
        migrated_embeddings = (
            pk_columns == ["path"] or "embedding_json" in embedding_column_names
        )
        if migrated_embeddings:
            cur.execute("ALTER TABLE embeddings RENAME TO embeddings_legacy")
            cur.execute(EMBEDDINGS_TABLE_SQL)
            legacy_rows = cur.execute(
                "SELECT path, COALESCE(model_id, ''), embedding_json FROM embeddings_legacy"
            ).fetchall()
            for path, model_id, embedding_json in legacy_rows:
                vector = json.loads(embedding_json) if embedding_json else []
                blob, scale = encode_embedding(vector)
                cur.execute(
                    "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (path, model_id, len(vector), blob, scale),
                )
            cur.execute("DROP TABLE embeddings_legacy")
        # PRIMARY KEY(path, model_id) already provides the path-prefix lookup.
        cur.execute("DROP INDEX IF EXISTS idx_embeddings_path")
        # The migration INSERTs above open an implicit transaction; the
        # journal-mode change cannot run inside one, so commit first.
        self.con.commit()
        # The published DB is downloaded in full by the browser; delete-mode
        # journalling keeps it a single copyable file (no -wal sidecar).
        cur.execute("PRAGMA journal_mode = delete;").fetchone()
        self.con.commit()
        if migrated_embeddings:
            # VACUUM rewrites the file so it shrinks past the dropped JSON text
            # and adopts 4096-byte pages — page_size only takes effect on a
            # fresh DB or a VACUUM, and cannot change while in WAL mode, hence
            # after the journal_mode reset above.
            cur.execute("PRAGMA page_size=4096;")
            cur.execute("VACUUM")
            self.con.commit()

        self.migrate_image_tags()

    def migration_applied(self, version: str) -> bool:
        row = self.con.execute(
            "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
        ).fetchone()
        return row is not None

    def mark_migration(self, version: str, cur: sqlite3.Cursor) -> None:
        cur.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (version, datetime.now().astimezone().isoformat(timespec="seconds")),
        )

    def migrate_image_tags(self) -> None:
        """Build authoritative per-image tag relationships for legacy databases."""
        if self.migration_applied(IMAGE_TAGS_MIGRATION):
            return

        rows = self.con.execute(
            "SELECT i.path, i.tags, m.lat_deg, m.lng_deg "
            "FROM images i LEFT JOIN metadata m ON m.path = i.path"
        ).fetchall()
        with self.transaction() as cur:
            cur.execute("DELETE FROM image_tags")
            for path, tags_blob, lat_deg, lng_deg in rows:
                classifier_tags = split_tag_text(tags_blob)
                geocode: Mapping = {}
                if lat_deg is not None and lng_deg is not None:
                    geocode = get_image_geocode(lat_deg, lng_deg)
                self.replace_image_tags(
                    path, classifier_tags, geocode, cur=cur, rebuild=False
                )
            self.rebuild_tag_counts(cur)
            self.mark_migration(IMAGE_TAGS_MIGRATION, cur)

    def rebuild_tag_counts(self, cur: Optional[sqlite3.Cursor] = None) -> None:
        if cur is None:
            with self.transaction() as transactional_cur:
                self.rebuild_tag_counts(transactional_cur)
            return
        cur.execute("DELETE FROM tags")
        cur.execute(
            "INSERT INTO tags(tag, count) "
            "SELECT tag, COUNT(DISTINCT path) FROM image_tags GROUP BY tag"
        )

    def replace_image_tags(
        self,
        path: str,
        classifier_tags: list[str],
        geocode: Optional[Mapping] = None,
        cur: Optional[sqlite3.Cursor] = None,
        rebuild: bool = True,
    ) -> None:
        if cur is None:
            with self.transaction() as transactional_cur:
                self.replace_image_tags(
                    path,
                    classifier_tags,
                    geocode,
                    transactional_cur,
                    rebuild=rebuild,
                )
            return

        cur.execute("DELETE FROM image_tags WHERE path = ?", (path,))
        rows = {
            (path, tag, "classifier")
            for tag in classifier_tags
            if isinstance(tag, str) and tag.strip()
        }
        if geocode:
            rows.update(
                (path, value, "geocode")
                for value in (
                    geocode.get("country"),
                    geocode.get("city"),
                    geocode.get("country_code"),
                )
                if isinstance(value, str) and value.strip()
            )
        cur.executemany(
            "INSERT OR IGNORE INTO image_tags(path, tag, source) VALUES (?, ?, ?)",
            sorted(rows),
        )
        if rebuild:
            self.rebuild_tag_counts(cur)

    def replace_tags_for_source(
        self,
        path: str,
        tags: typing.Iterable[str],
        source: str,
        cur: sqlite3.Cursor,
    ) -> None:
        cur.execute(
            "DELETE FROM image_tags WHERE path = ? AND source = ?", (path, source)
        )
        rows = {
            (path, tag, source) for tag in tags if isinstance(tag, str) and tag.strip()
        }
        cur.executemany(
            "INSERT OR IGNORE INTO image_tags(path, tag, source) VALUES (?, ?, ?)",
            sorted(rows),
        )

    def get_pipeline_states(
        self,
    ) -> dict[tuple[str, str], tuple[str, str, Optional[str]]]:
        if not self.table_exists("pipeline_state"):
            return {}
        rows = self.con.execute(
            "SELECT path, stage, source_sha256, pipeline_version, model_id FROM pipeline_state"
        ).fetchall()
        return {(row[0], row[1]): (row[2], row[3], row[4]) for row in rows}

    def upsert_pipeline_state(
        self,
        path: str,
        stage: str,
        source_sha256: str,
        pipeline_version: str,
        model_id: Optional[str] = None,
        cur: Optional[sqlite3.Cursor] = None,
    ) -> None:
        if cur is None:
            with self.transaction() as transactional_cur:
                self.upsert_pipeline_state(
                    path,
                    stage,
                    source_sha256,
                    pipeline_version,
                    model_id,
                    transactional_cur,
                )
            return
        cur.execute(
            "INSERT INTO pipeline_state(path, stage, source_sha256, pipeline_version, model_id, completed_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(path, stage) DO UPDATE SET "
            "source_sha256=excluded.source_sha256, pipeline_version=excluded.pipeline_version, "
            "model_id=excluded.model_id, completed_at=excluded.completed_at",
            (
                path,
                stage,
                source_sha256,
                pipeline_version,
                model_id,
                datetime.now().astimezone().isoformat(timespec="seconds"),
            ),
        )

    def insert_caption_generation_metrics(
        self,
        metrics: typing.Iterable[Mapping[str, typing.Any]],
        cur: Optional[sqlite3.Cursor] = None,
    ) -> None:
        rows = list(metrics)
        if not rows:
            return
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_caption_generation_metrics(rows, transactional_cur)
            return
        attempted_at = datetime.now().astimezone().isoformat(timespec="seconds")
        cur.executemany(
            "INSERT INTO caption_generation_metrics("
            "path, pipeline_version, attempted_at, attempt, batch_size, max_new_tokens, "
            "token_count, completed_with_eos, completed_with_json, completed_with_schema, "
            "hit_token_limit, parse_success, oom_fallback, decode_ms, processor_ms, "
            "vision_preparation_ms, generate_batch_ms) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    metric["path"],
                    metric["pipelineVersion"],
                    attempted_at,
                    metric.get("attempt", "batch"),
                    metric.get("batchSize"),
                    metric.get("maxNewTokens"),
                    metric.get("tokenCount"),
                    _optional_bool_int(metric.get("completedWithEos")),
                    _optional_bool_int(metric.get("completedWithJson")),
                    _optional_bool_int(metric.get("completedWithSchema")),
                    _optional_bool_int(metric.get("hitTokenLimit")),
                    _optional_bool_int(metric.get("parseSuccess")),
                    _optional_bool_int(metric.get("oomFallback")),
                    metric.get("decodeMs"),
                    metric.get("processorMs"),
                    metric.get("visionPreparationMs"),
                    metric.get("generateBatchMs"),
                )
                for metric in rows
            ],
        )

    def finalize_journal_mode(self):
        """Checkpoint the WAL and return the DB to rollback-journal (delete) mode.

        Published databases are single files, so no mutation command may leave
        committed content only in an uncopied ``-wal`` sidecar."""
        cur = self.con.cursor()
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        cur.execute("PRAGMA journal_mode = delete;")
        self.con.commit()

    def optimize(self, vacuum: bool = False):
        cur = self.con.cursor()
        cur.execute("INSERT INTO images(images) VALUES ('optimize');")
        self.con.commit()
        if vacuum:
            cur.execute("VACUUM")
            self.con.commit()

    def already_exists(self, path: str) -> bool:
        cur = self.con.cursor()
        result = cur.execute(
            "SELECT 1 FROM images WHERE path = ? LIMIT 1", (path,)
        ).fetchone()
        return result is not None

    def has_embedding(self, path: str) -> bool:
        cur = self.con.cursor()
        result = cur.execute(
            "SELECT 1 FROM embeddings WHERE path = ? LIMIT 1", (path,)
        ).fetchone()
        return result is not None

    def list_image_paths(self):
        if not self.table_exists("images"):
            return set()
        cur = self.con.cursor()
        res = cur.execute("SELECT path FROM images")
        return {row[0] for row in res.fetchall()}

    def list_caption_paths(self):
        if not self.table_exists("images"):
            return set()
        cur = self.con.cursor()
        res = cur.execute(
            "SELECT path FROM images WHERE "
            "COALESCE(tags, '') <> '' OR COALESCE(alt_text, '') <> '' OR COALESCE(subject, '') <> ''"
        )
        return {row[0] for row in res.fetchall()}

    def list_metadata_paths(self):
        if not self.table_exists("metadata"):
            return set()
        return {row[0] for row in self.con.execute("SELECT path FROM metadata")}

    def list_embedding_paths(self, model_id: Optional[str] = None):
        if not self.table_exists("embeddings"):
            return set()
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute("SELECT path FROM embeddings")
        return {row[0] for row in res.fetchall()}

    def list_file_signatures(self):
        if not self.table_exists("file_signatures"):
            return {}
        cur = self.con.cursor()
        res = cur.execute("SELECT path, mtime, size FROM file_signatures")
        return {row[0]: (row[1], row[2]) for row in res.fetchall()}

    def upsert_file_signature(
        self,
        path: str,
        mtime: float,
        size: int,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.upsert_file_signature(path, mtime, size, transactional_cur)
                return
        cur.execute(
            "INSERT OR REPLACE INTO file_signatures (path, mtime, size) VALUES (?, ?, ?)",
            (path, mtime, size),
        )

    def upsert_file_signatures(self, signatures: Mapping[str, Tuple[float, int]]):
        if not signatures:
            return
        with self.transaction() as cur:
            cur.executemany(
                "INSERT OR REPLACE INTO file_signatures (path, mtime, size) VALUES (?, ?, ?)",
                [(path, sig[0], sig[1]) for path, sig in signatures.items()],
            )

    def insert_geocode(self, path: str, geocode: str):
        self.insert_field(path, value=geocode, field="geocode")

    def inspect(self):
        cur = self.con.cursor()
        res = cur.execute("SELECT * FROM images")
        resolved = res.fetchall()
        return resolved

    def get_image_row(self, path: str):
        cur = self.con.cursor()
        if self._images_columns is None:
            self._images_columns = {
                row[1] for row in cur.execute("PRAGMA table_info(images)").fetchall()
            }

        ordered_fields = [
            "path",
            "album_relative_path",
            "filename",
            "geocode",
            "exif",
            "tags",
            "colors",
            "alt_text",
            "subject",
        ]
        select_fields = []
        for field in ordered_fields:
            if field in self._images_columns:
                select_fields.append(field)
            else:
                select_fields.append(f"NULL as {field}")
        statement = f"""
            SELECT {", ".join(select_fields)}
            FROM images
            WHERE path = ?
            LIMIT 1
        """
        res = cur.execute(statement, (path,))
        row = res.fetchone()
        if row is None:
            return None
        return {
            "path": row[0],
            "album_relative_path": row[1],
            "filename": row[2],
            "geocode": row[3],
            "exif": row[4],
            "tags": row[5],
            "colors": row[6],
            "alt_text": row[7],
            "subject": row[8],
        }

    def list_paths(self):
        cur = self.con.cursor()

        statement_images = """
        SELECT path
        FROM images
        """
        res = cur.execute(statement_images)
        resolved_image_paths = res.fetchall()

        statement_metadata = """
        SELECT path
        FROM metadata
        """
        res = cur.execute(statement_metadata)
        resolved_metadata_paths = res.fetchall()

        statement_embeddings = """
        SELECT path
        FROM embeddings
        """
        res = cur.execute(statement_embeddings)
        resolved_embedding_paths = res.fetchall()

        resolved_paths = {
            p[0]
            for path_list in [
                resolved_image_paths,
                resolved_metadata_paths,
                resolved_embedding_paths,
            ]
            for p in path_list
        }
        return resolved_paths

    def delete_paths(self, paths: typing.Iterable[str]) -> int:
        resolved = list(dict.fromkeys(paths))
        if not resolved:
            return 0
        with self.transaction() as cur:
            for path in resolved:
                cur.execute("DELETE FROM images WHERE path = ?", (path,))
                cur.execute("DELETE FROM metadata WHERE path = ?", (path,))
                cur.execute("DELETE FROM embeddings WHERE path = ?", (path,))
                cur.execute("DELETE FROM file_signatures WHERE path = ?", (path,))
                cur.execute("DELETE FROM image_tags WHERE path = ?", (path,))
                cur.execute("DELETE FROM pipeline_state WHERE path = ?", (path,))
            self.rebuild_tag_counts(cur)
        return len(resolved)

    def delete_path(self, path: str):
        self.delete_paths([path])

    def search(
        self, query: str, limit: Optional[int] = 999999, offset: Optional[int] = 0
    ):
        cur = self.con.cursor()
        statement = """
        SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE images MATCH ?
        ORDER BY rank
        LIMIT ?
        OFFSET ?
        """

        limit = limit if limit is not None else 999999
        offset = offset if offset is not None else 0

        excluded_columns = "path album_relative_path"
        res = cur.execute(
            statement,
            (f"- {{{excluded_columns}}} : {query}", limit, offset),
        )

        resolved = res.fetchall()
        return resolved

    def search_tags(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        if limit is None:
            res = cur.execute(
                "SELECT * FROM tags t WHERE t.tag LIKE ? ORDER BY t.count DESC;",
                (f"%{query}%",),
            )
        else:
            res = cur.execute(
                "SELECT * FROM tags t WHERE t.tag LIKE ? ORDER BY t.count DESC LIMIT ?;",
                (f"%{query}%", limit),
            )
        resolved = res.fetchall()
        return resolved

    def search_metadata(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        if limit is None:
            res = cur.execute(
                "SELECT * FROM metadata m WHERE m.path LIKE ?;",
                (f"%{query}%",),
            )
        else:
            res = cur.execute(
                "SELECT * FROM metadata m WHERE m.path LIKE ? LIMIT ?;",
                (f"%{query}%", limit),
            )
        resolved = res.fetchall()
        return resolved

    def upsert_image_fields(
        self,
        path: str,
        fields: Mapping[str, typing.Any],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.upsert_image_fields(path, fields, transactional_cur)
                return

        row_exists = cur.execute(
            "SELECT 1 FROM images WHERE path = ? LIMIT 1;",
            (path,),
        ).fetchone()
        resolved_fields = {field: value for field, value in fields.items()}

        if row_exists:
            assignments = ", ".join([f"{field} = ?" for field in resolved_fields])
            cur.execute(
                f"UPDATE images SET {assignments} WHERE path = ?;",
                [*resolved_fields.values(), path],
            )
            return

        columns = ", ".join(["path", *resolved_fields.keys()])
        placeholders = ", ".join(["?" for _ in range(len(resolved_fields) + 1)])
        cur.execute(
            f"INSERT INTO images ({columns}) VALUES ({placeholders});",
            [path, *resolved_fields.values()],
        )

    def insert_field(
        self,
        path: str,
        field: str,
        value: str,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        self.upsert_image_fields(path, {field: value}, cur=cur)

    def update_geocode_columns(
        self,
        path: str,
        geo: Optional[Mapping[str, Optional[str]]] = None,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        """Write only the structured geo_* columns for a path, leaving lat/lng
        and iso8601 untouched — the backfill derives these from coordinates
        that are already stored."""
        if cur is None:
            with self.transaction() as transactional_cur:
                self.update_geocode_columns(path, geo, transactional_cur)
                return
        geo = geo or {}
        cur.execute(
            "UPDATE metadata SET geo_city = ?, geo_region = ?, geo_subregion = ?, "
            "geo_country = ? WHERE path = ?",
            (
                geo.get("geo_city"),
                geo.get("geo_region"),
                geo.get("geo_subregion"),
                geo.get("geo_country"),
                path,
            ),
        )

    def insert_metadata(
        self,
        path: str,
        lat_lng_deg: Tuple[float, float],
        iso8601: str,
        geocode: Optional[Mapping[str, Optional[str]]] = None,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_metadata(
                    path, lat_lng_deg, iso8601, geocode, transactional_cur
                )
                return

        geo = geocode or {}
        cur.execute(
            "INSERT OR IGNORE INTO metadata (path, lat_deg, lng_deg, iso8601) VALUES (?, ?, ?, ?);",
            (
                path,
                lat_lng_deg[0],
                lat_lng_deg[1],
                iso8601,
            ),
        )
        cur.execute(
            "UPDATE metadata SET lat_deg = ?, lng_deg = ?, iso8601 = ?, "
            "geo_city = ?, geo_region = ?, geo_subregion = ?, geo_country = ? "
            "WHERE path = ?",
            (
                lat_lng_deg[0],
                lat_lng_deg[1],
                iso8601,
                geo.get("geo_city"),
                geo.get("geo_region"),
                geo.get("geo_subregion"),
                geo.get("geo_country"),
                path,
            ),
        )

    def insert_embedding(
        self,
        path: str,
        model_id: str,
        embedding: list[float],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_embedding(path, model_id, embedding, transactional_cur)
                return

        blob, scale = encode_embedding(embedding)
        cur.execute(
            "INSERT INTO embeddings (path, model_id, embedding_dim, embedding_blob, embedding_scale) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(path, model_id) DO UPDATE SET embedding_dim = excluded.embedding_dim, embedding_blob = excluded.embedding_blob, embedding_scale = excluded.embedding_scale",
            (path, model_id, len(embedding), blob, scale),
        )

    @staticmethod
    def _decode_embedding_row(row):
        """(path, model_id, dim, blob, scale) → (path, model_id, dim, vector)."""
        if row is None:
            return None
        path, model_id, dim, blob, scale = row
        return (path, model_id, dim, decode_embedding(blob, scale))

    def get_embedding(self, path: str, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings WHERE path = ? AND model_id = ?",
                (path, model_id),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings "
                "WHERE path = ? "
                "ORDER BY CASE "
                "WHEN model_id = ? THEN 0 "
                "WHEN model_id = ? THEN 1 "
                "ELSE 2 END "
                "LIMIT 1",
                (path, Siglip2Embedder.MODEL_ID, SiglipEmbedder.MODEL_ID),
            )
        return self._decode_embedding_row(res.fetchone())

    def list_embeddings(self, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings"
            )
        return [self._decode_embedding_row(row) for row in res.fetchall()]


@click.group()
@click.pass_context
def cli(ctx):
    ctx.ensure_object(dict)


def run_embedding_pass(
    embedder: BaseImageEmbedder,
    paths: list[str],
    precomputed_embeddings: dict[str, dict[str, list[float]]],
    persist_batch: Optional[
        typing.Callable[[str, list[tuple[str, list[float]]]], None]
    ] = None,
    collect: bool = True,
    batch_size: int = EMBEDDER_BATCH_SIZE,
    timings: Optional[dict[str, dict[str, float]]] = None,
) -> float:
    """Load one embedder, embed all ``paths`` in batches, store results, release it.

    Holds only this single embedder in VRAM — the caller releases the previous
    model first — so peak stays at one model. Mutates ``precomputed_embeddings``
    in place (path → {model_id: vector}) and returns the model-load time in ms."""
    load_started_at = time.perf_counter()
    embedder.init_model()
    load_ms = (time.perf_counter() - load_started_at) * 1000
    log_vram(f"{embedder.model_id} load")

    batch_size = max(1, batch_size)
    total_emb_batches = math.ceil(len(paths) / batch_size)
    log(
        f"Running {embedder.model_id} embeddings in batches of {batch_size} "
        f"({len(paths)} images, {total_emb_batches} batch(es))..."
    )
    emb_started_at = time.perf_counter()
    for emb_batch_index, batch_start in enumerate(
        range(0, len(paths), batch_size), start=1
    ):
        batch_paths = paths[batch_start : batch_start + batch_size]
        log(
            f"  {embedder.model_id} batch {emb_batch_index}/{total_emb_batches} starting ({len(batch_paths)} images)..."
        )
        single_started_at = time.perf_counter()
        with heartbeat(
            f"{embedder.model_id} batch {emb_batch_index}/{total_emb_batches}"
        ):
            batch_embeddings = embedder.predict_image_embeddings_batch(batch_paths)
        if len(batch_embeddings) != len(batch_paths):
            log(
                f"WARNING: {embedder.model_id} returned {len(batch_embeddings)} "
                f"embedding(s) for {len(batch_paths)} path(s)"
            )
        completed_batch = []
        for position, path in enumerate(batch_paths):
            embedding = (
                batch_embeddings[position] if position < len(batch_embeddings) else None
            )
            # None ⇒ the image could not be opened (already logged); skip it so a
            # single corrupt file does not abort or misalign the pass.
            if embedding is None:
                continue
            completed_batch.append((path, embedding))
            if collect:
                precomputed_embeddings.setdefault(path, {})[embedder.model_id] = (
                    embedding
                )
        if persist_batch and completed_batch:
            persist_batch(embedder.model_id, completed_batch)
        single_ms = (time.perf_counter() - single_started_at) * 1000
        done = min(batch_start + batch_size, len(paths))
        log(
            f"  {embedder.model_id} batch {emb_batch_index}/{total_emb_batches} done in {single_ms:.0f}ms ({done}/{len(paths)} images)"
        )
    emb_ms = (time.perf_counter() - emb_started_at) * 1000
    if timings is not None:
        timings[embedder.model_id] = {
            "loadMs": round(load_ms, 2),
            "inferenceMs": round(emb_ms, 2),
        }
    log(f"{embedder.model_id} embeddings complete in {emb_ms:.0f}ms")
    log_vram(f"{embedder.model_id} inference")
    embedder.release()
    return load_ms


@cli.command("index")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
@click.option(
    "--model-profile",
    type=click.Choice(
        [MODEL_PROFILE_JANUS, MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID],
        case_sensitive=False,
    ),
    default=MODEL_PROFILE_JANUS,
    help="Indexing profile: janus (captions/core), siglip2 (embeddings), hybrid (both).",
)
@click.option(
    "--benchmark-output",
    default=None,
    help="Optional JSON file path for timing output.",
)
@click.option(
    "--embedding-batch-size",
    default=EMBEDDER_BATCH_SIZE,
    type=click.IntRange(min=1),
    show_default=True,
    help="Image embedding batch size; tune with benchmark-embedder-batch.",
)
@click.option(
    "--classifier-backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_JANUS,
    help="Caption classifier backend to use when the profile includes classifier fields.",
)
@click.option(
    "--classifier-model-id",
    default=None,
    help="Optional model id for the selected classifier backend. Full Gemma defaults to google/gemma-4-E2B-it and GGUF defaults to unsloth/gemma-4-E4B-it-GGUF:Q8_0.",
)
@click.option(
    "--classifier-quantization",
    default=None,
    help="Optional quantisation mode for the classifier backend. The Transformers bnb-4bit path is not recommended for Gemma 4 vision.",
)
@click.option(
    "--classifier-batch-size",
    default=None,
    type=click.IntRange(min=1),
    help="Optional caption batch size override. Janus defaults to 4; Gemma defaults to 1.",
)
@click.option(
    "--classifier-max-new-tokens",
    default=None,
    type=click.IntRange(min=32),
    help="Optional single/retry generation-token cap. Janus defaults to 192.",
)
@click.option(
    "--classifier-batch-max-new-tokens",
    default=None,
    type=click.IntRange(min=32),
    help="Optional Janus batched generation-token cap. Defaults to 128; incomplete rows retry singly at the single cap.",
)
@click.option(
    "--allow-experimental-classifier-batch-size",
    is_flag=True,
    default=False,
    help="Allow a Janus batch above the profiled production limit of 4.",
)
@click.option(
    "--classifier-gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--classifier-low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
def index(
    glob: str,
    dbpath: str,
    dry_run: bool,
    model_profile: str,
    benchmark_output: Optional[str],
    embedding_batch_size: int,
    classifier_backend: str,
    classifier_model_id: Optional[str],
    classifier_quantization: Optional[str],
    classifier_batch_size: Optional[int],
    classifier_max_new_tokens: Optional[int],
    classifier_batch_max_new_tokens: Optional[int],
    allow_experimental_classifier_batch_size: bool,
    classifier_gpu_headroom_gb: Optional[float],
    classifier_low_impact: bool,
):
    started_at = time.perf_counter()
    setup_started_at = time.perf_counter()
    if dry_run and os.path.exists(dbpath):
        db = Sqlite3Client(dbpath, read_only=True)
    elif dry_run:
        db = Sqlite3Client(":memory:")
        db.setup_tables()
    else:
        # Held for the lifetime of the process (OS releases it on exit) so a second
        # run can't deadlock this one over GPU VRAM or co-write the same DB file.
        global_lock_fd = acquire_single_instance_lock(dbpath, global_lock=True)
        try:
            database_lock_fd = acquire_single_instance_lock(dbpath)
        except BaseException:
            os.close(global_lock_fd)
            raise
        db = Sqlite3Client(dbpath)
        db.setup_tables()
    setup_ms = (time.perf_counter() - setup_started_at) * 1000
    db_info = db.info()
    log(f"Database: {db_info['entries']} entries (SQLite {db_info['version']})")
    log(f"Using model profile: {model_profile}")
    resolved_classifier_batch_size = max(
        1,
        classifier_batch_size
        or (
            JANUS_BATCH_SIZE
            if classifier_backend == CLASSIFIER_BACKEND_JANUS
            else DEFAULT_GEMMA4_BATCH_SIZE
        ),
    )
    if (
        classifier_backend == CLASSIFIER_BACKEND_JANUS
        and resolved_classifier_batch_size > JANUS_MAX_PRODUCTION_BATCH_SIZE
        and not allow_experimental_classifier_batch_size
    ):
        raise click.ClickException(
            f"Janus batch size {resolved_classifier_batch_size} exceeds the profiled "
            f"production limit {JANUS_MAX_PRODUCTION_BATCH_SIZE}. Larger batches "
            "were slower on representative photos due to decoder stragglers. Use "
            "--allow-experimental-classifier-batch-size to override."
        )

    planning_started_at = time.perf_counter()
    files = find_files(".", glob)
    current_digests = file_content_sha256_many(files)
    unreadable = [path for path, digest in current_digests.items() if digest is None]
    if unreadable:
        raise click.ClickException(
            f"Could not fingerprint {len(unreadable)} input file(s), first: {unreadable[0]}"
        )
    existing_image_paths = db.list_image_paths()
    existing_caption_paths = db.list_caption_paths()
    existing_core_paths = existing_image_paths & db.list_metadata_paths()
    uses_embeddings = model_profile in [MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID]
    # One bulk SELECT into a set, then O(1) membership checks per file.
    # Better than SELECT EXISTS per image which would be N SQLite round-trips.
    existing_embedding_paths_v2 = db.list_embedding_paths(
        model_id=Siglip2Embedder.MODEL_ID if uses_embeddings else None
    )
    existing_embedding_paths_v1 = db.list_embedding_paths(
        model_id=SiglipEmbedder.MODEL_ID if uses_embeddings else None
    )

    # Detect files that changed on disk since they were indexed and force a
    # re-index (path-presence alone would skip them forever). Only stat paths
    # already in the DB — new files are handled by the loop below.
    indexed_paths = (
        existing_image_paths | existing_embedding_paths_v1 | existing_embedding_paths_v2
    )
    file_set = set(files)
    current_signatures = {}
    for path in indexed_paths & file_set:
        sig = file_signature(path)
        if sig is not None:
            current_signatures[path] = sig
    changed_paths, signatures_to_backfill = compute_reindex_plan(
        indexed_paths & file_set, db.list_file_signatures(), current_signatures
    )
    if changed_paths:
        log(
            f"Detected {len(changed_paths)} legacy mtime/size change(s); "
            "stage provenance takes precedence once present"
        )

    states = db.get_pipeline_states()
    desired_caption_version = caption_pipeline_version(
        classifier_backend,
        classifier_model_id,
        classifier_quantization,
        classifier_batch_size,
        classifier_max_new_tokens,
        classifier_batch_max_new_tokens,
    )
    desired_embedding_versions = {
        SIGLIP_V1_STAGE: embedding_pipeline_version(SiglipEmbedder.MODEL_ID),
        SIGLIP_V2_STAGE: embedding_pipeline_version(Siglip2Embedder.MODEL_ID),
    }

    def stage_needs_refresh(
        path: str, stage: str, version: str, artifact_exists: bool
    ) -> bool:
        if not artifact_exists:
            return True
        state = states.get((path, stage))
        if state is None:
            # Legacy rows have no stage provenance. Core and embedding output is
            # reproducible from the pinned pipeline/model, so preserving them as an
            # imported baseline is safe: legacy mtime/size signatures are often
            # invalidated by a restore or metadata-only copy and cannot prove
            # whether model input changed. From this import onward SHA-256 +
            # pipeline version is authoritative.
            #
            # Captions are the exception and must be regenerated. A legacy caption
            # may have come from the retired four-field v1 prompt, whose output is
            # a different shape to the current two-field contract, and nothing in
            # the row proves which prompt produced it. Importing it under the
            # current version would assert provenance we cannot demonstrate, and
            # `validate` could never catch it because the claimed version is by
            # construction the expected one.
            return stage == CAPTION_STAGE
        digest, stored_version, _model_id = state
        return digest != current_digests[path] or stored_version != version

    work_items = []
    for file_path in files:
        has_core = file_path in existing_core_paths
        has_caption = file_path in existing_caption_paths
        has_embedding_v2 = file_path in existing_embedding_paths_v2
        has_embedding_v1 = file_path in existing_embedding_paths_v1
        uses_classifier = model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID]
        needs_core = uses_classifier and stage_needs_refresh(
            file_path, CORE_STAGE, CORE_PIPELINE_VERSION, has_core
        )
        needs_classifier = uses_classifier and stage_needs_refresh(
            file_path, CAPTION_STAGE, desired_caption_version, has_caption
        )
        needs_embedding_v2 = uses_embeddings and stage_needs_refresh(
            file_path,
            SIGLIP_V2_STAGE,
            desired_embedding_versions[SIGLIP_V2_STAGE],
            has_embedding_v2,
        )
        needs_embedding_v1 = uses_embeddings and stage_needs_refresh(
            file_path,
            SIGLIP_V1_STAGE,
            desired_embedding_versions[SIGLIP_V1_STAGE],
            has_embedding_v1,
        )

        if needs_core or needs_classifier or needs_embedding_v2 or needs_embedding_v1:
            work_items.append(
                {
                    "path": file_path,
                    "source_sha256": current_digests[file_path],
                    "caption_version": desired_caption_version,
                    "caption_model_id": classifier_model_id
                    or (
                        JANUS_MODEL_ID
                        if classifier_backend == CLASSIFIER_BACKEND_JANUS
                        else None
                    ),
                    "needs_core": needs_core,
                    "needs_classifier": needs_classifier,
                    "needs_embedding_v2": needs_embedding_v2,
                    "needs_embedding_v1": needs_embedding_v1,
                }
            )

    if not dry_run:
        # Import unchanged legacy artifacts into the provenance table. Changed
        # rows remain unmarked until their selected stage succeeds, so a partial
        # profile cannot make another stale stage look current.
        with db.transaction() as cur:
            for path in files:
                digest = current_digests[path]
                if path in existing_core_paths:
                    if (path, CORE_STAGE) not in states:
                        db.upsert_pipeline_state(
                            path,
                            CORE_STAGE,
                            digest,
                            CORE_PIPELINE_VERSION,
                            cur=cur,
                        )
                    # Legacy captions are deliberately not imported: their prompt
                    # generation is unknowable, so they are re-captioned instead
                    # and get their provenance from that run. Stamping them here
                    # would claim the current version for v1-shaped output.
                if (
                    path in existing_embedding_paths_v1
                    and (path, SIGLIP_V1_STAGE) not in states
                ):
                    db.upsert_pipeline_state(
                        path,
                        SIGLIP_V1_STAGE,
                        digest,
                        desired_embedding_versions[SIGLIP_V1_STAGE],
                        SiglipEmbedder.MODEL_ID,
                        cur=cur,
                    )
                if (
                    path in existing_embedding_paths_v2
                    and (path, SIGLIP_V2_STAGE) not in states
                ):
                    db.upsert_pipeline_state(
                        path,
                        SIGLIP_V2_STAGE,
                        digest,
                        desired_embedding_versions[SIGLIP_V2_STAGE],
                        Siglip2Embedder.MODEL_ID,
                        cur=cur,
                    )
        db.upsert_file_signatures(signatures_to_backfill)
    planning_ms = (time.perf_counter() - planning_started_at) * 1000

    skipped = len(files) - len(work_items)
    log(
        f"Found {len(files)} files ({len(work_items)} to index, {skipped} already indexed) — profile: {model_profile}"
    )
    log(f"(skipping {skipped} already-indexed)")
    log(f"Analysing {len(work_items)} files needing work")
    if model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID]:
        log(f"Classifier backend: {classifier_backend}")

    if not dry_run and len(work_items) > 0:
        log_gpu_status()
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        # GPU work runs ONE model at a time: each pass loads its model, runs all its
        # batches, then releases the weights before the next pass loads. On a 10GB
        # card this keeps peak VRAM at ~one model instead of all three (which spills
        # to slow shared system memory under WSL2). Order: Janus → SigLIP v1 → v2.
        classifier = None
        model_init_ms = 0.0
        inference_stage_durations: dict[str, typing.Any] = {}

        # Kick off colour extraction in a background thread pool before GPU work starts.
        # fast_colorthief (Rust) releases the GIL, so it runs truly in parallel with
        # CUDA kernels on the GPU — ~2.7 min of CPU work becomes effectively free.
        #
        # The first palette is computed synchronously on THIS (main) thread to warm
        # fast_colorthief's first-call lazy imports — PIL's JPEG plugin, numpy's
        # C-API, and the Rust backend extension. Done inside a worker thread, those
        # imports race against the main thread's own runtime imports (the Janus
        # modules and the trust_remote_code modeling code loaded by init_model) and
        # deadlock CPython's per-module import locks: every thread parks in
        # futex_wait forever, looking like a frozen "Loading…" with an idle GPU.
        # Warming them single-threaded means worker threads only hit the import
        # fast-path and never block. (This is an import-lock hang, not GPU/VRAM.)
        all_paths = [item["path"] for item in work_items if item["needs_core"]]
        colors_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=COLORTHIEF_WORKERS
        )

        def abort_colour_extraction() -> None:
            colors_executor.shutdown(wait=False, cancel_futures=True)

        colors_started_at = time.perf_counter()
        color_futures: dict[str, concurrent.futures.Future] = {}
        color_failed_paths: set[str] = set()
        for color_index, path in enumerate(all_paths):
            if color_index == 0:
                warm_future: concurrent.futures.Future = concurrent.futures.Future()
                # A corrupt first image must not abort the run before it starts;
                # the lazy imports this warms are triggered by the attempt itself,
                # so an empty palette is a safe fallback.
                try:
                    warm_future.set_result(extract_colour_palette(path))
                except Exception as err:
                    log(f"Colour extraction failed for {path}: {err}")
                    color_failed_paths.add(path)
                    warm_future.set_result([])
                color_futures[path] = warm_future
            else:
                color_futures[path] = colors_executor.submit(
                    extract_colour_palette, path
                )
        log(
            f"Colour extraction started in background ({len(all_paths)} images, {COLORTHIEF_WORKERS} threads)"
        )

        # ---- Pass 1: Janus captions ----
        # Parsed captions are committed after each inference batch. A later model
        # failure can therefore resume without retaining every caption in memory.
        precomputed_captions: dict[str, Mapping] = {}
        completed_caption_paths: set[str] = set()
        caption_generation_metrics: list[dict[str, typing.Any]] = []
        minimum_free_vram_gb: Optional[float] = None
        if any(item["needs_classifier"] for item in work_items):
            classifier = create_classifier(
                backend=classifier_backend,
                model_id=classifier_model_id,
                quantization=classifier_quantization,
                batch_size=classifier_batch_size,
                max_new_tokens=classifier_max_new_tokens,
                batch_max_new_tokens=classifier_batch_max_new_tokens,
                gpu_headroom_gb=classifier_gpu_headroom_gb,
                low_impact=classifier_low_impact,
            )
            load_started_at = time.perf_counter()
            try:
                classifier.init_model()
            except BaseException:
                classifier.release()
                abort_colour_extraction()
                raise
            model_init_ms += (time.perf_counter() - load_started_at) * 1000
            log_vram(f"{classifier.backend} load")
            classifier_paths = [
                item["path"] for item in work_items if item["needs_classifier"]
            ]
            resolved_batch_size = resolved_classifier_batch_size
            total_batches = math.ceil(len(classifier_paths) / resolved_batch_size)
            log(
                f"Running {classifier.backend} captions in batches of {resolved_batch_size} ({len(classifier_paths)} images, {total_batches} batch(es))..."
            )
            batch_started_at = time.perf_counter()
            for batch_index, batch_start in enumerate(
                range(0, len(classifier_paths), resolved_batch_size), start=1
            ):
                batch_paths = classifier_paths[
                    batch_start : batch_start + resolved_batch_size
                ]
                log(
                    f"  {classifier.backend} batch {batch_index}/{total_batches} starting ({len(batch_paths)} images)..."
                )
                single_started_at = time.perf_counter()
                # Captions are pixel-grounded. Location is indexed separately by
                # the core stage and must not leak into visual descriptions.
                batch_geocodes = [None] * len(batch_paths)
                with heartbeat(
                    f"{classifier.backend} batch {batch_index}/{total_batches}"
                ):
                    try:
                        batch_results, batch_metrics = predict_caption_batch_resilient(
                            classifier, list(zip(batch_paths, batch_geocodes))
                        )
                    except BaseException:
                        classifier.release()
                        abort_colour_extraction()
                        raise
                free_vram_gb = enforce_vram_headroom(
                    f"{classifier.backend} batch {batch_index}/{total_batches}"
                )
                if math.isfinite(free_vram_gb):
                    minimum_free_vram_gb = (
                        free_vram_gb
                        if minimum_free_vram_gb is None
                        else min(minimum_free_vram_gb, free_vram_gb)
                    )
                # Parse (and retry malformed JSON) now, while the model is resident.
                if len(batch_results) != len(batch_paths):
                    log(
                        f"WARNING: {classifier.backend} returned {len(batch_results)} "
                        f"caption(s) for {len(batch_paths)} path(s)"
                    )
                batch_attempt_metrics: list[dict[str, typing.Any]] = []
                for position, (path, geo) in enumerate(
                    zip(batch_paths, batch_geocodes)
                ):
                    raw = (
                        batch_results[position] if position < len(batch_results) else ""
                    )
                    metric = dict(
                        batch_metrics[position] if position < len(batch_metrics) else {}
                    )
                    metric.update(
                        {
                            "path": path,
                            "pipelineVersion": desired_caption_version,
                            "attempt": metric.get("attempt", "batch"),
                        }
                    )
                    retry_metrics: list[dict[str, typing.Any]] = []
                    parsed = resolve_caption_result(
                        classifier,
                        path,
                        geo,
                        raw,
                        metric,
                        retry_metrics,
                    )
                    batch_attempt_metrics.append(metric)
                    for retry_metric in retry_metrics:
                        retry_metric.update(
                            {
                                "path": path,
                                "pipelineVersion": desired_caption_version,
                                "attempt": "single-retry",
                            }
                        )
                        batch_attempt_metrics.append(retry_metric)
                    if parsed is not None:
                        precomputed_captions[path] = parsed
                caption_generation_metrics.extend(batch_attempt_metrics)
                successful = [
                    (path, precomputed_captions[path])
                    for path in batch_paths
                    if path in precomputed_captions
                ]
                if successful or batch_attempt_metrics:
                    with db.transaction() as cur:
                        db.insert_caption_generation_metrics(
                            batch_attempt_metrics, cur=cur
                        )
                        for path, parsed in successful:
                            tags = normalise_classifier_tags(parsed)
                            db.upsert_image_fields(
                                path,
                                {
                                    "alt_text": parsed.get("alt_text"),
                                    # Clear a caption produced by the retired
                                    # subject field when refreshing this stage.
                                    "subject": None,
                                    "tags": ", ".join(tags),
                                },
                                cur=cur,
                            )
                            db.replace_tags_for_source(path, tags, "classifier", cur)
                            db.upsert_pipeline_state(
                                path,
                                CAPTION_STAGE,
                                current_digests[path],
                                desired_caption_version,
                                classifier_model_id
                                or (
                                    JANUS_MODEL_ID
                                    if classifier_backend == CLASSIFIER_BACKEND_JANUS
                                    else None
                                ),
                                cur,
                            )
                            completed_caption_paths.add(path)
                        if successful:
                            db.rebuild_tag_counts(cur)
                for path in batch_paths:
                    precomputed_captions.pop(path, None)
                done = min(batch_start + resolved_batch_size, len(classifier_paths))
                single_ms = (time.perf_counter() - single_started_at) * 1000
                log(
                    f"  {classifier.backend} batch {batch_index}/{total_batches} done in {single_ms:.0f}ms ({done}/{len(classifier_paths)} images)"
                )
            batch_ms = (time.perf_counter() - batch_started_at) * 1000
            inference_stage_durations[f"caption:{classifier.backend}"] = {
                "loadMs": round(model_init_ms, 2),
                "inferenceMs": round(batch_ms, 2),
            }
            log(f"{classifier.backend} batch inference complete in {batch_ms:.0f}ms")
            log_vram(f"{classifier.backend} inference")
            classifier.release()
            classifier = None  # free VRAM before the embedding passes load

        # ---- Embedding passes: one model resident at a time ----
        # keyed as precomputed_embeddings[path][model_id] = embedding. Order per the
        # one-model-per-pass requirement: SigLIP v1 (browser-compatible) then v2.
        precomputed_embeddings: dict[str, dict[str, list[float]]] = {}
        completed_embedding_models: dict[str, set[str]] = {}

        def persist_embedding_batch(
            model_id: str, completed: list[tuple[str, list[float]]]
        ) -> None:
            stage = (
                SIGLIP_V1_STAGE
                if model_id == SiglipEmbedder.MODEL_ID
                else SIGLIP_V2_STAGE
            )
            with db.transaction() as cur:
                for path, embedding in completed:
                    db.insert_embedding(path, model_id, embedding, cur=cur)
                    db.upsert_pipeline_state(
                        path,
                        stage,
                        current_digests[path],
                        embedding_pipeline_version(model_id),
                        model_id,
                        cur,
                    )
                    completed_embedding_models.setdefault(path, set()).add(model_id)

        if any(item["needs_embedding_v1"] for item in work_items):
            v1_paths = [
                item["path"] for item in work_items if item["needs_embedding_v1"]
            ]
            try:
                model_init_ms += run_embedding_pass(
                    SiglipEmbedder(),
                    v1_paths,
                    precomputed_embeddings,
                    persist_batch=persist_embedding_batch,
                    collect=False,
                    batch_size=embedding_batch_size,
                    timings=inference_stage_durations,
                )
            except BaseException:
                abort_colour_extraction()
                raise
        if any(item["needs_embedding_v2"] for item in work_items):
            v2_paths = [
                item["path"] for item in work_items if item["needs_embedding_v2"]
            ]
            try:
                model_init_ms += run_embedding_pass(
                    Siglip2Embedder(),
                    v2_paths,
                    precomputed_embeddings,
                    persist_batch=persist_embedding_batch,
                    collect=False,
                    batch_size=embedding_batch_size,
                    timings=inference_stage_durations,
                )
            except BaseException:
                abort_colour_extraction()
                raise

        # Collect colour results (GPU work is done; palettes are likely finished).
        precomputed_colors_by_path: dict[str, list] = {}
        colors_executor.shutdown(wait=True)
        for path, fut in color_futures.items():
            try:
                precomputed_colors_by_path[path] = fut.result()
            except Exception as err:
                # A single corrupt/truncated image must not discard the whole run;
                # skip just this image's colours (empty palette) and keep going.
                log(f"Colour extraction failed for {path}: {err}")
                color_failed_paths.add(path)
                precomputed_colors_by_path[path] = []
        colors_ms = (time.perf_counter() - colors_started_at) * 1000
        log(
            f"Colour extraction complete in {colors_ms:.0f}ms (ran concurrently with GPU)"
        )

        # Assembly carries NO live model objects (all released) — only the per-image
        # needs_classifier flag and the precomputed pass outputs. Keeping a model in
        # this tuple would pin its VRAM and defeat the release()/empty_cache above.
        assembly_items = [item for item in work_items if item["needs_core"]]
        enumerated = [
            (
                item_index,
                item["path"],
                item["needs_core"],
                False,
                None,
                precomputed_embeddings.get(item["path"]),
                precomputed_colors_by_path.get(item["path"]),
                item["source_sha256"],
                item["caption_version"],
                item["caption_model_id"],
                item["path"] not in color_failed_paths,
            )
            for item_index, item in enumerate(assembly_items)
        ]

        # Disable concurrency as it doesn't help performance on a RTX3080
        insert_durations_ms = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            start_time = time.perf_counter()
            analysis_durations_ms = []
            pending_results = []
            persisted_results = 0
            total_work_items = len(assembly_items)

            def flush_pending_results() -> None:
                nonlocal pending_results, persisted_results
                if len(pending_results) == 0:
                    return
                insert_started_at = time.perf_counter()
                insert_analysed_images_batch(db, pending_results)
                insert_durations_ms.append(
                    (time.perf_counter() - insert_started_at) * 1000
                )
                persisted_results += len(pending_results)
                log(
                    f"Committed {persisted_results}/{total_work_items} analysed image(s) to SQLite"
                )
                pending_results = []

            for i, result in enumerate(executor.map(analyse_image_worker, enumerated)):
                time_now = time.perf_counter()
                time_per_image = (time_now - start_time) / (i + 1)
                rate = 1 / time_per_image
                percent = i / float(total_work_items) * 100
                estimated_time_min = (total_work_items - i) * time_per_image / 60

                analysed = result.get("analysed")
                analysis_durations_ms.append((analysed.get("_duration") or 0) * 1000)

                tags = analysed.get("tags") or []
                tags_str = ", ".join(tags[:6]) if tags else "—"
                alt = analysed.get("alt_text") or ""
                alt_str = f" | {alt[:80]}" if alt else ""
                filename = os.path.basename(result["path"])
                log(
                    f"[{i + 1}/{total_work_items} {percent:.0f}% {rate:.2f}it/s ~{estimated_time_min:.1f}min] {filename}: {tags_str}{alt_str}"
                )
                pending_results.append(result)
                if len(pending_results) >= INSERT_CHUNK_SIZE:
                    flush_pending_results()

            # Persist tail work so reruns continue from the latest committed chunk.
            flush_pending_results()

        log(
            f"Inserted {persisted_results} core/caption row(s) in "
            f"{sum(insert_durations_ms):.0f}ms across {len(insert_durations_ms)} transaction(s)"
        )
        caption_failures = sum(
            1
            for item in work_items
            if item["needs_classifier"] and item["path"] not in completed_caption_paths
        )
        embedding_failures = sum(
            int(item["needs_embedding_v1"])
            + int(item["needs_embedding_v2"])
            - len(completed_embedding_models.get(item["path"], set()))
            for item in work_items
        )
        core_failures = sum(
            1
            for item in work_items
            if item["needs_core"] and item["path"] in color_failed_paths
        )
        if core_failures or caption_failures or embedding_failures:
            log(
                f"Incomplete stages: {core_failures} core, "
                f"{caption_failures} caption(s), "
                f"{embedding_failures} embedding(s); they remain retryable"
            )
        log_vram_peak()

        db.optimize()

        # The legacy mtime/size signature remains useful for importing old rows,
        # but only advance it once every artifact currently stored for a path has
        # matching stage provenance. A partial profile must not make untouched
        # stale stages look fresh.
        refreshed_states = db.get_pipeline_states()
        refreshed_images = db.list_image_paths()
        refreshed_captions = db.list_caption_paths()
        refreshed_v1 = db.list_embedding_paths(SiglipEmbedder.MODEL_ID)
        refreshed_v2 = db.list_embedding_paths(Siglip2Embedder.MODEL_ID)
        completed_signatures = {}
        for item in work_items:
            path = item["path"]
            digest = item["source_sha256"]
            required_stages = []
            if path in refreshed_images:
                required_stages.append(CORE_STAGE)
            if path in refreshed_captions:
                required_stages.append(CAPTION_STAGE)
            if path in refreshed_v1:
                required_stages.append(SIGLIP_V1_STAGE)
            if path in refreshed_v2:
                required_stages.append(SIGLIP_V2_STAGE)
            if all(
                refreshed_states.get((path, stage), (None, None, None))[0] == digest
                for stage in required_stages
            ):
                signature = file_signature(path)
                if signature is not None:
                    completed_signatures[path] = signature
        db.upsert_file_signatures(completed_signatures)
    else:
        model_init_ms = 0.0
        analysis_durations_ms = []
        insert_durations_ms = []
        caption_failures = 0
        embedding_failures = 0
        core_failures = 0
        inference_stage_durations = {}
        caption_generation_metrics = []
        minimum_free_vram_gb = None

    token_counts = [
        metric["tokenCount"]
        for metric in caption_generation_metrics
        if "tokenCount" in metric
    ]
    generation_summary = {
        "samples": len(caption_generation_metrics),
        "medianTokens": (
            round(statistics.median(token_counts), 2) if token_counts else 0.0
        ),
        "hitTokenLimit": sum(
            bool(metric.get("hitTokenLimit")) for metric in caption_generation_metrics
        ),
        "withoutEos": sum(
            metric.get("completedWithEos") is False
            for metric in caption_generation_metrics
        ),
        "oomFallbacks": sum(
            bool(metric.get("oomFallback")) for metric in caption_generation_metrics
        ),
        "minimumFreeVramGb": (
            round(minimum_free_vram_gb, 2) if minimum_free_vram_gb is not None else None
        ),
    }

    if not dry_run and work_items:
        stats = {
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "modelProfile": model_profile,
            "workItemCount": len(work_items),
            "coreFailures": core_failures,
            "captionFailures": caption_failures,
            "embeddingFailures": embedding_failures,
            "inferenceStages": inference_stage_durations,
            "captionGeneration": generation_summary,
            "medianAnalysisMs": (
                round(statistics.median(analysis_durations_ms), 2)
                if analysis_durations_ms
                else 0.0
            ),
        }
        stats_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ".last-index-stats.json"
        )
        with open(stats_path, "w", encoding="utf-8") as fh:
            json.dump(stats, fh, indent=2)

    if benchmark_output:
        benchmark = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "glob": glob,
            "dbPath": dbpath,
            "modelProfile": model_profile,
            "dryRun": dry_run,
            "fileCount": len(files),
            "workItemCount": len(work_items),
            "stageDurationsMs": inference_stage_durations,
            "captionGeneration": generation_summary,
            "failures": {
                "core": core_failures,
                "caption": caption_failures,
                "embedding": embedding_failures,
            },
            "durationsMs": {
                "total": round((time.perf_counter() - started_at) * 1000, 2),
                "setupTables": round(setup_ms, 2),
                "planning": round(planning_ms, 2),
                "modelInit": round(model_init_ms, 2),
                "analysisTotal": round(sum(analysis_durations_ms), 2),
                "analysisMedian": (
                    round(statistics.median(analysis_durations_ms), 2)
                    if analysis_durations_ms
                    else 0.0
                ),
                "insertTotal": round(sum(insert_durations_ms), 2),
                "insertMedian": (
                    round(statistics.median(insert_durations_ms), 2)
                    if insert_durations_ms
                    else 0.0
                ),
            },
        }
        with open(benchmark_output, "w", encoding="utf-8") as fh:
            json.dump(benchmark, fh, indent=2)
        print(f"Benchmark written to {benchmark_output}")
    if not dry_run:
        os.close(database_lock_fd)
        os.close(global_lock_fd)


def build_benchmark_sample(index_value: int) -> Mapping[str, typing.Any]:
    return {
        "exif": {"Make": "Fuji", "Model": "X100V", "Index": str(index_value)},
        "geocode": {"country": "Japan", "city": "Tokyo", "country_code": "JP"},
        "lat_deg": 35.0,
        "lng_deg": 139.0,
        "colors": [(1, 2, 3), (4, 5, 6), (7, 8, 9)],
        "tags": ["street", "night", "tokyo"],
        "alt_text": "Night street scene",
        "subject": "street",
        "embedding": [0.1, 0.2, 0.3, 0.4],
        "embedding_model_id": "benchmark-model",
        # Naive camera-local wall time, no zone suffix (matches analyse_image).
        "iso8601": "2024-01-01T00:00:00",
    }


@cli.command("benchmark-index")
@click.option("--rows", default=200, help="Synthetic analysed rows to insert per run.")
@click.option("--repeat", default=3, help="How many benchmark runs to execute.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_index(rows: int, repeat: int, output: Optional[str]):
    runs = []

    for run_index in range(repeat):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, f"benchmark-{run_index}.sqlite")
            db = Sqlite3Client(dbpath)

            setup_started_at = time.perf_counter()
            db.setup_tables()
            setup_ms = (time.perf_counter() - setup_started_at) * 1000

            insert_started_at = time.perf_counter()
            insert_durations_ms = []
            samples = [
                {
                    "path": f"../albums/benchmark/photo-{row_index}.jpg",
                    "analysed": build_benchmark_sample(row_index),
                    "write_core": True,
                    "write_caption": True,
                }
                for row_index in range(rows)
            ]
            for chunk_start in range(0, len(samples), INSERT_CHUNK_SIZE):
                chunk_started_at = time.perf_counter()
                insert_analysed_images_batch(
                    db, samples[chunk_start : chunk_start + INSERT_CHUNK_SIZE]
                )
                insert_durations_ms.append(
                    (time.perf_counter() - chunk_started_at) * 1000
                )
            insert_total_ms = (time.perf_counter() - insert_started_at) * 1000

            db.optimize()
            runs.append(
                {
                    "run": run_index + 1,
                    "setupMs": round(setup_ms, 2),
                    "insertTotalMs": round(insert_total_ms, 2),
                    "insertMedianMs": round(statistics.median(insert_durations_ms), 2),
                    "insertAverageMs": round(insert_total_ms / rows, 2),
                }
            )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": rows,
        "repeat": repeat,
        "runs": runs,
        "medianSetupMs": round(statistics.median([run["setupMs"] for run in runs]), 2),
        "medianInsertTotalMs": round(
            statistics.median([run["insertTotalMs"] for run in runs]),
            2,
        ),
        "medianInsertAverageMs": round(
            statistics.median([run["insertAverageMs"] for run in runs]),
            2,
        ),
        "medianInsertMedianMs": round(
            statistics.median([run["insertMedianMs"] for run in runs]),
            2,
        ),
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


def _benchmark_parallel_map(
    function: typing.Callable[[str], typing.Any],
    paths: list[str],
    workers: int,
) -> float:
    started_at = time.perf_counter()
    if workers == 1:
        for path in paths:
            function(path)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            list(executor.map(function, paths))
    return (time.perf_counter() - started_at) * 1000


def _benchmark_exif_path(path: str) -> None:
    with open(path, "rb") as fh:
        analyse_image(fh, path, needs_core=True, precomputed_colors=[])


def _rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    channels = []
    for component in rgb:
        value = component / 255.0
        channels.append(
            ((value + 0.055) / 1.055) ** 2.4 if value > 0.04045 else value / 12.92
        )
    red, green, blue = channels
    x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047
    y = red * 0.2126 + green * 0.7152 + blue * 0.0722
    z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883

    def pivot(value: float) -> float:
        return value ** (1 / 3) if value > 0.008856 else 7.787 * value + 16 / 116

    fx, fy, fz = pivot(x), pivot(y), pivot(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _delta_e(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    left_lab = _rgb_to_lab(left)
    right_lab = _rgb_to_lab(right)
    return math.sqrt(
        sum(
            (left_value - right_value) ** 2
            for left_value, right_value in zip(left_lab, right_lab)
        )
    )


def compare_colour_palettes(
    baseline: list[tuple[int, int, int]], candidate: list[tuple[int, int, int]]
) -> dict[str, float]:
    if not baseline or not candidate:
        return {"dominantDeltaE": math.inf, "symmetricMeanNearestDeltaE": math.inf}
    nearest = [
        min(_delta_e(colour, other) for other in candidate) for colour in baseline
    ]
    nearest.extend(
        min(_delta_e(colour, other) for other in baseline) for colour in candidate
    )
    return {
        "dominantDeltaE": _delta_e(baseline[0], candidate[0]),
        "symmetricMeanNearestDeltaE": statistics.mean(nearest),
    }


@cli.command("benchmark-colours")
@click.option("--glob", "glob_pattern", default="../albums/**/*.jpg", show_default=True)
@click.option(
    "--sample-size", default=128, type=click.IntRange(min=1), show_default=True
)
@click.option("--seed", default=29, type=int, show_default=True)
@click.option(
    "--max-dimension",
    default=COLOUR_THUMBNAIL_MAX_DIMENSION,
    type=click.IntRange(min=64),
    show_default=True,
)
@click.option(
    "--quality",
    default=COLOUR_THUMBNAIL_QUALITY,
    type=click.IntRange(min=1),
    show_default=True,
)
@click.option("--output", default=None, help="Optional JSON result path.")
def benchmark_colours(
    glob_pattern: str,
    sample_size: int,
    seed: int,
    max_dimension: int,
    quality: int,
    output: Optional[str],
):
    """Compare full-resolution and bounded-thumbnail palette cost and fidelity."""
    paths = sample_balanced_paths(
        find_files(".", glob_pattern), sample_size=sample_size, seed=seed
    )

    def run(function):
        started_at = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=COLORTHIEF_WORKERS
        ) as executor:
            palettes = list(executor.map(function, paths))
        return dict(zip(paths, palettes)), (time.perf_counter() - started_at) * 1000

    baseline, baseline_ms = run(extract_colour_palette)
    candidate, candidate_ms = run(
        lambda path: extract_thumbnail_colour_palette(path, max_dimension, quality)
    )
    comparisons = [
        compare_colour_palettes(baseline[path], candidate[path]) for path in paths
    ]
    dominant = [comparison["dominantDeltaE"] for comparison in comparisons]
    palette = [comparison["symmetricMeanNearestDeltaE"] for comparison in comparisons]
    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sampleSize": len(paths),
        "seed": seed,
        "thumbnailMaxDimension": max_dimension,
        "thumbnailQuality": quality,
        "baselineMs": round(baseline_ms, 2),
        "candidateMs": round(candidate_ms, 2),
        "speedup": round(baseline_ms / candidate_ms, 2),
        "dominantDeltaE": {
            "median": round(statistics.median(dominant), 2),
            "p95": round(
                sorted(dominant)[max(0, math.ceil(len(dominant) * 0.95) - 1)], 2
            ),
        },
        "paletteDeltaE": {
            "median": round(statistics.median(palette), 2),
            "p95": round(
                sorted(palette)[max(0, math.ceil(len(palette) * 0.95) - 1)], 2
            ),
        },
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-cpu")
@click.option("--glob", "glob_pattern", default="../albums/**/*.jpg", show_default=True)
@click.option(
    "--sample-size", default=128, type=click.IntRange(min=1), show_default=True
)
@click.option("--repeat", default=3, type=click.IntRange(min=1), show_default=True)
@click.option("--seed", default=29, type=int, show_default=True)
@click.option(
    "--hash-workers", default=1, type=click.IntRange(min=1), show_default=True
)
@click.option(
    "--exif-workers", default=1, type=click.IntRange(min=1), show_default=True
)
@click.option(
    "--colour-workers",
    default=COLORTHIEF_WORKERS,
    type=click.IntRange(min=1),
    show_default=True,
)
@click.option("--output", default=None, help="Optional JSON result path.")
def benchmark_cpu(
    glob_pattern: str,
    sample_size: int,
    repeat: int,
    seed: int,
    hash_workers: int,
    exif_workers: int,
    colour_workers: int,
    output: Optional[str],
):
    """Profile model-free indexing stages on a stable balanced photo sample."""
    discovery_started_at = time.perf_counter()
    files = find_files(".", glob_pattern)
    discovery_ms = (time.perf_counter() - discovery_started_at) * 1000
    if not files:
        raise click.ClickException("CPU benchmark glob matched no photos")
    paths = sample_balanced_paths(files, min(sample_size, len(files)), seed)
    runs = []
    for run_index in range(repeat):
        stat_ms = _benchmark_parallel_map(os.stat, paths, 1)
        hash_ms = _benchmark_parallel_map(file_content_sha256, paths, hash_workers)
        exif_ms = _benchmark_parallel_map(_benchmark_exif_path, paths, exif_workers)
        colour_ms = _benchmark_parallel_map(
            extract_colour_palette, paths, colour_workers
        )
        runs.append(
            {
                "run": run_index + 1,
                "statMs": round(stat_ms, 2),
                "sha256Ms": round(hash_ms, 2),
                "exifGeocodeAssemblyMs": round(exif_ms, 2),
                "colourMs": round(colour_ms, 2),
            }
        )

    def median(field: str) -> float:
        return round(statistics.median(run[field] for run in runs), 2)

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "glob": glob_pattern,
        "discoveredPhotos": len(files),
        "sampleSize": len(paths),
        "seed": seed,
        "repeat": repeat,
        "workers": {
            "sha256": hash_workers,
            "exif": exif_workers,
            "colour": colour_workers,
        },
        "discoveryMs": round(discovery_ms, 2),
        "median": {
            "statMs": median("statMs"),
            "sha256Ms": median("sha256Ms"),
            "exifGeocodeAssemblyMs": median("exifGeocodeAssemblyMs"),
            "colourMs": median("colourMs"),
        },
        "runs": runs,
        "paths": paths,
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-janus")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to run through Janus.",
)
@click.option("--repeat", default=3, help="How many predict runs to measure.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_janus(image_path: str, repeat: int, output: Optional[str]):
    classifier = JanusClassifier()

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {
        "city": "Singapore",
        "country": "Singapore",
    }
    runs = []

    for run_index in range(repeat):
        started_at = time.perf_counter()
        raw_output = classifier.predict(image_path, geocode)
        duration_ms = (time.perf_counter() - started_at) * 1000
        runs.append(
            {
                "run": run_index + 1,
                "durationMs": round(duration_ms, 2),
                "outputChars": len(raw_output),
            }
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "medianPredictMs": round(
            statistics.median([run["durationMs"] for run in runs]),
            2,
        ),
        "medianOutputChars": round(
            statistics.median([run["outputChars"] for run in runs]),
            2,
        ),
        "runs": runs,
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("benchmark-janus-batch")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to use (same image repeated to fill each batch).",
)
@click.option(
    "--batch-sizes",
    default="1,2,4",
    help="Comma-separated list of batch sizes to benchmark.",
)
@click.option("--repeat", default=1, help="How many runs per batch size.")
@click.option(
    "--glob",
    "glob_pattern",
    default=None,
    help="Optional representative image glob; otherwise --path is repeated.",
)
@click.option(
    "--max-new-tokens",
    default=JANUS_MAX_NEW_TOKENS,
    type=click.IntRange(min=32),
    show_default=True,
)
@click.option(
    "--batch-max-new-tokens",
    default=JANUS_BATCH_MAX_NEW_TOKENS,
    type=click.IntRange(min=32),
    show_default=True,
)
@click.option("--allow-experimental-batch-size", is_flag=True, default=False)
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_janus_batch(
    image_path: str,
    batch_sizes: str,
    repeat: int,
    glob_pattern: Optional[str],
    max_new_tokens: int,
    batch_max_new_tokens: int,
    allow_experimental_batch_size: bool,
    output: Optional[str],
):
    """Profile safe Janus batch sizes on representative images."""
    sizes = [int(s.strip()) for s in batch_sizes.split(",")]
    if any(size < 1 for size in sizes):
        raise click.ClickException("Batch sizes must be positive")
    experimental = [size for size in sizes if size > JANUS_MAX_PRODUCTION_BATCH_SIZE]
    if experimental and not allow_experimental_batch_size:
        raise click.ClickException(
            f"Batch size(s) {experimental} exceed the profiled production limit "
            f"{JANUS_MAX_PRODUCTION_BATCH_SIZE}; use "
            "--allow-experimental-batch-size to override"
        )

    paths = find_files(".", glob_pattern) if glob_pattern else [image_path]
    if not paths:
        raise click.ClickException("No benchmark images matched")
    if glob_pattern:
        paths = sample_balanced_paths(paths, max(sizes) * max(1, repeat), seed=17)

    lock_fd = acquire_single_instance_lock("janus-benchmark", global_lock=True)
    classifier = JanusClassifier(
        max_new_tokens=max_new_tokens,
        batch_max_new_tokens=batch_max_new_tokens,
    )

    init_started_at = time.perf_counter()
    try:
        classifier.init_model()
    except BaseException:
        os.close(lock_fd)
        raise
    init_ms = (time.perf_counter() - init_started_at) * 1000

    results_by_size = {}
    for batch_size in sizes:
        runs = []
        for run_index in range(repeat):
            selected_paths = [
                paths[(run_index * batch_size + index) % len(paths)]
                for index in range(batch_size)
            ]
            items = [(path, None) for path in selected_paths]
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            started_at = time.perf_counter()
            try:
                outputs = classifier.predict_batch(items)
                error = None
            except BaseException as err:
                if not is_cuda_oom(err):
                    classifier.release()
                    os.close(lock_fd)
                    raise
                outputs = []
                error = str(err)
                torch.cuda.empty_cache()
            duration_ms = (time.perf_counter() - started_at) * 1000
            ms_per_image = duration_ms / batch_size
            metrics = list(classifier.last_generation_metrics) if error is None else []
            parsed = 0
            output_details = []
            for position, raw in enumerate(outputs):
                parse_error = None
                try:
                    parse_classifier_response(raw)
                    parsed += 1
                    parse_success = True
                except (ValueError, KeyError, json.JSONDecodeError) as err:
                    parse_success = False
                    parse_error = str(err)
                output_details.append(
                    {
                        "path": selected_paths[position],
                        "outputChars": len(raw),
                        "parseSuccess": parse_success,
                        "parseError": parse_error,
                        **(metrics[position] if position < len(metrics) else {}),
                    }
                )
            runs.append(
                {
                    "run": run_index + 1,
                    "batchSize": batch_size,
                    "paths": selected_paths,
                    "totalMs": round(duration_ms, 2),
                    "msPerImage": round(ms_per_image, 2),
                    "outputChars": sum(len(o) for o in outputs),
                    "parseSuccess": parsed,
                    "tokenCounts": [metric.get("tokenCount") for metric in metrics],
                    "hitTokenLimit": sum(
                        bool(metric.get("hitTokenLimit")) for metric in metrics
                    ),
                    "withoutEos": sum(
                        metric.get("completedWithEos") is False for metric in metrics
                    ),
                    "outputs": output_details,
                    "peakAllocatedGb": (
                        round(torch.cuda.max_memory_allocated() / 1e9, 3)
                        if torch.cuda.is_available()
                        else None
                    ),
                    "peakReservedGb": (
                        round(torch.cuda.max_memory_reserved() / 1e9, 3)
                        if torch.cuda.is_available()
                        else None
                    ),
                    "error": error,
                }
            )
        successful_runs = [run for run in runs if run["error"] is None]
        median_ms_per_image = (
            statistics.median(run["msPerImage"] for run in successful_runs)
            if successful_runs
            else math.inf
        )
        results_by_size[batch_size] = {
            "runs": runs,
            "medianMsPerImage": (
                round(median_ms_per_image, 2)
                if math.isfinite(median_ms_per_image)
                else None
            ),
        }
        if math.isfinite(median_ms_per_image):
            print(f"batch={batch_size}: median {median_ms_per_image:.0f}ms/image")
        else:
            print(f"batch={batch_size}: no successful runs")

    single_median = (
        results_by_size[1]["medianMsPerImage"] if 1 in results_by_size else None
    )
    speedups = {}
    if single_median:
        for size, data in results_by_size.items():
            if data["medianMsPerImage"]:
                speedups[size] = round(single_median / data["medianMsPerImage"], 2)

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "path": image_path,
        "glob": glob_pattern,
        "repeat": repeat,
        "maxNewTokens": max_new_tokens,
        "batchMaxNewTokens": batch_max_new_tokens,
        "initMs": round(init_ms, 2),
        "resultsByBatchSize": results_by_size,
        "speedupVsSingle": speedups,
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")
    classifier.release()
    os.close(lock_fd)


@cli.command("benchmark-caption-quality")
@click.option(
    "--fixture",
    default=str(Path(__file__).with_name("caption-quality-benchmark.json")),
    show_default=True,
    help="Frozen caption-quality fixture JSON.",
)
@click.option("--batch-size", default=JANUS_BATCH_SIZE, type=click.IntRange(min=1))
@click.option(
    "--output",
    default=".caption-quality-benchmark-result.json",
    show_default=True,
    help="Result artifact written on both pass and failure.",
)
def benchmark_caption_quality(fixture: str, batch_size: int, output: str):
    """Run the frozen semantic caption smoke set with production generation."""
    with open(fixture, "r", encoding="utf-8") as fh:
        fixture_payload = json.load(fh)
    cases = fixture_payload.get("cases", [])
    if not cases:
        raise click.ClickException("Caption quality fixture has no cases")
    missing = [
        str(case.get("path")) for case in cases if not os.path.isfile(case["path"])
    ]
    if missing:
        raise click.ClickException(
            f"Caption quality fixture path does not exist: {missing[0]}"
        )
    if batch_size > JANUS_MAX_PRODUCTION_BATCH_SIZE:
        raise click.ClickException(
            f"Quality benchmark batch size exceeds production limit "
            f"{JANUS_MAX_PRODUCTION_BATCH_SIZE}"
        )

    lock_fd = acquire_single_instance_lock("caption-quality", global_lock=True)
    classifier = JanusClassifier(batch_size=batch_size)
    captions: dict[str, Mapping[str, typing.Any]] = {}
    metrics: list[dict[str, typing.Any]] = []
    started_at = time.perf_counter()
    try:
        classifier.init_model()
        paths = [str(case["path"]) for case in cases]
        for batch_start in range(0, len(paths), batch_size):
            batch_paths = paths[batch_start : batch_start + batch_size]
            raw_results, batch_metrics = predict_caption_batch_resilient(
                classifier, [(path, None) for path in batch_paths]
            )
            for position, path in enumerate(batch_paths):
                raw = raw_results[position] if position < len(raw_results) else ""
                metric = dict(
                    batch_metrics[position] if position < len(batch_metrics) else {}
                )
                retries: list[dict[str, typing.Any]] = []
                parsed = resolve_caption_result(
                    classifier, path, None, raw, metric, retries
                )
                metric["path"] = path
                metrics.append(metric)
                metrics.extend({**retry, "path": path} for retry in retries)
                if parsed is not None:
                    captions[path] = parsed
    finally:
        classifier.release()
        os.close(lock_fd)

    evaluation = evaluate_caption_quality_cases(cases, captions)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fixtureVersion": fixture_payload.get("version"),
        "pipelineVersion": caption_pipeline_version(CLASSIFIER_BACKEND_JANUS),
        "durationMs": round((time.perf_counter() - started_at) * 1000, 2),
        "generationMetrics": metrics,
        **evaluation,
    }
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    log(
        f"Caption quality: {evaluation['passedCases']}/{evaluation['totalCases']} passed; "
        f"result written to {output}"
    )
    if not evaluation["passed"]:
        failures = [
            result["path"] for result in evaluation["cases"] if not result["passed"]
        ]
        raise click.ClickException(
            f"Caption quality benchmark failed for {len(failures)} case(s): "
            + ", ".join(failures)
        )


@cli.command("caption-metrics")
@click.option("--dbpath", required=True, help="Staging SQLite database.")
@click.option("--pipeline-version", default=None, help="Optional exact version filter.")
@click.option("--limit", default=10, type=click.IntRange(min=1), show_default=True)
@click.option("--output", default=None, help="Optional JSON report path.")
def caption_metrics(
    dbpath: str, pipeline_version: Optional[str], limit: int, output: Optional[str]
):
    """Summarise durable caption generation timings and failure signals."""
    db = Sqlite3Client(dbpath, read_only=True)
    try:
        if not db.table_exists("caption_generation_metrics"):
            raise click.ClickException("Database has no caption generation metrics")
        where = "WHERE pipeline_version = ?" if pipeline_version else ""
        params = (pipeline_version,) if pipeline_version else ()
        rows = db.con.execute(
            "SELECT path, pipeline_version, attempt, batch_size, max_new_tokens, "
            "token_count, completed_with_eos, completed_with_json, completed_with_schema, "
            "hit_token_limit, parse_success, decode_ms, processor_ms, vision_preparation_ms, "
            "generate_batch_ms "
            f"FROM caption_generation_metrics {where}",
            params,
        ).fetchall()
        if not rows:
            raise click.ClickException("No caption generation metrics matched")
        generate_times = [row[14] for row in rows if row[14] is not None]
        report = {
            "attempts": len(rows),
            "paths": len({row[0] for row in rows}),
            "withoutEos": sum(row[6] == 0 for row in rows),
            "completedWithJson": sum(row[7] == 1 for row in rows),
            "completedWithSchema": sum(row[8] == 1 for row in rows),
            "hitTokenLimit": sum(row[9] == 1 for row in rows),
            "parseFailures": sum(row[10] == 0 for row in rows),
            "medianGenerateBatchMs": (
                round(statistics.median(generate_times), 2) if generate_times else None
            ),
            "slowest": [
                {
                    "path": row[0],
                    "pipelineVersion": row[1],
                    "attempt": row[2],
                    "batchSize": row[3],
                    "tokenCount": row[5],
                    "generateBatchMs": row[14],
                }
                for row in sorted(
                    rows,
                    key=lambda row: row[14] if row[14] is not None else -1,
                    reverse=True,
                )[:limit]
            ],
        }
    finally:
        db.con.close()
    pprint.pprint(report)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)


@cli.command("benchmark-classifier")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path to run through the classifier.",
)
@click.option(
    "--backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_JANUS,
    help="Caption classifier backend to benchmark.",
)
@click.option(
    "--model-id",
    default=None,
    help="Optional model id override for the selected backend.",
)
@click.option(
    "--quantization",
    default=None,
    help="Optional quantisation mode, for example bnb-4bit for Gemma 4.",
)
@click.option(
    "--gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
@click.option("--repeat", default=3, help="How many predict runs to measure.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_classifier(
    image_path: str,
    backend: str,
    model_id: Optional[str],
    quantization: Optional[str],
    gpu_headroom_gb: Optional[float],
    low_impact: bool,
    repeat: int,
    output: Optional[str],
):
    classifier = create_classifier(
        backend=backend,
        model_id=model_id,
        quantization=quantization,
        gpu_headroom_gb=gpu_headroom_gb,
        low_impact=low_impact,
    )

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {"city": "Singapore", "country": "Singapore"}
    runs = []
    for run_index in range(repeat):
        started_at = time.perf_counter()
        raw_output = classifier.predict(image_path, geocode)
        duration_ms = (time.perf_counter() - started_at) * 1000
        parsed = parse_classifier_response(raw_output)
        runs.append(
            {
                "run": run_index + 1,
                "durationMs": round(duration_ms, 2),
                "outputChars": len(raw_output),
                "tagCount": len(parsed.get("tags", [])),
                "altTextLength": len(parsed.get("alt_text") or ""),
            }
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "backend": backend,
        "modelId": getattr(classifier, "model_id", None),
        "quantization": getattr(classifier, "quantization", None),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "medianPredictMs": round(
            statistics.median([run["durationMs"] for run in runs]),
            2,
        ),
        "runs": runs,
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


@cli.command("compare-captioners")
@click.option("--glob", required=True, help="Glob of images to sample for comparison.")
@click.option(
    "--baseline-dbpath",
    default=None,
    help="Existing DB path to use as the baseline caption source.",
)
@click.option(
    "--sample-size",
    default=24,
    type=int,
    help="How many images to include in the comparison sample.",
)
@click.option(
    "--seed",
    default=7,
    type=int,
    help="Random seed for balanced album sampling.",
)
@click.option(
    "--candidate-backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ],
        case_sensitive=False,
    ),
    default=CLASSIFIER_BACKEND_GEMMA4,
    help="Candidate classifier backend to compare against the current baseline DB captions.",
)
@click.option(
    "--candidate-model-id",
    default=None,
    help="Optional candidate model id override.",
)
@click.option(
    "--candidate-quantization",
    default=None,
    help="Optional candidate quantisation mode.",
)
@click.option(
    "--candidate-gpu-headroom-gb",
    default=None,
    type=float,
    help="Optional GPU memory headroom to keep free for Gemma 4 by offloading part of the model to CPU.",
)
@click.option(
    "--candidate-low-impact",
    is_flag=True,
    default=False,
    help="Low-impact Gemma mode: keep some GPU memory free and prefer CPU offload for background runs.",
)
@click.option(
    "--output-json",
    default=".caption-comparison.json",
    help="JSON artifact path for the side-by-side comparison output.",
)
@click.option(
    "--output-md",
    default=".caption-comparison.md",
    help="Markdown report path for the side-by-side review summary.",
)
def compare_captioners(
    glob: str,
    baseline_dbpath: Optional[str],
    sample_size: int,
    seed: int,
    candidate_backend: str,
    candidate_model_id: Optional[str],
    candidate_quantization: Optional[str],
    candidate_gpu_headroom_gb: Optional[float],
    candidate_low_impact: bool,
    output_json: str,
    output_md: str,
):
    files = find_files(".", glob)
    sampled_paths = sample_balanced_paths(files, sample_size=sample_size, seed=seed)
    baseline_db = Sqlite3Client(baseline_dbpath) if baseline_dbpath else None

    candidate = create_classifier(
        backend=candidate_backend,
        model_id=candidate_model_id,
        quantization=candidate_quantization,
        gpu_headroom_gb=candidate_gpu_headroom_gb,
        low_impact=candidate_low_impact,
    )
    candidate.init_model()

    rows = []
    verdict_counts = {"candidate_better": 0, "neutral": 0, "baseline_better": 0}
    parse_success = 0

    for index_value, path in enumerate(sampled_paths, start=1):
        print(
            f"[{index_value}/{len(sampled_paths)}] comparing {os.path.basename(path)}"
        )
        baseline = baseline_db.get_image_row(path) if baseline_db else None
        started_at = time.perf_counter()
        candidate_raw = candidate.predict(path, None)
        duration_ms = (time.perf_counter() - started_at) * 1000
        try:
            candidate_parsed = parse_classifier_response(candidate_raw)
            parse_success += 1
            parse_error = None
        except Exception as err:
            candidate_parsed = {
                "tags": [],
                "alt_text": "",
            }
            parse_error = str(err)
        comparison = compare_caption_payloads(baseline, candidate_parsed)
        verdict_counts[comparison["verdict"]] += 1
        rows.append(
            {
                "path": path,
                "baseline": baseline,
                "candidate": {
                    "backend": candidate_backend,
                    "modelId": getattr(candidate, "model_id", None),
                    "quantization": getattr(candidate, "quantization", None),
                    "raw": candidate_raw,
                    "parsed": candidate_parsed,
                    "parseError": parse_error,
                    "durationMs": round(duration_ms, 2),
                },
                "comparison": comparison,
            }
        )

    candidate_durations = [row["candidate"]["durationMs"] for row in rows]
    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sampleSize": len(rows),
        "candidateBackend": candidate_backend,
        "candidateModelId": getattr(candidate, "model_id", None),
        "candidateQuantization": getattr(candidate, "quantization", None),
        "candidateMedianMs": (
            round(statistics.median(candidate_durations), 2)
            if candidate_durations
            else None
        ),
        "candidateParseSuccess": parse_success,
        "verdictCounts": verdict_counts,
    }

    report = {
        "summary": summary,
        "rows": rows,
    }
    with open(output_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    with open(output_md, "w", encoding="utf-8") as fh:
        fh.write(build_ab_report_markdown(summary, rows))

    pprint.pprint(summary)
    print(f"Comparison artifact written to {output_json}")
    print(f"Comparison report written to {output_md}")


@cli.command("benchmark-embedder-batch")
@click.option(
    "--path",
    "image_path",
    default="../src/test/fixtures/monkey.jpg",
    help="Image path (same image repeated to fill each batch).",
)
@click.option(
    "--model",
    default="siglip2",
    type=click.Choice(["siglip2", "siglip1"]),
    help="Which embedder to benchmark.",
)
@click.option(
    "--batch-sizes",
    default="1,2,4,8,16,32",
    help="Comma-separated list of batch sizes to benchmark.",
)
@click.option("--repeat", default=3, help="Runs per batch size.")
@click.option("--output", default=None, help="Optional JSON output file.")
def benchmark_embedder_batch(
    image_path: str, model: str, batch_sizes: str, repeat: int, output: Optional[str]
):
    """Compare single-image vs batched SigLIP embedding throughput."""
    embedder = Siglip2Embedder() if model == "siglip2" else SiglipEmbedder()

    init_started_at = time.perf_counter()
    embedder.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    sizes = [int(s.strip()) for s in batch_sizes.split(",")]
    results_by_size = {}

    # Warm up GPU before measuring
    embedder.predict_image_embeddings_batch([image_path])

    for batch_size in sizes:
        paths = [image_path] * batch_size
        seq_runs = []
        batch_runs = []
        for _ in range(repeat):
            # Sequential: N individual calls
            started_at = time.perf_counter()
            for p in paths:
                embedder.predict_image_embeddings_batch([p])
            seq_ms = (time.perf_counter() - started_at) * 1000
            seq_runs.append(round(seq_ms / batch_size, 2))

            # Batched: one forward pass for all N
            started_at = time.perf_counter()
            embedder.predict_image_embeddings_batch(paths)
            batch_ms = (time.perf_counter() - started_at) * 1000
            batch_runs.append(round(batch_ms / batch_size, 2))

        seq_median = statistics.median(seq_runs)
        batch_median = statistics.median(batch_runs)
        speedup = round(seq_median / batch_median, 2) if batch_median else None
        results_by_size[batch_size] = {
            "sequentialMsPerImage": round(seq_median, 2),
            "batchedMsPerImage": round(batch_median, 2),
            "speedup": speedup,
        }
        print(
            f"batch={batch_size:2d}: seq {seq_median:.1f}ms  batched {batch_median:.1f}ms  speedup {speedup}x"
        )

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": embedder.MODEL_ID,
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "resultsByBatchSize": results_by_size,
    }
    pprint.pprint(summary)
    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


def sqlite_quick_check(dbpath: Path) -> str:
    """``PRAGMA quick_check`` output, or the driver's error for an unusable file."""
    try:
        con = sqlite3.connect(f"file:{os.path.abspath(str(dbpath))}?mode=ro", uri=True)
    except sqlite3.Error as err:
        return str(err)
    try:
        return con.execute("PRAGMA quick_check").fetchone()[0]
    except sqlite3.DatabaseError as err:
        return str(err)
    finally:
        con.close()


def prepare_staging_database(source: str, staging: str) -> str:
    """Make a staging DB that is safe to resume, seeding it from ``source``.

    Both workflows resume by reusing whatever staging file is on disk, which means
    a damaged one silently absorbs another run of GPU inference and can never be
    published. `cp` is not atomic either: an interrupted copy leaves a truncated
    file that looks exactly like a resumable staging DB, so the copy lands under a
    temporary name and is renamed in only once it verifies.

    Returns ``resumed``, ``copied``, or ``created``.
    """
    staging_path = Path(staging)
    if staging_path.exists():
        check = sqlite_quick_check(staging_path)
        if check != "ok":
            raise click.ClickException(
                f"prepare-staging: {staging} failed PRAGMA quick_check ({check}) — "
                "refusing to resume a damaged staging database. Inspect it, or "
                "remove it to seed a fresh copy from the working database."
            )
        return "resumed"

    source_path = Path(source)
    if not source_path.exists():
        return "created"

    partial = staging_path.with_suffix(staging_path.suffix + ".partial")
    partial.unlink(missing_ok=True)
    try:
        shutil.copyfile(source_path, partial)
        check = sqlite_quick_check(partial)
        if check != "ok":
            raise click.ClickException(
                f"prepare-staging: copy of {source} failed PRAGMA quick_check "
                f"({check}) — refusing to seed staging from it."
            )
        partial.replace(staging_path)
    finally:
        partial.unlink(missing_ok=True)
    return "copied"


@cli.command("prepare-staging")
@click.option("--source", required=True, help="Working database to seed from.")
@click.option("--staging", required=True, help="Staging database path.")
def prepare_staging_command(source: str, staging: str):
    outcome = prepare_staging_database(source, staging)
    if outcome == "resumed":
        log(f"Resuming existing staging database: {staging}")
    elif outcome == "copied":
        log(f"Seeded staging database {staging} from {source}")
    else:
        log(f"No working database at {source}; {staging} will be created by index")


def detect_vanished_albums(
    indexed_paths: typing.Iterable[str], files: typing.Iterable[str]
) -> dict[str, int]:
    """Album directories that hold indexed rows but now match no source files.

    Counts cannot separate an unmounted album from ordinary curation: one album
    of 100 photos out of 1480 is under 7%, which clears both the percentage guard
    here and the row-count floor in `publish`. `validate` cannot catch it either,
    because it derives its expected set from the same shrunken glob.

    The album still renders — pages are built from the album directories and treat
    the index as optional enrichment — so the loss is quiet: it drops out of text,
    facet, and semantic search and loses `colors`, leaving its map markers
    transparent. Restoring it costs GPU inference for the whole album, not a file
    copy. A whole album going to zero is the unmount signature; deleting individual
    photos leaves the album still matching.
    """
    present = {os.path.dirname(path) for path in files}
    counts: dict[str, int] = {}
    for path in indexed_paths:
        album = os.path.dirname(path)
        if album not in present:
            counts[album] = counts.get(album, 0) + 1
    return counts


@cli.command("prune")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Prune even when the glob matches zero files (e.g. every album really "
    "was removed). Without this, an empty glob is treated as a mistake — an "
    "unmounted albums directory or wrong cwd — and prune refuses to wipe the DB.",
)
def prune(glob: str, dbpath: str, dry_run: bool, force: bool):
    db = Sqlite3Client(dbpath, read_only=dry_run)
    if not dry_run:
        db.setup_tables()
    files = find_files(".", glob)
    paths = db.list_paths()
    to_delete = [p for p in paths if p not in files]

    # A glob that matches nothing (unmounted ../albums, wrong cwd, typo) would make
    # `to_delete` the ENTIRE DB — days of GPU work with no committed backup. Refuse
    # to actually delete unless --force explicitly confirms the albums really are
    # all gone. A dry run is harmless, so it still reports what would happen.
    if len(files) == 0 and not force and not dry_run:
        raise click.ClickException(
            f"prune: glob {glob!r} matched 0 files — refusing to delete all "
            f"{len(to_delete)} row(s) from {dbpath}. If every album really was "
            f"removed, re-run with --force."
        )
    if paths and len(to_delete) > len(paths) * 0.1 and not force and not dry_run:
        raise click.ClickException(
            f"prune: would delete {len(to_delete)}/{len(paths)} indexed path(s) "
            f"({len(to_delete) / len(paths):.0%}) — refusing a large partial prune. "
            "Check the album mount/glob, or re-run with --force if intentional."
        )

    vanished = detect_vanished_albums(paths, files)
    if vanished and not force and not dry_run:
        summary = ", ".join(
            f"{album} ({count} row(s))" for album, count in sorted(vanished.items())
        )
        raise click.ClickException(
            f"prune: {len(vanished)} album(s) hold indexed rows but now match no "
            f"source files: {summary}. A single unmounted or renamed album can sit "
            "far below the percentage guard above while still dropping every one of "
            "its photos from the published index. Check the album mount/glob, or "
            "re-run with --force if those albums really were removed."
        )

    if dry_run:
        log(f"prune: {len(to_delete)} row(s) would be deleted from {dbpath}")
        pprint.pprint(to_delete)
    else:
        lock_fd = acquire_single_instance_lock(dbpath)
        log(f"prune: deleting {len(to_delete)} row(s) from {dbpath}")
        db.delete_paths(to_delete)
        for p in to_delete:
            pprint.pprint(f"deleted from db {p}")
        log(f"prune: deleted {len(to_delete)} row(s) from {dbpath}")
        # Leave a single-file, delete-journal database ready for publication.
        db.finalize_journal_mode()
        os.close(lock_fd)


def validate_index_database(
    dbpath: str,
    glob: str,
    model_profile: str,
    classifier_backend: str = CLASSIFIER_BACKEND_JANUS,
    classifier_model_id: Optional[str] = None,
    classifier_quantization: Optional[str] = None,
    classifier_batch_size: Optional[int] = None,
    classifier_max_new_tokens: Optional[int] = None,
    classifier_batch_max_new_tokens: Optional[int] = None,
) -> dict:
    """Validate exact source coverage and all published cross-table contracts."""
    expected = set(find_files(".", glob))
    if not expected:
        raise click.ClickException(f"validate: glob {glob!r} matched 0 files")

    absolute = os.path.abspath(dbpath)
    con = sqlite3.connect(f"file:{absolute}?mode=ro", uri=True)
    try:
        check = con.execute("PRAGMA quick_check").fetchone()[0]
        if check != "ok":
            raise click.ClickException(f"validate: SQLite quick_check failed: {check}")

        tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        required_tables = {"pipeline_state"}
        if model_profile in (MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID):
            required_tables.update({"images", "metadata", "image_tags", "tags"})
        missing_tables = required_tables - tables
        if missing_tables:
            raise click.ClickException(
                f"validate: missing table(s): {', '.join(sorted(missing_tables))}"
            )

        stages: list[tuple[str, str, Optional[str]]] = []
        if model_profile in (MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID):
            images = {row[0] for row in con.execute("SELECT path FROM images")}
            metadata = {row[0] for row in con.execute("SELECT path FROM metadata")}
            captions = {
                row[0]
                for row in con.execute(
                    "SELECT path FROM images WHERE COALESCE(tags, '') <> '' "
                    "OR COALESCE(alt_text, '') <> '' OR COALESCE(subject, '') <> ''"
                )
            }
            for label, actual in (
                ("images", images),
                ("metadata", metadata),
                ("captions", captions),
            ):
                if actual != expected:
                    raise click.ClickException(
                        f"validate: {label} coverage mismatch "
                        f"(missing={len(expected - actual)}, extra={len(actual - expected)})"
                    )

            stored_counts = dict(con.execute("SELECT tag, count FROM tags"))
            derived_counts = dict(
                con.execute(
                    "SELECT tag, COUNT(DISTINCT path) FROM image_tags GROUP BY tag"
                )
            )
            if stored_counts != derived_counts:
                raise click.ClickException(
                    "validate: tags counts do not match authoritative image_tags"
                )
            searchable = con.execute(
                "SELECT tag FROM image_tags WHERE source = 'classifier' "
                "ORDER BY tag LIMIT 1"
            ).fetchone()
            tag_words = re.findall(r"[A-Za-z0-9]+", searchable[0] if searchable else "")
            smoke_term = tag_words[0] if tag_words else None
            if not smoke_term:
                text_row = con.execute(
                    "SELECT COALESCE(subject, alt_text, '') FROM images "
                    "WHERE COALESCE(subject, alt_text, '') <> '' LIMIT 1"
                ).fetchone()
                words = re.findall(r"[A-Za-z0-9]+", text_row[0] if text_row else "")
                smoke_term = words[0] if words else None
            if not smoke_term:
                raise click.ClickException(
                    "validate: no searchable caption term is available for the FTS smoke test"
                )
            smoke_count = con.execute(
                "SELECT COUNT(*) FROM images WHERE images MATCH ?",
                (f'- {{path album_relative_path}} : "{smoke_term}"',),
            ).fetchone()[0]
            if smoke_count < 1:
                raise click.ClickException(
                    f"validate: FTS smoke query {smoke_term!r} returned no rows"
                )
            stages.extend(
                [
                    (CORE_STAGE, CORE_PIPELINE_VERSION, None),
                    (
                        CAPTION_STAGE,
                        caption_pipeline_version(
                            classifier_backend,
                            classifier_model_id,
                            classifier_quantization,
                            classifier_batch_size,
                            classifier_max_new_tokens,
                            classifier_batch_max_new_tokens,
                        ),
                        classifier_model_id
                        or (
                            JANUS_MODEL_ID
                            if classifier_backend == CLASSIFIER_BACKEND_JANUS
                            else None
                        ),
                    ),
                ]
            )

        if model_profile in (MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID):
            if "embeddings" not in tables:
                raise click.ClickException("validate: missing table: embeddings")
            for stage, model_id in (
                (SIGLIP_V1_STAGE, SiglipEmbedder.MODEL_ID),
                (SIGLIP_V2_STAGE, Siglip2Embedder.MODEL_ID),
            ):
                rows = con.execute(
                    "SELECT path, embedding_dim, length(embedding_blob), embedding_scale "
                    "FROM embeddings WHERE model_id = ?",
                    (model_id,),
                ).fetchall()
                actual = {row[0] for row in rows}
                if actual != expected:
                    raise click.ClickException(
                        f"validate: {model_id} coverage mismatch "
                        f"(missing={len(expected - actual)}, extra={len(actual - expected)})"
                    )
                invalid = [
                    row
                    for row in rows
                    if row[1] is None
                    or row[1] <= 0
                    or row[1] != row[2]
                    or row[3] is None
                    or row[3] <= 0
                ]
                if invalid:
                    raise click.ClickException(
                        f"validate: {model_id} has {len(invalid)} invalid vector row(s)"
                    )
                stages.append((stage, embedding_pipeline_version(model_id), model_id))

        state_rows = {
            (row[0], row[1]): (row[2], row[3], row[4])
            for row in con.execute(
                "SELECT path, stage, source_sha256, pipeline_version, model_id FROM pipeline_state"
            )
        }
        digests = file_content_sha256_many(sorted(expected))
        for stage, version, model_id in stages:
            for path in expected:
                state = state_rows.get((path, stage))
                if state is None or state[0] != digests[path]:
                    raise click.ClickException(
                        f"validate: stale or missing {stage} provenance for {path}"
                    )
                if version and state[1] != version:
                    raise click.ClickException(
                        f"validate: unexpected {stage} pipeline version for {path}"
                    )
                if model_id and state[2] != model_id:
                    raise click.ClickException(
                        f"validate: unexpected {stage} model id for {path}"
                    )

        return {"paths": len(expected), "stages": len(stages), "quickCheck": check}
    finally:
        con.close()


@cli.command("validate")
@click.option("--glob", "glob_pattern", required=True, help="Source image glob.")
@click.option("--dbpath", required=True, help="SQLite database to validate.")
@click.option(
    "--model-profile",
    type=click.Choice(
        [MODEL_PROFILE_JANUS, MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID]
    ),
    required=True,
)
@click.option(
    "--classifier-backend",
    type=click.Choice(
        [
            CLASSIFIER_BACKEND_JANUS,
            CLASSIFIER_BACKEND_GEMMA4,
            CLASSIFIER_BACKEND_GEMMA4_GGUF,
        ]
    ),
    default=CLASSIFIER_BACKEND_JANUS,
)
@click.option("--classifier-model-id", default=None)
@click.option("--classifier-quantization", default=None)
@click.option("--classifier-batch-size", default=None, type=click.IntRange(min=1))
@click.option("--classifier-max-new-tokens", default=None, type=click.IntRange(min=32))
@click.option(
    "--classifier-batch-max-new-tokens", default=None, type=click.IntRange(min=32)
)
def validate_command(
    glob_pattern: str,
    dbpath: str,
    model_profile: str,
    classifier_backend: str,
    classifier_model_id: Optional[str],
    classifier_quantization: Optional[str],
    classifier_batch_size: Optional[int],
    classifier_max_new_tokens: Optional[int],
    classifier_batch_max_new_tokens: Optional[int],
):
    summary = validate_index_database(
        dbpath,
        glob_pattern,
        model_profile,
        classifier_backend,
        classifier_model_id,
        classifier_quantization,
        classifier_batch_size,
        classifier_max_new_tokens,
        classifier_batch_max_new_tokens,
    )
    log(f"Validated {summary['paths']} path(s) across {summary['stages']} stage(s)")


PUBLISH_MIN_ROW_RATIO = 0.9


def count_table_rows(dbpath: Path, table: str) -> Optional[int]:
    """Row count for ``table``, or ``None`` when the DB or table is unavailable."""
    if not dbpath.exists():
        return None
    con = sqlite3.connect(f"file:{os.path.abspath(str(dbpath))}?mode=ro", uri=True)
    try:
        return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.Error:
        return None
    finally:
        con.close()


def assert_no_row_regression(
    candidate: Path, existing: Path, table: str, allow_shrink: bool
) -> None:
    """Refuse to replace a published DB with a substantially smaller one.

    `quick_check` only proves the generated file is structurally sound; it says
    nothing about content. Without this, publishing a fixture or a partially
    indexed DB silently destroys the live output, which has no backup once
    `rename` unlinks the old inode.
    """
    if allow_shrink:
        return
    previous = count_table_rows(existing, table)
    if not previous:
        return
    current = count_table_rows(candidate, table) or 0
    if current < previous * PUBLISH_MIN_ROW_RATIO:
        raise click.ClickException(
            f"publish: refusing to replace {existing} — {table} would go from "
            f"{previous} to {current} row(s) ({current / previous:.0%} of the "
            "published index). Re-run with --allow-shrink if this is intended."
        )


PUBLISH_JOURNAL_NAME = ".publish-journal.json"


def replace_atomically(source: Path, destination: Path) -> None:
    """Rename ``source`` onto ``destination``; atomic within a filesystem."""
    source.replace(destination)


def materialise_from(source: Path, destination: Path) -> None:
    """Atomically make ``destination`` hold ``source``'s bytes, leaving both."""
    staged = destination.with_suffix(destination.suffix + ".staged")
    staged.unlink(missing_ok=True)
    try:
        try:
            os.link(source, staged)
        except OSError:
            shutil.copyfile(source, staged)
        replace_atomically(staged, destination)
    finally:
        staged.unlink(missing_ok=True)


def write_publish_journal(
    backup_dir: Path, entries: typing.Iterable[tuple[Path, Optional[Path]]]
) -> None:
    """Record which outputs are about to move, and what to put back if they don't.

    Each rename is atomic on its own, but the pair is not, and no POSIX call can
    swap two files together. A process killed between them leaves a new core
    against old vectors, which the site silently loads as one index. The intent is
    written down first so the next publish can undo a half-applied one.
    """
    payload = {
        "outputs": [
            {"output": str(output), "backup": str(backup) if backup else None}
            for output, backup in entries
        ]
    }
    journal = backup_dir / PUBLISH_JOURNAL_NAME
    partial = journal.with_suffix(journal.suffix + ".partial")
    partial.write_text(json.dumps(payload), encoding="utf-8")
    replace_atomically(partial, journal)


def clear_publish_journal(backup_dir: Path) -> None:
    (backup_dir / PUBLISH_JOURNAL_NAME).unlink(missing_ok=True)


def restore_interrupted_publish(backup_dir: Path) -> list[str]:
    """Put back any pair left half-replaced by an interrupted publish.

    Restoring rather than rolling forward keeps one code path: the backups are by
    definition the last mutually consistent pair, whereas the half-built temporary
    files may have been cleaned up on the way out. A publish that completed but
    died before clearing its journal is restored too — harmlessly, because the
    caller re-publishes immediately afterwards.
    """
    journal = backup_dir / PUBLISH_JOURNAL_NAME
    if not journal.exists():
        return []
    try:
        payload = json.loads(journal.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        journal.unlink(missing_ok=True)
        return []

    restored: list[str] = []
    for entry in payload.get("outputs", []):
        backup = entry.get("backup")
        output = entry.get("output")
        if not backup or not output:
            continue
        backup_path, output_path = Path(backup), Path(output)
        if not backup_path.exists():
            continue
        materialise_from(backup_path, output_path)
        restored.append(output)
    journal.unlink(missing_ok=True)
    return restored


def backup_published_output(output: Path, backup_dir: Path) -> Optional[Path]:
    """Keep exactly one copy of the database about to be replaced.

    Publication replaces outputs by `rename`, which unlinks the previous inode, so
    the last good published database is otherwise unrecoverable the moment a
    publish lands. The backup deliberately lives beside the source rather than
    beside the output: `public/` is copied wholesale into the site build, so a
    backup there would be served as a multi-MB static asset.

    A hard link keeps the old inode alive at no copy cost and cannot be caught
    half-written, which matters because a truncated backup is worse than none.
    Publish only ever replaces outputs by rename, so the surviving link can never
    be written through. `--core-output` may point at another filesystem, where
    linking is impossible, so fall back to a copy staged under a temporary name.
    """
    if not output.exists():
        return None
    backup = backup_dir / f"published-{output.name}.bak"
    backup.unlink(missing_ok=True)
    try:
        os.link(output, backup)
    except OSError:
        partial = backup.with_suffix(backup.suffix + ".partial")
        partial.unlink(missing_ok=True)
        try:
            shutil.copyfile(output, partial)
            partial.replace(backup)
        finally:
            partial.unlink(missing_ok=True)
    return backup


def publish_index_databases(
    source_dbpath: str,
    embeddings_output: str,
    core_output: Optional[str] = None,
    allow_shrink: bool = False,
    backup_dir: Optional[str] = None,
) -> None:
    """Create compact publication DBs and replace outputs only after validation."""
    backup_root = (
        Path(backup_dir) if backup_dir else Path(source_dbpath).resolve().parent
    )
    for repaired in restore_interrupted_publish(backup_root):
        log(f"Repaired {repaired} from a previously interrupted publish")

    source = sqlite3.connect(f"file:{os.path.abspath(source_dbpath)}?mode=ro", uri=True)
    outputs: list[tuple[Path, Path, str]] = []
    temporaries: list[Path] = []
    try:
        if core_output:
            core_path = Path(core_output)
            core_tmp = core_path.with_suffix(core_path.suffix + ".tmp")
            temporaries.append(core_tmp)
            core_tmp.unlink(missing_ok=True)
            core = sqlite3.connect(core_tmp)
            source.backup(core)
            core.execute("DROP TABLE IF EXISTS embeddings")
            for build_only_table in (
                "file_signatures",
                "pipeline_state",
                "schema_migrations",
                "image_tags",
                "caption_generation_metrics",
            ):
                core.execute(f"DROP TABLE IF EXISTS {build_only_table}")
            core.execute("VACUUM")
            if core.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise click.ClickException(
                    "publish: generated core DB failed quick_check"
                )
            core.close()
            outputs.append((core_tmp, core_path, "images"))

        embeddings_path = Path(embeddings_output)
        embeddings_tmp = embeddings_path.with_suffix(embeddings_path.suffix + ".tmp")
        temporaries.append(embeddings_tmp)
        embeddings_tmp.unlink(missing_ok=True)
        embeddings = sqlite3.connect(embeddings_tmp)
        embeddings.execute("PRAGMA page_size=4096")
        embeddings.execute(EMBEDDINGS_TABLE_SQL)
        rows = source.execute(
            "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale FROM embeddings"
        )
        embeddings.executemany(
            "INSERT INTO embeddings(path, model_id, embedding_dim, embedding_blob, embedding_scale) "
            "VALUES (?, ?, ?, ?, ?)",
            rows,
        )
        embeddings.commit()
        embeddings.execute("VACUUM")
        if embeddings.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise click.ClickException(
                "publish: generated embeddings DB failed quick_check"
            )
        embeddings.close()
        outputs.append((embeddings_tmp, embeddings_path, "embeddings"))

        # Both outputs are fully built and checked before any rename, so a failure
        # here leaves the published pair untouched rather than half-replaced.
        for temporary, output, table in outputs:
            assert_no_row_regression(temporary, output, table, allow_shrink)

        backups: list[tuple[Path, Optional[Path]]] = []
        for _temporary, output, _table in outputs:
            backup = backup_published_output(output, backup_root)
            if backup:
                log(f"Kept the replaced {output.name} at {backup}")
            backups.append((output, backup))

        # The renames are atomic individually but not as a pair, and the site
        # loads both databases as one index. Journal the intent so a process
        # killed midway is repaired by the next publish, and undo in process for
        # any failure we do get to see.
        write_publish_journal(backup_root, backups)
        try:
            for temporary, output, _table in outputs:
                replace_atomically(temporary, output)
        except BaseException:
            for output, backup in backups:
                if backup and backup.exists():
                    materialise_from(backup, output)
            raise
        clear_publish_journal(backup_root)
    finally:
        source.close()
        # A failed publish must not leave a multi-MB .tmp behind: `public/` is
        # copied wholesale into the site build, so leftovers ship as assets. On
        # success these have already been renamed away.
        for temporary in temporaries:
            temporary.unlink(missing_ok=True)


@cli.command("publish")
@click.option("--dbpath", required=True, help="Validated source database.")
@click.option("--core-output", default=None, help="Optional core DB output path.")
@click.option("--embeddings-output", required=True, help="Embeddings DB output path.")
@click.option(
    "--allow-shrink",
    is_flag=True,
    help="Permit publishing a substantially smaller index than the live one.",
)
@click.option(
    "--backup-dir",
    default=None,
    help="Where to keep the replaced databases. Defaults to the source DB's "
    "directory; never inside public/, which ships as static assets.",
)
def publish_command(
    dbpath: str,
    core_output: Optional[str],
    embeddings_output: str,
    allow_shrink: bool,
    backup_dir: Optional[str],
):
    publish_index_databases(
        dbpath, embeddings_output, core_output, allow_shrink, backup_dir
    )
    log("Published validated SQLite output(s)")


@cli.command("backfill")
@click.option("--dbpath", required=True, help="sqlite database path to backfill.")
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Report what would change without writing.",
)
def backfill(dbpath: str, dry_run: bool):
    """Backfill structured geocodes and authoritative per-image tag relations.

    This is pure CPU work. Explicit ``schema_migrations`` state makes the
    operation idempotent even when a gallery has no geotagged photos.
    """
    if not dry_run:
        lock_fd = acquire_single_instance_lock(dbpath)
    db = Sqlite3Client(dbpath, read_only=dry_run)

    # Explicit migration state is reliable for galleries with no GPS rows and
    # for partially populated databases; data presence is not a migration marker.
    already_backfilled = db.table_exists("schema_migrations") and bool(
        db.con.execute(
            "SELECT 1 FROM schema_migrations WHERE version = ?",
            (STRUCTURED_GEOCODE_MIGRATION,),
        ).fetchone()
    )

    rows = db.con.execute("SELECT path, lat_deg, lng_deg FROM metadata").fetchall()
    image_rows = db.con.execute("SELECT path, tags FROM images").fetchall()
    geocodable = sum(1 for _, lat, lng in rows if lat is not None and lng is not None)

    if dry_run:
        log(
            f"backfill (dry run): would geocode {geocodable}/{len(rows)} row(s), "
            f"migration: {'skip (already applied)' if already_backfilled else 'apply'}, "
            f"in {dbpath}"
        )
        return

    db.setup_tables()  # adds geo_* columns / file_signatures table if missing

    if not already_backfilled:
        with db.transaction() as cur:
            for path, tags_blob in image_rows:
                db.replace_tags_for_source(
                    path, split_tag_text(tags_blob), "classifier", cur
                )
            for path, lat_deg, lng_deg in rows:
                if lat_deg is None or lng_deg is None:
                    continue
                full_geo = get_image_geocode(lat_deg, lng_deg)
                db.update_geocode_columns(path, geocode_columns(full_geo), cur=cur)
                db.replace_tags_for_source(
                    path,
                    [
                        value
                        for value in (
                            full_geo.get("country"),
                            full_geo.get("city"),
                            full_geo.get("country_code"),
                        )
                        if value
                    ],
                    "geocode",
                    cur,
                )
            db.rebuild_tag_counts(cur)
            db.mark_migration(STRUCTURED_GEOCODE_MIGRATION, cur)

    # Match prune/index: leave the published copy in delete journal mode with no
    # dangling -wal, so a straight file copy ships a consistent DB.
    db.finalize_journal_mode()

    log(
        f"backfill: {geocodable}/{len(rows)} row(s) geocoded, tag counts "
        f"{'rebuilt from image_tags' if not already_backfilled else 'left as-is (already backfilled)'}, "
        f"in {dbpath}"
    )
    os.close(lock_fd)


@cli.command("update-gps")
@click.option("--dbpath", required=True, help="sqlite database path to refresh.")
@click.option(
    "--match",
    default=None,
    help="Only refresh indexed paths containing this substring (e.g. an album name).",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Report what would change without writing.",
)
def update_gps(dbpath: str, match: Optional[str], dry_run: bool):
    """Refresh GPS coordinates, timestamp and geocode for already-indexed photos
    from their CURRENT EXIF, without re-running the Janus/SigLIP models.

    Use this after the geotag companion tool writes GPS into originals: it reads
    each indexed file's EXIF and updates metadata (lat/lng/iso8601/geo_*) plus the
    searchable geocode blob, then bumps the change-detection signature so a later
    full ``index`` run won't needlessly re-run the GPU models for these files.

    Paths come from the index itself (stored album-relative), so files are read
    relative to the index/ working directory exactly as at index time. This is
    pure CPU work — the same result a full re-index would produce for these
    fields, without the hours of GPU re-derivation of unchanged tags/embeddings.
    Photos whose GPS was removed have stale coordinates, searchable geocode, and
    geocode tags cleared."""
    if not dry_run:
        lock_fd = acquire_single_instance_lock(dbpath)
    db = Sqlite3Client(dbpath, read_only=dry_run)
    if not dry_run:
        db.setup_tables()

    paths = [p for p in db.list_image_paths() if match is None or match in p]
    caption_paths = db.list_caption_paths()
    embedding_paths = {
        SiglipEmbedder.MODEL_ID: db.list_embedding_paths(SiglipEmbedder.MODEL_ID),
        Siglip2Embedder.MODEL_ID: db.list_embedding_paths(Siglip2Embedder.MODEL_ID),
    }

    geotagged = 0
    updated = 0
    missing = 0
    with db.transaction() as cur:
        tags_changed = False
        for path in paths:
            if not os.path.exists(path):
                missing += 1
                continue

            with open(path, "rb") as fh:
                exif_full = get_exif(fh)
            exif = {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}

            lat = exif.get("GPS GPSLatitude")
            lng = exif.get("GPS GPSLongitude")
            lat_ref = exif.get("GPS GPSLatitudeRef")
            lng_ref = exif.get("GPS GPSLongitudeRef")

            lat_deg = None
            lng_deg = None
            geo: Mapping = {}
            if lat and lng and lat_ref and lng_ref:
                try:
                    lat_deg = convert_to_degress(lat, lat_ref)
                    lng_deg = convert_to_degress(lng, lng_ref)
                    geo = get_image_geocode(lat_deg, lng_deg)
                except (
                    ZeroDivisionError,
                    ValueError,
                    TypeError,
                    IndexError,
                    AttributeError,
                ) as err:
                    log(f"Ignoring malformed GPS coordinates for {path}: {err}")
                    lat_deg = None
                    lng_deg = None
                    geo = {}

            if lat_deg is not None and lng_deg is not None:
                geotagged += 1

            iso8601_local = (
                str(exif_full.get("EXIF DateTimeOriginal", ""))
                .replace(":", "-", 2)
                .replace(" ", "T", 1)
            ) or None
            blob, geo_cols = build_geocode_fields(geo)

            if dry_run:
                continue

            db.insert_metadata(
                path, (lat_deg, lng_deg), iso8601_local, geo_cols, cur=cur
            )
            if blob is not None:
                db.upsert_image_fields(path, {"geocode": blob}, cur=cur)
            else:
                db.upsert_image_fields(path, {"geocode": None}, cur=cur)
            db.replace_tags_for_source(
                path,
                [
                    value
                    for value in (
                        geo.get("country"),
                        geo.get("city"),
                        geo.get("country_code"),
                    )
                    if value
                ],
                "geocode",
                cur,
            )
            tags_changed = True
            digest = file_content_sha256(path)
            if digest is not None:
                db.upsert_pipeline_state(
                    path,
                    CORE_STAGE,
                    digest,
                    CORE_PIPELINE_VERSION,
                    cur=cur,
                )
                if path in caption_paths:
                    db.upsert_pipeline_state(
                        path,
                        CAPTION_STAGE,
                        digest,
                        caption_pipeline_version(CLASSIFIER_BACKEND_JANUS),
                        JANUS_MODEL_ID,
                        cur,
                    )
                for stage, model_id in (
                    (SIGLIP_V1_STAGE, SiglipEmbedder.MODEL_ID),
                    (SIGLIP_V2_STAGE, Siglip2Embedder.MODEL_ID),
                ):
                    if path in embedding_paths[model_id]:
                        db.upsert_pipeline_state(
                            path,
                            stage,
                            digest,
                            embedding_pipeline_version(model_id),
                            model_id,
                            cur,
                        )
            sig = file_signature(path)
            if sig is not None:
                db.upsert_file_signature(path, sig[0], sig[1], cur=cur)
            updated += 1

        if tags_changed:
            db.rebuild_tag_counts(cur)

    if not dry_run:
        # Match prune/index: leave the published copy in delete journal mode with
        # no dangling -wal so a straight file copy ships a consistent DB.
        db.finalize_journal_mode()

    log(
        f"update-gps: {'would refresh' if dry_run else 'refreshed'} "
        f"{len(paths) - missing if dry_run else updated} path(s), "
        f"{geotagged} with GPS, {missing} missing (match={match!r}), in {dbpath}"
    )
    if not dry_run:
        os.close(lock_fd)


@cli.command("search")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
@click.option(
    "--min-results",
    type=int,
    default=0,
    help="Exit non-zero if fewer than this many results are returned. Use as a "
    "post-build smoke test so a structurally broken FTS index fails loudly "
    "instead of silently returning nothing.",
)
def search(dbpath: str, query: str, limit: Optional[int], min_results: int):
    db = Sqlite3Client(dbpath, read_only=True)
    results = db.search(query, limit)
    pprint.pprint(results)
    if len(results) < min_results:
        raise click.ClickException(
            f"search for {query!r} returned {len(results)} result(s), "
            f"expected at least {min_results}"
        )


@cli.command("search-tags")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_tags(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath, read_only=True)
    results = db.search_tags(query, limit)
    pprint.pprint(results)


@cli.command("search-metadata")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_metadata(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath, read_only=True)
    results = db.search_metadata(query, limit)
    pprint.pprint(results)


@cli.command("dump")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
def dump(dbpath: str):
    db = Sqlite3Client(dbpath, read_only=True)
    results = db.inspect()
    pprint.pprint(results)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) == 0 or len(b) == 0 or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


@cli.command("search-similar-path")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--path", "query_path", required=True, help="Image path to query by.")
@click.option("--limit", default=10, help="Number of similar results to return.")
@click.option(
    "--model-id",
    default=None,
    help="Optional model_id filter. Defaults to the query path's stored model_id.",
)
def search_similar_path(
    dbpath: str, query_path: str, limit: int, model_id: Optional[str]
):
    db = Sqlite3Client(dbpath, read_only=True)

    base = db.get_embedding(path=query_path, model_id=model_id)
    if not base:
        pprint.pprint([])
        return

    resolved_model_id = base[1]
    base_embedding = base[3]

    candidates = db.list_embeddings(model_id=resolved_model_id)
    scored = []
    for path, _model_id, _dim, candidate_embedding in candidates:
        if path == query_path:
            continue
        score = cosine_similarity(base_embedding, candidate_embedding)
        scored.append((path, score))

    scored = sorted(scored, key=lambda x: x[1], reverse=True)[:limit]
    pprint.pprint(scored)


@cli.command("model-info")
def model_info():
    """Print the current embedding model configuration as JSON.

    The hybrid profile (production default) writes one row per photo under
    *each* listed model ID. `embeddingModelId` is retained for callers that
    only understand a single ID — it names the richer v2 model.
    """
    print(
        json.dumps(
            {
                "embeddingModelIds": [
                    SiglipEmbedder.MODEL_ID,
                    Siglip2Embedder.MODEL_ID,
                ],
                "embeddingModelId": Siglip2Embedder.MODEL_ID,
                "embeddingModelRevisions": {
                    SiglipEmbedder.MODEL_ID: SiglipEmbedder.MODEL_REVISION,
                    Siglip2Embedder.MODEL_ID: Siglip2Embedder.MODEL_REVISION,
                },
            }
        )
    )


def format_mapping(mapping: Optional[Mapping[str, str]]) -> str:
    """Formats a mapping for insertion into sqlite via a paramaterised query"""
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([f"{k}:{v}" for k, v in mapping.items()])


def format_mapping_values(mapping: Optional[Mapping[str, str]]) -> str:
    """Formats a mapping for insertion of values into sqlite via a paramaterised query"""
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([str(v) for v in mapping.values()])


# Mirror of src/util/geocode.ts cleanLines(): drop the coordinate/population
# numbers and the country-code line, leaving just the place names in order
# (city, region, subregion, …, country). Keeping this identical to the
# frontend guarantees the structured columns below always agree with the
# positional labels/counts the UI derives from the stored blob.
_GEOCODE_NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def _is_geocode_country_code(line: str) -> bool:
    return len(line) <= 3 and line == line.upper() and line.isalpha()


def clean_geocode_lines(geocode_blob: Optional[str]) -> list[str]:
    if not geocode_blob:
        return []
    lines = [line.strip() for line in geocode_blob.split("\n")]
    return [
        line
        for line in lines
        if line
        and not _GEOCODE_NUMBER_RE.match(line)
        and not _is_geocode_country_code(line)
    ]


def geocode_columns(geocode: Optional[Mapping]) -> dict:
    """Structured geocode components keyed off reverse_geocode's own fields —
    region is admin1 (``state``), subregion is admin2 (``county``) — so a facet
    matches the true admin level. reverse_geocode omits ``state``/``county``
    when they equal the city (e.g. Tokyo, whose prefecture == city), which
    correctly leaves that level empty. Deriving from keys rather than blob
    position avoids the ambiguity where, with admin1 absent (e.g. Kyoto), a
    county would otherwise slide into the region slot."""
    if not geocode:
        return {}
    city = geocode.get("city")
    country = geocode.get("country")
    if not city and not country:
        return {}
    return {
        "geo_city": city or None,
        "geo_region": geocode.get("state") or None,
        "geo_subregion": geocode.get("county") or None,
        "geo_country": country or None,
    }


def build_geocode_fields(
    geocode: Optional[Mapping],
) -> Tuple[Optional[str], dict]:
    """From a reverse_geocode dict, return the coordinate-free searchable blob
    (place names only, one per line) and the structured components for the
    metadata columns. Dropping the coordinate/population numbers from the
    searchable blob stops numeric queries (e.g. "139") matching a geocode."""
    if not geocode:
        return None, {}
    raw = format_mapping_values(geocode)
    cleaned = clean_geocode_lines(raw)
    blob = "\n".join(cleaned) if cleaned else None
    return blob, geocode_columns(geocode)


def file_content_sha256(path: str) -> Optional[str]:
    """Return a stable content fingerprint, or ``None`` when the file is unreadable.

    Stage freshness is based on bytes rather than timestamps: photo-management
    tools can preserve both mtime and size while replacing an image.
    """
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def file_content_sha256_many(
    paths: typing.Iterable[str], workers: int = FILE_HASH_WORKERS
) -> dict[str, Optional[str]]:
    """Fingerprint paths concurrently while preserving deterministic path mapping."""
    resolved_paths = list(paths)
    if workers <= 1 or len(resolved_paths) <= 1:
        return {path: file_content_sha256(path) for path in resolved_paths}
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(workers, len(resolved_paths))
    ) as executor:
        digests = executor.map(file_content_sha256, resolved_paths)
        return dict(zip(resolved_paths, digests))


def caption_pipeline_version(
    backend: str,
    model_id: Optional[str] = None,
    quantization: Optional[str] = None,
    batch_size: Optional[int] = None,
    max_new_tokens: Optional[int] = None,
    batch_max_new_tokens: Optional[int] = None,
) -> str:
    resolved_model = model_id or (
        JANUS_MODEL_ID if backend == CLASSIFIER_BACKEND_JANUS else "default"
    )
    revision = (
        JANUS_MODEL_REVISION if backend == CLASSIFIER_BACKEND_JANUS else "external"
    )
    prompt_digest = hashlib.sha256(
        (build_classifier_prompt(None)).encode("utf-8")
    ).hexdigest()[:12]
    non_default_generation = ""
    if batch_size is not None and batch_size != JANUS_BATCH_SIZE:
        non_default_generation += f":batch={batch_size}"
    resolved_single_tokens = max_new_tokens or JANUS_MAX_NEW_TOKENS
    resolved_batch_tokens = batch_max_new_tokens or JANUS_BATCH_MAX_NEW_TOKENS
    non_default_generation += (
        f":batchTokens={resolved_batch_tokens}:singleTokens={resolved_single_tokens}"
        ":jsonStop=v2"
    )
    return (
        f"{CAPTION_PROMPT_VERSION}-{prompt_digest}:{backend}:"
        f"{resolved_model}@{revision}:"
        f"{quantization or 'default'}{non_default_generation}"
    )


def embedding_pipeline_version(model_id: str) -> str:
    revisions = {
        SiglipEmbedder.MODEL_ID: SIGLIP_V1_MODEL_REVISION,
        Siglip2Embedder.MODEL_ID: SIGLIP_V2_MODEL_REVISION,
    }
    return f"image-embedding-v1:{model_id}@{revisions.get(model_id, 'external')}"


def file_signature(path: str) -> Optional[Tuple[float, int]]:
    """Cheap change-detection fingerprint: (mtime, size). Returns None if the
    file can't be stat'd. mtime is rounded to milliseconds so sub-ms float
    noise between runs doesn't read as a change; size makes an edit that keeps
    the same mtime (rare, but possible with restores) still detectable."""
    try:
        stat = os.stat(path)
    except OSError:
        return None
    return (round(stat.st_mtime, 3), stat.st_size)


def compute_reindex_plan(
    indexed_paths,
    existing_signatures: Mapping[str, Tuple[float, int]],
    current_signatures: Mapping[str, Tuple[float, int]],
):
    """Decide which already-indexed files changed on disk.

    Returns ``(changed, backfill)``:
      - ``changed``: indexed paths whose stored signature differs from the
        current one — they must be deleted and fully re-indexed.
      - ``backfill``: indexed paths with no stored signature yet (indexed
        before this feature) — adopt the current signature as the baseline
        WITHOUT re-indexing, so only genuine future edits trigger a rebuild.

    A path missing from ``current_signatures`` (gone/unreadable) is left to
    prune; it's neither changed nor backfilled here.
    """
    changed = set()
    backfill = {}
    for path in indexed_paths:
        current = current_signatures.get(path)
        if current is None:
            continue
        stored = existing_signatures.get(path)
        if stored is None:
            backfill[path] = current
        elif current != stored:
            changed.add(path)
    return changed, backfill


def find_files(directory: str, pattern: str) -> list[str]:
    """Find files from a glob pattern in a directory, ignoring case.

    ``.jpg`` and ``.jpeg`` are treated as equivalent: a pattern ending in either
    extension also matches the other. Both index and prune call this with the same
    glob, so the two stay consistent — prune sees exactly the set index writes and
    never deletes freshly-indexed ``.jpeg`` rows."""
    patterns = [pattern]
    lowered = pattern.lower()
    if lowered.endswith(".jpg"):
        patterns.append(pattern[:-4] + ".jpeg")
    elif lowered.endswith(".jpeg"):
        patterns.append(pattern[:-5] + ".jpg")

    paths: list[str] = []
    seen: set[str] = set()
    include_test_albums = (
        os.environ.get("ALBUM_INCLUDE_TEST_ALBUMS") == "1" or "test-" in pattern
    )

    def is_test_album_path(path: Path) -> bool:
        parts = path.parts
        for index, part in enumerate(parts[:-1]):
            if part == "albums" and index + 1 < len(parts):
                return parts[index + 1].startswith("test-")
        return False

    for pat in patterns:
        path_pattern = os.path.join(directory, pat)
        for p in Path(directory).glob(path_pattern, case_sensitive=False):
            if not include_test_albums and is_test_album_path(p):
                continue
            resolved = str(p)
            if resolved not in seen:
                seen.add(resolved)
                paths.append(resolved)

    if len(paths) == 0 and Path(pattern).exists():
        return [str(Path(pattern))]
    return sorted(paths)


def sample_balanced_paths(
    paths: list[str], sample_size: int, seed: int = 7
) -> list[str]:
    if sample_size <= 0 or len(paths) <= sample_size:
        return list(paths)

    rng = random.Random(seed)
    grouped: dict[str, list[str]] = {}
    for path in paths:
        group = str(Path(path).parent)
        grouped.setdefault(group, []).append(path)

    groups = list(grouped.keys())
    rng.shuffle(groups)
    for group in groups:
        rng.shuffle(grouped[group])

    sampled = []
    while len(sampled) < sample_size:
        progressed = False
        for group in groups:
            if len(sampled) >= sample_size:
                break
            if grouped[group]:
                sampled.append(grouped[group].pop())
                progressed = True
        if not progressed:
            break
    return sampled


def split_tag_text(tags: Optional[str]) -> list[str]:
    if not tags:
        return []
    return [tag.strip() for tag in tags.split(",") if tag.strip()]


def compare_caption_payloads(
    baseline: Optional[Mapping[str, typing.Any]],
    candidate: Mapping[str, typing.Any],
) -> dict[str, typing.Any]:
    baseline_tags = split_tag_text((baseline or {}).get("tags"))
    candidate_tags = normalise_classifier_tags(candidate)

    baseline_alt = (baseline or {}).get("alt_text") or ""
    candidate_alt = candidate.get("alt_text") or ""
    baseline_subject = (baseline or {}).get("subject") or ""
    candidate_subject = candidate_tags[0] if candidate_tags else ""

    shared_tags = sorted(set(baseline_tags).intersection(candidate_tags))
    added_tags = sorted(set(candidate_tags) - set(baseline_tags))
    removed_tags = sorted(set(baseline_tags) - set(candidate_tags))
    verdict = "neutral"
    reasons = []

    if len(candidate_alt.strip()) > len(baseline_alt.strip()) + 15:
        reasons.append("candidate_alt_more_specific")
    if len(candidate_alt.strip()) + 15 < len(baseline_alt.strip()):
        reasons.append("candidate_alt_shorter")
    if len(shared_tags) >= max(1, min(len(baseline_tags), len(candidate_tags)) // 2):
        reasons.append("good_tag_overlap")
    if len(shared_tags) == 0 and baseline_tags and candidate_tags:
        reasons.append("no_tag_overlap")
    if len(added_tags) >= 2:
        reasons.append("candidate_adds_tags")
    if len(removed_tags) >= max(3, len(baseline_tags) // 2):
        reasons.append("candidate_drops_many_tags")
    if candidate_subject and candidate_subject != baseline_subject:
        reasons.append("subject_changed")

    positive_signals = {
        "candidate_alt_more_specific",
        "good_tag_overlap",
        "candidate_adds_tags",
    }
    negative_signals = {
        "candidate_alt_shorter",
        "candidate_drops_many_tags",
        "no_tag_overlap",
    }
    if {
        "candidate_drops_many_tags",
        "no_tag_overlap",
    }.issubset(set(reasons)):
        verdict = "baseline_better"
    elif {
        "candidate_alt_more_specific",
        "good_tag_overlap",
    }.issubset(set(reasons)):
        verdict = "candidate_better"
    if any(reason in positive_signals for reason in reasons) and not any(
        reason in negative_signals for reason in reasons
    ):
        verdict = "candidate_better"
    elif any(reason in negative_signals for reason in reasons) and not any(
        reason in positive_signals for reason in reasons
    ):
        verdict = "baseline_better"

    return {
        "baselineTags": baseline_tags,
        "candidateTags": candidate_tags,
        "sharedTags": shared_tags,
        "addedTags": added_tags,
        "removedTags": removed_tags,
        "baselineAltLength": len(baseline_alt),
        "candidateAltLength": len(candidate_alt),
        "baselineSubject": baseline_subject,
        "candidateSubject": candidate_subject,
        "verdict": verdict,
        "reasons": reasons,
    }


def evaluate_caption_quality_cases(
    cases: list[Mapping[str, typing.Any]],
    captions: Mapping[str, Mapping[str, typing.Any]],
) -> dict[str, typing.Any]:
    """Evaluate frozen, human-reviewed concepts against structured captions."""
    results = []
    for case in cases:
        path = str(case["path"])
        caption = captions.get(path)
        if caption is None:
            results.append({**case, "passed": False, "reasons": ["no_caption"]})
            continue
        searchable = " ".join(
            [
                *[str(value) for value in caption.get("tags", [])],
                str(caption.get("alt_text", "")),
            ]
        ).casefold()
        required = [str(value).casefold() for value in case.get("requiredAny", [])]
        forbidden = [str(value).casefold() for value in case.get("forbidden", [])]
        reasons = []
        matched_required = [value for value in required if value in searchable]
        matched_forbidden = [value for value in forbidden if value in searchable]
        if required and not matched_required:
            reasons.append("missing_required_concept")
        if matched_forbidden:
            reasons.append("forbidden_concept")
        results.append(
            {
                **case,
                "passed": not reasons,
                "reasons": reasons,
                "matchedRequired": matched_required,
                "matchedForbidden": matched_forbidden,
                "caption": caption,
            }
        )
    passed = sum(bool(result["passed"]) for result in results)
    return {
        "passed": passed == len(results),
        "passedCases": passed,
        "totalCases": len(results),
        "cases": results,
    }


def build_ab_report_markdown(
    summary: Mapping[str, typing.Any], rows: list[Mapping[str, typing.Any]]
) -> str:
    lines = [
        "# Caption Comparison Report",
        "",
        f"- Generated: {summary['generatedAt']}",
        f"- Sample size: {summary['sampleSize']}",
        f"- Candidate backend: {summary['candidateBackend']}",
        f"- Candidate model: {summary['candidateModelId']}",
        f"- Candidate quantisation: {summary['candidateQuantization'] or 'none'}",
        f"- Parse success: {summary['candidateParseSuccess']}/{summary['sampleSize']}",
        f"- Median candidate runtime: {summary['candidateMedianMs']}ms",
        "",
        "## Aggregate verdict",
        "",
        f"- Candidate better: {summary['verdictCounts'].get('candidate_better', 0)}",
        f"- Neutral: {summary['verdictCounts'].get('neutral', 0)}",
        f"- Baseline better: {summary['verdictCounts'].get('baseline_better', 0)}",
        "",
        "## Notes",
        "",
        "- Treat this as a first-pass review artifact. It highlights structure, overlap, and specificity differences, but final promotion should still be based on side-by-side inspection.",
        "- Baseline rows come from the existing DB when available, so the comparison reflects current indexed captions rather than a re-run with potentially different Janus weights.",
        "",
        "## Sample rows",
        "",
    ]

    for row in rows:
        comparison = row["comparison"]
        lines.extend(
            [
                f"### {row['path']}",
                "",
                f"- Verdict: {comparison['verdict']}",
                f"- Reasons: {', '.join(comparison['reasons']) if comparison['reasons'] else 'none'}",
                f"- Candidate runtime: {row['candidate']['durationMs']}ms",
                "",
                "**Baseline**",
                "",
                f"- Subject: {(row.get('baseline') or {}).get('subject') or ''}",
                f"- Alt text: {(row.get('baseline') or {}).get('alt_text') or ''}",
                f"- Tags: {', '.join(comparison['baselineTags'])}",
                "",
                "**Candidate**",
                "",
                f"- Subject: {row['candidate']['parsed'].get('subject') or ''}",
                f"- Alt text: {row['candidate']['parsed'].get('alt_text') or ''}",
                f"- Tags: {', '.join(comparison['candidateTags'])}",
                "",
            ]
        )

    return "\n".join(lines)


def analyse_image(
    fh: IO[bytes],
    path: str,
    needs_core: bool = True,
    needs_classifier: bool = False,
    precomputed_caption: Optional[Mapping] = None,
    precomputed_embeddings: Optional[dict[str, list[float]]] = None,
    precomputed_colors: Optional[list] = None,
) -> Mapping:
    start_time = time.perf_counter()

    exif_full = get_exif(fh) if needs_core else {}
    exif = (
        filter_exif_for_search(
            {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}
        )
        if needs_core
        else {}
    )

    lat = exif.get("GPS GPSLatitude", None)
    lng = exif.get("GPS GPSLongitude", None)
    lat_ref = exif.get("GPS GPSLatitudeRef", None)
    lng_ref = exif.get("GPS GPSLongitudeRef", None)

    if lat and lng and lat_ref and lng_ref:
        # Degenerate GPS rationals (e.g. 0/0 denominators or truncated tags) raise
        # ZeroDivisionError/IndexError inside convert_to_degress. Treat them as
        # missing coordinates rather than letting one bad image abort the run.
        try:
            lat_deg = convert_to_degress(lat, lat_ref)
            lng_deg = convert_to_degress(lng, lng_ref)
            geo = get_image_geocode(lat_deg, lng_deg)
        except (
            ZeroDivisionError,
            ValueError,
            TypeError,
            IndexError,
            AttributeError,
        ) as err:
            log(f"Ignoring malformed GPS coordinates for {path}: {err}")
            lat_deg = None
            lng_deg = None
            geo = {}
    else:
        lat_deg = None
        lng_deg = None
        geo = {}

    colors = []
    if needs_core:
        colors = (
            precomputed_colors
            if precomputed_colors is not None
            else extract_colour_palette(path)
        )

    # Captions are parsed (with model retry) during the Janus pass while the model
    # is still resident; here we only consume the precomputed parsed result. The
    # per-image needs_classifier flag — not the presence of a live model — gates
    # whether classifier fields are written, so embeddings-only re-indexes of
    # already-captioned rows don't clobber their alt_text/subject/tags.
    result: Mapping = (
        precomputed_caption
        if (needs_classifier and precomputed_caption is not None)
        else {}
    )

    # Embeddings are emitted from the precomputed {model_id: vector} dict — the GPU
    # models are released before assembly, so there is no live per-image fallback.
    # Emission is driven by the dict's keys: whatever was precomputed gets written.
    embeddings = [
        {"model_id": model_id, "embedding": embedding}
        for model_id, embedding in (precomputed_embeddings or {}).items()
    ]

    # EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS" — the camera's LOCAL wall-clock
    # time, with no timezone. Convert to ISO "YYYY-MM-DDTHH:MM:SS" and store it as
    # naive camera-local wall time with NO zone suffix (do not append "Z"): a "Z"
    # would falsely claim UTC and shift every derived calendar field by the camera's
    # offset. Consumers treat metadata.iso8601 as camera-local wall time.
    # 2000:01:01 12:34:56 > 2000-01-01T12:34:56
    iso8601_local = (
        str(exif_full.get("EXIF DateTimeOriginal", ""))
        .replace(":", "-", 2)
        .replace(" ", "T", 1)
    )

    normalised_tags = normalise_classifier_tags(result)

    end_time = time.perf_counter()

    return {
        # Camera-local wall time, no zone suffix (see comment above). This key is
        # read as ``iso8601`` by both insert paths and written to metadata.iso8601.
        "iso8601": iso8601_local or None,
        "exif": exif,
        "geocode": geo,
        "lat_deg": lat_deg,
        "lng_deg": lng_deg,
        "colors": colors,
        "tags": normalised_tags,
        "alt_text": result.get("alt_text"),
        "subject": None,
        "embeddings": embeddings,
        "_duration": end_time - start_time,
    }


def analyse_image_worker(
    input: Tuple[
        int,
        str,
        str,
        Optional[str],
        bool,
        bool,
        bool,
        Optional[Mapping],
        Optional[dict],
        Optional[list],
        str,
    ],
) -> Mapping[str, typing.Any]:
    """Assemble one image's record from precomputed pass outputs (no live models).

    By the time this runs, every GPU model has been loaded, used, and released in
    its own pass — so it consumes only precomputed captions/embeddings/colours."""
    try:
        idx = input[0]
        path = input[1]
        needs_core = input[2]
        needs_classifier = input[3]
        precomputed_caption = input[4] if len(input) > 4 else None
        precomputed_embeddings = input[5] if len(input) > 5 else None
        precomputed_colors = input[6] if len(input) > 6 else None
        source_sha256 = input[7] if len(input) > 7 else ""
        caption_version = input[8] if len(input) > 8 else ""
        caption_model_id = input[9] if len(input) > 9 else None
        core_complete = input[10] if len(input) > 10 else True

        print(f"[{idx + 1}] {os.path.basename(path)}...")
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                path=path,
                needs_core=needs_core,
                needs_classifier=needs_classifier,
                precomputed_caption=precomputed_caption,
                precomputed_embeddings=precomputed_embeddings,
                precomputed_colors=precomputed_colors,
            )
            return {
                "path": path,
                "analysed": analysed,
                "write_core": needs_core,
                "write_caption": needs_classifier and precomputed_caption is not None,
                "caption_failed": needs_classifier and precomputed_caption is None,
                "source_sha256": source_sha256,
                "caption_version": caption_version,
                "caption_model_id": caption_model_id,
                "core_complete": core_complete,
            }
    except (KeyboardInterrupt, SystemExit):
        # Re-raise so Ctrl-C / SIGINT actually terminates the run. The old code
        # swallowed it and returned a malformed tuple, which both masked the
        # interrupt and crashed the downstream consumer.
        raise


def insert_analysed_images_batch(db, results: list[Mapping]):
    """Insert all analysed results in a single transaction.

    FTS5 flushes a segment merge on every COMMIT; batching all rows into one
    transaction eliminates that overhead (~63x faster than one txn per image).
    """
    with db.transaction() as cur:
        tags_changed = False
        for item in results:
            path = item["path"]
            analysed = item["analysed"]
            write_core = item.get("write_core", True)
            write_caption = item.get(
                "write_caption", item.get("used_classifier", False)
            )
            source_sha256 = item.get("source_sha256") or ""

            geocode = analysed.get("geocode")
            geocode_blob, geocode_structured = build_geocode_fields(geocode)
            image_fields = {}
            if write_core:
                image_fields.update(
                    {
                        "filename": get_filename(path),
                        "album_relative_path": get_album_relative_path(path),
                        "exif": format_mapping(analysed.get("exif")),
                        "colors": format_mapping(analysed.get("colors")),
                        # Explicitly clear a removed GPS value rather than leaving
                        # the previous searchable location behind.
                        "geocode": geocode_blob,
                    }
                )
            if write_caption:
                image_fields["alt_text"] = analysed.get("alt_text")
                image_fields["subject"] = None
                image_fields["tags"] = ", ".join(analysed.get("tags"))

            if image_fields:
                db.upsert_image_fields(path, image_fields, cur=cur)

            if write_caption:
                db.replace_tags_for_source(
                    path,
                    analysed.get("tags") or [],
                    "classifier",
                    cur,
                )
                tags_changed = True
                if source_sha256:
                    db.upsert_pipeline_state(
                        path,
                        CAPTION_STAGE,
                        source_sha256,
                        item.get("caption_version")
                        or caption_pipeline_version(CLASSIFIER_BACKEND_JANUS),
                        item.get("caption_model_id"),
                        cur,
                    )

            if write_core:
                geocode_tags = []
                if geocode:
                    geocode_tags = [
                        value
                        for value in (
                            geocode.get("country"),
                            geocode.get("city"),
                            geocode.get("country_code"),
                        )
                        if value
                    ]
                db.replace_tags_for_source(path, geocode_tags, "geocode", cur)
                tags_changed = True
                db.insert_metadata(
                    path,
                    lat_lng_deg=(analysed.get("lat_deg"), analysed.get("lng_deg")),
                    iso8601=analysed.get("iso8601"),
                    geocode=geocode_structured,
                    cur=cur,
                )
                if source_sha256 and item.get("core_complete", True):
                    db.upsert_pipeline_state(
                        path,
                        CORE_STAGE,
                        source_sha256,
                        CORE_PIPELINE_VERSION,
                        cur=cur,
                    )

            for emb in analysed.get("embeddings") or []:
                db.insert_embedding(
                    path=path,
                    model_id=emb["model_id"],
                    embedding=emb["embedding"],
                    cur=cur,
                )
                if source_sha256:
                    stage = (
                        SIGLIP_V1_STAGE
                        if emb["model_id"] == SiglipEmbedder.MODEL_ID
                        else SIGLIP_V2_STAGE
                    )
                    db.upsert_pipeline_state(
                        path,
                        stage,
                        source_sha256,
                        embedding_pipeline_version(emb["model_id"]),
                        emb["model_id"],
                        cur,
                    )

        if tags_changed:
            db.rebuild_tag_counts(cur)


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
