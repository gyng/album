import torch
import click
from pathlib import Path, PosixPath
import pprint
import fast_colorthief
import exifread
import reverse_geocode
import sqlite3
import typing
from PIL import Image
from typing import IO, Mapping, Optional, Tuple
import os
import json
import re
import math
import tempfile
import statistics
from contextlib import contextmanager

from transformers import AutoImageProcessor, AutoModel, AutoModelForCausalLM
from janus.models import MultiModalityCausalLM, VLChatProcessor
from janus.utils.io import load_pil_images

import concurrent.futures
import time


MODEL_PROFILE_JANUS = "janus"
MODEL_PROFILE_SIGLIP2 = "siglip2"
MODEL_PROFILE_HYBRID = "hybrid"
JANUS_RESPONSE_FIELDS = (
    "identified_objects",
    "themes",
    "alt_text",
    "subject",
)
JANUS_MAX_NEW_TOKENS = 192
JANUS_BATCH_SIZE = 4
EMBEDDER_BATCH_SIZE = 16
COLORTHIEF_WORKERS = 4
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


def build_janus_prompt(geocode: Optional[Mapping]) -> str:
    schema = (
        '{ "identified_objects": string[], "themes": string[], '
        '"alt_text": string, "subject": string }'
    )

    location_hint = ""
    if geocode:
        city = geocode.get("city", "")
        country = geocode.get("country", "")
        place = ", ".join([part for part in [city, country] if part])
        if place:
            location_hint = (
                f" The photo was taken near {place}. Use that only when it is visually relevant."
            )

    return (
        "<image_placeholder>Return strict JSON only. "
        "Describe the photo for search indexing using this schema: "
        f"{schema}."
        " Keep identified_objects and themes short and concrete."
        " Keep alt_text and subject concise, factual, and literal."
        " Do not return prose outside the JSON object."
        f"{location_hint}"
    )


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


def parse_janus_response(raw_result: str) -> Mapping[str, typing.Any]:
    JSON_BLOCK_PATTERN = re.compile(r"\{.*?\}", re.DOTALL | re.MULTILINE)
    blocks = JSON_BLOCK_PATTERN.findall(raw_result)

    if len(blocks) > 0:
        result = json.loads(blocks[0])
    else:
        cleaned = " ".join(raw_result.split()).strip()
        if not cleaned:
            raise ValueError("Empty Janus response")
        keywords = keywordise_text(cleaned)
        subject = cleaned.split(".")[0].strip() or cleaned[:160]
        result = {
            "identified_objects": keywords,
            "themes": [],
            "alt_text": cleaned,
            "subject": subject,
        }

    if not isinstance(result, dict):
        raise ValueError("Janus response was not an object")
    if isinstance(result.get("identified_objects"), str):
        result["identified_objects"] = [result["identified_objects"]]
    if isinstance(result.get("themes"), str):
        result["themes"] = [result["themes"]]
    for field in JANUS_RESPONSE_FIELDS:
        result[field]
    return result


def filter_exif_for_search(exif: Optional[Mapping[str, typing.Any]]) -> Mapping[str, typing.Any]:
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


class JanusClassifier:
    def init_model(self) -> None:
        print("Loading Janus-Pro-1B...")
        # use 1B for speed/lower requirements
        model_path = "deepseek-ai/Janus-Pro-1B"
        self.vl_chat_processor: VLChatProcessor = VLChatProcessor.from_pretrained(
            model_path
        )
        self.tokenizer = self.vl_chat_processor.tokenizer

        vl_gpt: MultiModalityCausalLM = AutoModelForCausalLM.from_pretrained(
            model_path, trust_remote_code=True
        )
        self.vl_gpt = vl_gpt.to(torch.bfloat16).cuda().eval()
        print("Loaded Janus-Pro-1B.")

    @torch.inference_mode()
    def predict(self, path: str, geocode: Optional[Mapping]) -> str:
        prompt = build_janus_prompt(geocode)

        conversation = [
            {
                "role": "User",
                "content": prompt,
                "images": [path],
            },
            {"role": "Assistant", "content": ""},
        ]

        # load images and prepare for inputs
        # Janus-Pro will resize images internally
        pil_images = load_pil_images(conversation)

        prepare_inputs = self.vl_chat_processor(
            conversations=conversation, images=pil_images, force_batchify=True
        ).to(self.vl_gpt.device)

        # run image encoder to get the image embeddings
        inputs_embeds = self.vl_gpt.prepare_inputs_embeds(**prepare_inputs)

        outputs = self.vl_gpt.language_model.generate(
            inputs_embeds=inputs_embeds,
            attention_mask=prepare_inputs.attention_mask,
            pad_token_id=self.tokenizer.eos_token_id,
            bos_token_id=self.tokenizer.bos_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
            max_new_tokens=JANUS_MAX_NEW_TOKENS,
            do_sample=False,
            use_cache=True,
        )

        answer = self.tokenizer.decode(
            outputs[0].cpu().tolist(), skip_special_tokens=True
        )
        return answer

    @torch.inference_mode()
    def predict_batch(self, items: list[tuple[str, Optional[Mapping]]]) -> list[str]:
        """Run Janus inference on a batch of images in one GPU forward pass."""
        if not items:
            return []
        if len(items) == 1:
            return [self.predict(items[0][0], items[0][1])]

        all_embeds = []
        all_masks = []

        for path, geocode in items:
            prompt = build_janus_prompt(geocode)
            conversation = [
                {"role": "User", "content": prompt, "images": [path]},
                {"role": "Assistant", "content": ""},
            ]
            pil_images = load_pil_images(conversation)
            prepare_inputs = self.vl_chat_processor(
                conversations=conversation, images=pil_images, force_batchify=True
            ).to(self.vl_gpt.device)
            embeds = self.vl_gpt.prepare_inputs_embeds(**prepare_inputs)
            all_embeds.append(embeds)
            all_masks.append(prepare_inputs.attention_mask)

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
            pad_token_id=self.tokenizer.eos_token_id,
            bos_token_id=self.tokenizer.bos_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
            max_new_tokens=JANUS_MAX_NEW_TOKENS,
            do_sample=False,
            use_cache=True,
        )

        return [
            self.tokenizer.decode(output.cpu().tolist(), skip_special_tokens=True)
            for output in outputs
        ]


class BaseImageEmbedder:
    MODEL_ID: str

    def init_model(self) -> None:
        self.model_id = self.MODEL_ID
        print(f"Loading image embedder {self.model_id}...")
        self.processor = AutoImageProcessor.from_pretrained(self.model_id)
        self.model = AutoModel.from_pretrained(self.model_id)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = self.model.to(self.device).eval()
        print(f"Loaded image embedder {self.model_id} on {self.device}.")

    @torch.inference_mode()
    def predict_image_embedding(self, path: str) -> list[float]:
        return self.predict_image_embeddings_batch([path])[0]

    @torch.inference_mode()
    def predict_image_embeddings_batch(self, paths: list[str]) -> list[list[float]]:
        # Thread image opens — JPEG decode releases the GIL (~2.5x vs serial for large files).
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            images = list(ex.map(lambda p: Image.open(p).convert("RGB"), paths))
        inputs = self.processor(images=images, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        features = self.model.get_image_features(**inputs)
        # Normalise for cosine similarity; store as float list for SQLite JSON.
        features = torch.nn.functional.normalize(features, p=2, dim=-1)
        return features.detach().float().cpu().tolist()


class SiglipEmbedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip-base-patch16-224"


class Siglip2Embedder(BaseImageEmbedder):
    MODEL_ID = "google/siglip2-base-patch16-224"


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
    tags = exifread.process_file(fh)
    return tags


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


# Repository for our search + metadata table
class Sqlite3Client:
    def __init__(self, db_path: typing.Union[str, bytes, os.PathLike]):
        self.con = sqlite3.connect(db_path)
        # allows for concurrent writes...? Not sure if it has any impact
        self.con.execute("PRAGMA journal_mode=WAL;")

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
            entries = len(self.inspect())
        except Exception:
            pass
        return {"version": version, "entries": entries}

    def setup_tables(self):
        cur = self.con.cursor()
        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, subject, tokenize='porter trigram')"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS tags (tag VARCHAR PRIMARY KEY, count INTEGER DEFAULT 0)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS metadata (path VARCHAR PRIMARY KEY, lat_deg REAL, lng_deg REAL, iso8601 TEXT)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS embeddings (path VARCHAR PRIMARY KEY, model_id TEXT, embedding_dim INTEGER, embedding_json TEXT)"
        )
        # Optimise loads from the browser https://github.com/phiresky/sql.js-httpvfs#readme
        cur.execute("PRAGMA journal_mode = delete;")
        cur.execute("PRAGMA page_size = 1024;")
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
        cur = self.con.cursor()
        res = cur.execute("SELECT path FROM images")
        return {row[0] for row in res.fetchall()}

    def list_embedding_paths(self, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute("SELECT path FROM embeddings")
        return {row[0] for row in res.fetchall()}

    def insert_geocode(self, path: str, geocode: str):
        self.insert_field(path, value=geocode, field="geocode")

    def inspect(self):
        cur = self.con.cursor()
        res = cur.execute("SELECT * FROM images")
        resolved = res.fetchall()
        return resolved

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

    def delete_path(self, path: str):
        cur = self.con.cursor()

        statement_images = """
        DELETE FROM images WHERE path = ?
        """
        res_images = cur.execute(
            statement_images,
            (path,),
        )

        statement_metadata = """
        DELETE FROM metadata WHERE path = ?
        """
        res_metadata = cur.execute(
            statement_metadata,
            (path,),
        )

        statement_embeddings = """
        DELETE FROM embeddings WHERE path = ?
        """
        res_embeddings = cur.execute(
            statement_embeddings,
            (path,),
        )
        cur.execute("COMMIT")

        return (res_images, res_metadata, res_embeddings)

    def search(
        self, query: str, limit: Optional[int] = 999999, offset: Optional[int] = 0
    ):

        import pprint

        pprint.pprint((query, limit, offset))

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
        res = cur.execute(
            "SELECT * FROM tags t WHERE t.tag LIKE ? ORDER BY t.count DESC;",
            (f"%{query}%",),
        )
        resolved = res.fetchall()
        return resolved

    def search_metadata(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        res = cur.execute(
            "SELECT * FROM metadata m WHERE m.path LIKE ?;",
            (f"%{query}%",),
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

    def insert_tags(
        self,
        tags: list[str],
        cur: Optional[sqlite3.Cursor] = None,
    ):
        resolved_tags = [tag for tag in tags if tag]
        if len(resolved_tags) == 0:
            return

        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_tags(resolved_tags, transactional_cur)
                return

        cur.executemany(
            "INSERT OR IGNORE INTO tags (tag, count) VALUES (?, 1);",
            [(tag,) for tag in resolved_tags],
        )
        cur.executemany(
            "UPDATE tags SET count = count + 1 WHERE tag = ?",
            [(tag,) for tag in resolved_tags],
        )

    def insert_tag(self, tag: str, cur: Optional[sqlite3.Cursor] = None):
        self.insert_tags([tag], cur=cur)

    def insert_metadata(
        self,
        path: str,
        lat_lng_deg: Tuple[float, float],
        iso8601: str,
        cur: Optional[sqlite3.Cursor] = None,
    ):
        if cur is None:
            with self.transaction() as transactional_cur:
                self.insert_metadata(path, lat_lng_deg, iso8601, transactional_cur)
                return

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
            "UPDATE metadata SET lat_deg = ?, lng_deg = ?, iso8601 = ? WHERE path = ?",
            (
                lat_lng_deg[0],
                lat_lng_deg[1],
                iso8601,
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

        embedding_json = json.dumps(embedding)
        cur.execute(
            "INSERT OR IGNORE INTO embeddings (path, model_id, embedding_dim, embedding_json) VALUES (?, ?, ?, ?);",
            (path, model_id, len(embedding), embedding_json),
        )
        cur.execute(
            "UPDATE embeddings SET model_id = ?, embedding_dim = ?, embedding_json = ? WHERE path = ?",
            (model_id, len(embedding), embedding_json, path),
        )

    def get_embedding(self, path: str, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings WHERE path = ? AND model_id = ?",
                (path, model_id),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings WHERE path = ?",
                (path,),
            )
        return res.fetchone()

    def list_embeddings(self, model_id: Optional[str] = None):
        cur = self.con.cursor()
        if model_id:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings WHERE model_id = ?",
                (model_id,),
            )
        else:
            res = cur.execute(
                "SELECT path, model_id, embedding_dim, embedding_json FROM embeddings"
            )
        return res.fetchall()


@click.group()
@click.pass_context
def cli(ctx):
    ctx.ensure_object(dict)


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
    help="Indexing profile: janus (legacy tags), siglip2 (embeddings), hybrid (both).",
)
@click.option(
    "--benchmark-output",
    default=None,
    help="Optional JSON file path for timing output.",
)
def index(
    glob: str,
    dbpath: str,
    dry_run: bool,
    model_profile: str,
    benchmark_output: Optional[str],
):
    started_at = time.perf_counter()
    db = Sqlite3Client(dbpath)
    setup_started_at = time.perf_counter()
    db.setup_tables()
    setup_ms = (time.perf_counter() - setup_started_at) * 1000
    db_info = db.info()
    print(f"Database: {db_info['entries']} entries (SQLite {db_info['version']})")

    planning_started_at = time.perf_counter()
    files = find_files(".", glob)
    existing_image_paths = db.list_image_paths()
    uses_embeddings = model_profile in [MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID]
    # One bulk SELECT into a set, then O(1) membership checks per file.
    # Better than SELECT EXISTS per image which would be N SQLite round-trips.
    existing_embedding_paths_v2 = db.list_embedding_paths(
        model_id=Siglip2Embedder.MODEL_ID if uses_embeddings else None
    )
    existing_embedding_paths_v1 = db.list_embedding_paths(
        model_id=SiglipEmbedder.MODEL_ID if uses_embeddings else None
    )
    work_items = []
    for file_path in files:
        has_image = file_path in existing_image_paths
        has_embedding_v2 = file_path in existing_embedding_paths_v2
        has_embedding_v1 = file_path in existing_embedding_paths_v1
        needs_classifier = model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID] and not has_image
        needs_embedding_v2 = uses_embeddings and not has_embedding_v2
        needs_embedding_v1 = uses_embeddings and not has_embedding_v1

        if needs_classifier or needs_embedding_v2 or needs_embedding_v1:
            work_items.append(
                {
                    "path": file_path,
                    "needs_classifier": needs_classifier,
                    "needs_embedding_v2": needs_embedding_v2,
                    "needs_embedding_v1": needs_embedding_v1,
                }
            )
    planning_ms = (time.perf_counter() - planning_started_at) * 1000

    skipped = len(files) - len(work_items)
    print(f"Found {len(files)} files ({len(work_items)} to index, {skipped} already indexed) — profile: {model_profile}")

    if not dry_run and len(work_items) > 0:
        classifier = None
        embedder = None
        model_init_started_at = time.perf_counter()

        if any(item["needs_classifier"] for item in work_items):
            classifier = JanusClassifier()
            classifier.init_model()

        embedder_v2 = None
        embedder_v1 = None
        if any(item["needs_embedding_v2"] for item in work_items):
            embedder_v2 = Siglip2Embedder()
            embedder_v2.init_model()
        if any(item["needs_embedding_v1"] for item in work_items):
            embedder_v1 = SiglipEmbedder()
            embedder_v1.init_model()

        model_init_ms = (time.perf_counter() - model_init_started_at) * 1000

        # Kick off color extraction in a background thread pool before GPU work starts.
        # fast_colorthief (Rust) releases the GIL, so it runs truly in parallel with
        # CUDA kernels on the GPU — ~2.7 min of CPU work becomes effectively free.
        all_paths = [item["path"] for item in work_items]
        colors_executor = concurrent.futures.ThreadPoolExecutor(max_workers=COLORTHIEF_WORKERS)
        colors_started_at = time.perf_counter()
        color_futures = {
            path: colors_executor.submit(fast_colorthief.get_palette, path)
            for path in all_paths
        }
        print(f"Color extraction started in background ({len(all_paths)} images, {COLORTHIEF_WORKERS} threads)")

        # Pre-compute Janus results in batches (GPU).
        # Batching amortises KV-cache and kernel launch overhead — ~3.8x vs single-image.
        precomputed_janus: dict[str, str] = {}
        if classifier is not None:
            janus_paths = [
                item["path"] for item in work_items if item["needs_classifier"]
            ]
            print(f"Running Janus in batches of {JANUS_BATCH_SIZE} ({len(janus_paths)} images)...")
            batch_started_at = time.perf_counter()
            for batch_start in range(0, len(janus_paths), JANUS_BATCH_SIZE):
                batch_paths = janus_paths[batch_start : batch_start + JANUS_BATCH_SIZE]
                batch_geocodes = [extract_geocode_from_path(p) for p in batch_paths]
                batch_results = classifier.predict_batch(
                    list(zip(batch_paths, batch_geocodes))
                )
                for path, raw in zip(batch_paths, batch_results):
                    precomputed_janus[path] = raw
                done = min(batch_start + JANUS_BATCH_SIZE, len(janus_paths))
                print(f"  Janus batch: {done}/{len(janus_paths)}")
            batch_ms = (time.perf_counter() - batch_started_at) * 1000
            print(f"Janus batch inference complete in {batch_ms:.0f}ms")

        # Pre-compute embeddings in batches (GPU, ~2x vs sequential).
        # keyed as precomputed_embeddings[path][model_id] = embedding
        precomputed_embeddings: dict[str, dict[str, list[float]]] = {}
        for embedder, needs_key in [
            (embedder_v2, "needs_embedding_v2"),
            (embedder_v1, "needs_embedding_v1"),
        ]:
            if embedder is None:
                continue
            emb_paths = [item["path"] for item in work_items if item[needs_key]]
            print(f"Running {embedder.model_id} embeddings in batches of {EMBEDDER_BATCH_SIZE} ({len(emb_paths)} images)...")
            emb_started_at = time.perf_counter()
            for batch_start in range(0, len(emb_paths), EMBEDDER_BATCH_SIZE):
                batch_paths = emb_paths[batch_start : batch_start + EMBEDDER_BATCH_SIZE]
                batch_embeddings = embedder.predict_image_embeddings_batch(batch_paths)
                for path, embedding in zip(batch_paths, batch_embeddings):
                    precomputed_embeddings.setdefault(path, {})[embedder.model_id] = embedding
            emb_ms = (time.perf_counter() - emb_started_at) * 1000
            print(f"{embedder.model_id} embeddings complete in {emb_ms:.0f}ms")

        # Collect color results (GPU work is done; colors are likely already finished).
        precomputed_colors: dict[str, list] = {}
        colors_executor.shutdown(wait=True)
        for path, fut in color_futures.items():
            precomputed_colors[path] = fut.result()
        colors_ms = (time.perf_counter() - colors_started_at) * 1000
        print(f"Color extraction complete in {colors_ms:.0f}ms (ran concurrently with GPU)")

        enumerated = [
            (
                item_index,
                item["path"],
                classifier if item["needs_classifier"] else None,
                [e for e in [
                    embedder_v2 if item["needs_embedding_v2"] else None,
                    embedder_v1 if item["needs_embedding_v1"] else None,
                ] if e is not None],
                precomputed_janus.get(item["path"]),
                precomputed_embeddings.get(item["path"]),
                precomputed_colors.get(item["path"]),
            )
            for item_index, item in enumerate(work_items)
        ]

        # Disable concurrency as it doesn't help performance on a RTX3080
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            start_time = time.perf_counter()
            analysis_durations_ms = []
            worker_results = []

            for i, result in enumerate(executor.map(analyse_image_worker, enumerated)):
                time_now = time.perf_counter()
                time_per_image = (time_now - start_time) / (i + 1)
                rate = 1 / time_per_image
                percent = i / float(len(work_items)) * 100
                estimated_time_min = (len(work_items) - i) * time_per_image / 60

                analysed = result.get("analysed")
                analysis_durations_ms.append((analysed.get("_duration") or 0) * 1000)

                tags = (analysed.get("tags") or {}).get("labels") or []
                tags_str = ", ".join(tags[:6]) if tags else "—"
                alt = analysed.get("alt_text") or analysed.get("subject") or ""
                alt_str = f" | {alt[:80]}" if alt else ""
                filename = os.path.basename(result["path"])
                print(
                    f"[{i + 1}/{len(work_items)} {percent:.0f}% {rate:.2f}it/s ~{estimated_time_min:.1f}min] {filename}: {tags_str}{alt_str}"
                )
                worker_results.append(result)

        # Single-transaction batch insert: FTS5 flushes once instead of per-image (~63x faster).
        insert_started_at = time.perf_counter()
        insert_analysed_images_batch(db, worker_results)
        insert_durations_ms = [(time.perf_counter() - insert_started_at) * 1000]
        print(f"Inserted {len(worker_results)} images in {insert_durations_ms[0]:.0f}ms")

        db.optimize()
    else:
        model_init_ms = 0.0
        analysis_durations_ms = []
        insert_durations_ms = []

    if not dry_run and analysis_durations_ms:
        stats = {
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "modelProfile": model_profile,
            "workItemCount": len(work_items),
            "medianAnalysisMs": round(statistics.median(analysis_durations_ms), 2),
        }
        stats_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".last-index-stats.json")
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
            "durationsMs": {
                "total": round((time.perf_counter() - started_at) * 1000, 2),
                "setupTables": round(setup_ms, 2),
                "planning": round(planning_ms, 2),
                "modelInit": round(model_init_ms, 2),
                "analysisTotal": round(sum(analysis_durations_ms), 2),
                "analysisMedian": round(statistics.median(analysis_durations_ms), 2)
                if analysis_durations_ms
                else 0.0,
                "insertTotal": round(sum(insert_durations_ms), 2),
                "insertMedian": round(statistics.median(insert_durations_ms), 2)
                if insert_durations_ms
                else 0.0,
            },
        }
        with open(benchmark_output, "w", encoding="utf-8") as fh:
            json.dump(benchmark, fh, indent=2)
        print(f"Benchmark written to {benchmark_output}")


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
        "iso8601": "2024-01-01T00:00:00Z",
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
            row_insert_durations_ms = []
            for row_index in range(rows):
                row_started_at = time.perf_counter()
                insert_analysed_image(
                    db,
                    build_benchmark_sample(row_index),
                    f"../albums/benchmark/photo-{row_index}.jpg",
                )
                row_insert_durations_ms.append(
                    (time.perf_counter() - row_started_at) * 1000
                )
            insert_total_ms = (time.perf_counter() - insert_started_at) * 1000

            db.optimize()
            runs.append(
                {
                    "run": run_index + 1,
                    "setupMs": round(setup_ms, 2),
                    "insertTotalMs": round(insert_total_ms, 2),
                    "insertMedianMs": round(statistics.median(row_insert_durations_ms), 2),
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
    default="1,2,4,6,8",
    help="Comma-separated list of batch sizes to benchmark.",
)
@click.option("--repeat", default=3, help="How many runs per batch size.")
@click.option(
    "--output",
    default=None,
    help="Optional JSON output file for the benchmark summary.",
)
def benchmark_janus_batch(image_path: str, batch_sizes: str, repeat: int, output: Optional[str]):
    """Compare single-image vs batched Janus inference throughput."""
    classifier = JanusClassifier()

    init_started_at = time.perf_counter()
    classifier.init_model()
    init_ms = (time.perf_counter() - init_started_at) * 1000

    geocode = {"city": "Singapore", "country": "Singapore"}
    sizes = [int(s.strip()) for s in batch_sizes.split(",")]

    results_by_size = {}
    for batch_size in sizes:
        items = [(image_path, geocode)] * batch_size
        runs = []
        for run_index in range(repeat):
            started_at = time.perf_counter()
            outputs = classifier.predict_batch(items)
            duration_ms = (time.perf_counter() - started_at) * 1000
            ms_per_image = duration_ms / batch_size
            runs.append({
                "run": run_index + 1,
                "batchSize": batch_size,
                "totalMs": round(duration_ms, 2),
                "msPerImage": round(ms_per_image, 2),
                "outputChars": sum(len(o) for o in outputs),
            })
        median_ms_per_image = statistics.median(r["msPerImage"] for r in runs)
        results_by_size[batch_size] = {
            "runs": runs,
            "medianMsPerImage": round(median_ms_per_image, 2),
        }
        print(f"batch={batch_size}: median {median_ms_per_image:.0f}ms/image")

    single_median = results_by_size[1]["medianMsPerImage"] if 1 in results_by_size else None
    speedups = {}
    if single_median:
        for size, data in results_by_size.items():
            speedups[size] = round(single_median / data["medianMsPerImage"], 2)

    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "path": image_path,
        "repeat": repeat,
        "initMs": round(init_ms, 2),
        "resultsByBatchSize": results_by_size,
        "speedupVsSingle": speedups,
    }

    pprint.pprint(summary)

    if output:
        with open(output, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Benchmark written to {output}")


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
def benchmark_embedder_batch(image_path: str, model: str, batch_sizes: str, repeat: int, output: Optional[str]):
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
        print(f"batch={batch_size:2d}: seq {seq_median:.1f}ms  batched {batch_median:.1f}ms  speedup {speedup}x")

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


@cli.command("prune")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
def prune(glob: str, dbpath: str, dry_run: bool):
    db = Sqlite3Client(dbpath)
    files = find_files(".", glob)
    paths = db.list_paths()
    to_delete = [p for p in paths if p not in files]

    if dry_run:
        pprint.pprint(to_delete)
    else:
        for p in to_delete:
            _res = db.delete_path(p)
            pprint.pprint(f"deleted from db {p}")


@cli.command("search")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search(query, limit)
    pprint.pprint(results)


@cli.command("search-tags")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_tags(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search_tags(query, limit)
    pprint.pprint(results)


@cli.command("search-metadata")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search_metadata(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search_metadata(query, limit)
    pprint.pprint(results)


@cli.command("dump")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
def dump(dbpath: str):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
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
    db = Sqlite3Client(dbpath)
    db.setup_tables()

    base = db.get_embedding(path=query_path, model_id=model_id)
    if not base:
        pprint.pprint([])
        return

    resolved_model_id = base[1]
    base_embedding = json.loads(base[3])

    candidates = db.list_embeddings(model_id=resolved_model_id)
    scored = []
    for path, _model_id, _dim, embedding_json in candidates:
        if path == query_path:
            continue
        candidate_embedding = json.loads(embedding_json)
        score = cosine_similarity(base_embedding, candidate_embedding)
        scored.append((path, score))

    scored = sorted(scored, key=lambda x: x[1], reverse=True)[:limit]
    pprint.pprint(scored)


@cli.command("model-info")
def model_info():
    """Print the current embedding model configuration as JSON."""
    print(json.dumps({"embeddingModelId": Siglip2Embedder.MODEL_ID}))


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


def find_files(directory: str, pattern: str) -> list[str]:
    """Find files from a glob pattern in a directory, ignoring case"""
    path_pattern = os.path.join(directory, pattern)
    paths: list[PosixPath] = list(
        Path(directory).glob(path_pattern, case_sensitive=False)
    )
    return [str(p) for p in paths]


def extract_geocode_from_path(path: str) -> Mapping:
    """Extract geocode from image EXIF. Used to supply location context before batching Janus."""
    try:
        with open(path, "rb") as fh:
            exif_full = get_exif(fh)
            exif = filter_exif_for_search(
                {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}
            )
        lat = exif.get("GPS GPSLatitude")
        lng = exif.get("GPS GPSLongitude")
        lat_ref = exif.get("GPS GPSLatitudeRef")
        lng_ref = exif.get("GPS GPSLongitudeRef")
        if lat and lng and lat_ref and lng_ref:
            lat_deg = convert_to_degress(lat, lat_ref)
            lng_deg = convert_to_degress(lng, lng_ref)
            return get_image_geocode(lat_deg, lng_deg)
    except Exception:
        pass
    return {}


def analyse_image(
    fh: IO[bytes],
    classifier: Optional[JanusClassifier],
    path: str,
    embedders: Optional[list[BaseImageEmbedder]] = None,
    precomputed_janus: Optional[str] = None,
    precomputed_embeddings: Optional[dict[str, list[float]]] = None,
    precomputed_colors: Optional[list] = None,
) -> Mapping:
    start_time = time.perf_counter()

    exif_full = get_exif(fh)
    exif = filter_exif_for_search(
        {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}
    )

    lat = exif.get("GPS GPSLatitude", None)
    lng = exif.get("GPS GPSLongitude", None)
    lat_ref = exif.get("GPS GPSLatitudeRef", None)
    lng_ref = exif.get("GPS GPSLongitudeRef", None)

    if lat and lng and lat_ref and lng_ref:
        lat_deg = convert_to_degress(lat, lat_ref)
        lng_deg = convert_to_degress(lng, lng_ref)
        geo = get_image_geocode(lat_deg, lng_deg)
    else:
        lat_deg = None
        lng_deg = None
        geo = {}

    colors = precomputed_colors if precomputed_colors is not None else fast_colorthief.get_palette(path)

    result: Mapping = {}
    if classifier is not None:
        attempts = 0
        max_attempts = 20
        raw_result = None
        while attempts < max_attempts:
            try:
                if precomputed_janus is not None and attempts == 0:
                    raw_result = precomputed_janus
                else:
                    raw_result = classifier.predict(path=path, geocode=geo)

                result = parse_janus_response(raw_result)
                break
            except Exception:
                attempts += 1
                precomputed_janus = None  # fall back to fresh per-image predictions
                print(
                    f"Attempt {attempts}/{max_attempts} failed for {path}, got {raw_result}"
                )
                if attempts >= max_attempts:
                    print(
                        f"Failed to classify {path} after {max_attempts} attempts, skipping."
                    )
                    result = {}
                    break

    embeddings = []
    for emb in (embedders or []):
        try:
            precomputed = (precomputed_embeddings or {}).get(emb.model_id)
            embedding = precomputed if precomputed is not None else emb.predict_image_embedding(path)
            embeddings.append({"model_id": emb.model_id, "embedding": embedding})
        except Exception as err:
            print(f"Embedding ({emb.model_id}) failed for {path}: {err}")

    # 2000:01:01 12:34:56 > 2000-01-01T12:34:56
    datetime = (
        str(exif_full.get("EXIF DateTimeOriginal", ""))
        .replace(":", "-", 2)
        .replace(" ", "T", 1)
    )

    tags = [] + result.get("identified_objects", []) + result.get("themes", [])
    normalised_tags = [t.lower().replace(" ", "_") for t in list(set(tags))]

    end_time = time.perf_counter()

    return {
        # assume TZ = Z
        "datetime": f"{datetime}Z" if datetime else None,
        "exif": exif,
        "geocode": geo,
        "lat_deg": lat_deg,
        "lng_deg": lng_deg,
        "colors": colors,
        "tags": normalised_tags,
        "alt_text": result.get("alt_text"),
        "subject": result.get("subject"),
        "embeddings": embeddings,
        "_duration": end_time - start_time,
    }


def analyse_image_worker(
    input: list[Tuple[int, str, Optional[JanusClassifier], list[BaseImageEmbedder], Optional[str], Optional[dict], Optional[list]]],
) -> Mapping[str, typing.Any]:
    try:
        """Multiprocessable worker"""
        idx = input[0]
        path = input[1]
        classifier = input[2]
        embedders = input[3] if len(input) > 3 else []
        precomputed_janus = input[4] if len(input) > 4 else None
        precomputed_embeddings = input[5] if len(input) > 5 else None
        precomputed_colors = input[6] if len(input) > 6 else None

        print(f"[{idx + 1}] {os.path.basename(path)}...")
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                classifier=classifier,
                path=path,
                embedders=embedders,
                precomputed_janus=precomputed_janus,
                precomputed_embeddings=precomputed_embeddings,
                precomputed_colors=precomputed_colors,
            )
            return {
                "path": path,
                "analysed": analysed,
                "used_classifier": classifier is not None,
            }
    except (KeyboardInterrupt, SystemExit):
        print("Exiting...")
        return (index, False)


def insert_analysed_image(db, analysed: Mapping, path, include_classifier_fields: bool = True):
    geocode = analysed.get("geocode")
    image_fields = {
        "filename": get_filename(path),
        "album_relative_path": get_album_relative_path(path),
        "exif": format_mapping(analysed.get("exif")),
        "colors": format_mapping(analysed.get("colors")),
    }

    if geocode:
        image_fields["geocode"] = format_mapping_values(geocode)

    if include_classifier_fields:
        image_fields["alt_text"] = analysed.get("alt_text")
        image_fields["subject"] = analysed.get("subject")
        image_fields["tags"] = ", ".join(analysed.get("tags"))

    with db.transaction() as cur:
        db.upsert_image_fields(path, image_fields, cur=cur)

        if include_classifier_fields:
            tags_to_insert = list(analysed.get("tags") or [])
            if geocode:
                tags_to_insert.extend(
                    [
                        geocode.get("country"),
                        geocode.get("city"),
                        geocode.get("country_code"),
                    ]
                )
            db.insert_tags(tags_to_insert, cur=cur)

        db.insert_metadata(
            path,
            lat_lng_deg=(
                analysed.get("lat_deg"),
                analysed.get("lng_deg"),
            ),
            iso8601=analysed.get("iso8601"),
            cur=cur,
        )

        for emb in analysed.get("embeddings") or []:
            db.insert_embedding(
                path=path,
                model_id=emb["model_id"],
                embedding=emb["embedding"],
                cur=cur,
            )


def insert_analysed_images_batch(db, results: list[Mapping]):
    """Insert all analysed results in a single transaction.

    FTS5 flushes a segment merge on every COMMIT; batching all rows into one
    transaction eliminates that overhead (~63x faster than one txn per image).
    """
    with db.transaction() as cur:
        for item in results:
            path = item["path"]
            analysed = item["analysed"]
            include_classifier_fields = item.get("used_classifier", False)

            geocode = analysed.get("geocode")
            image_fields = {
                "filename": get_filename(path),
                "album_relative_path": get_album_relative_path(path),
                "exif": format_mapping(analysed.get("exif")),
                "colors": format_mapping(analysed.get("colors")),
            }
            if geocode:
                image_fields["geocode"] = format_mapping_values(geocode)
            if include_classifier_fields:
                image_fields["alt_text"] = analysed.get("alt_text")
                image_fields["subject"] = analysed.get("subject")
                image_fields["tags"] = ", ".join(analysed.get("tags"))

            db.upsert_image_fields(path, image_fields, cur=cur)

            if include_classifier_fields:
                tags_to_insert = list(analysed.get("tags") or [])
                if geocode:
                    tags_to_insert.extend([
                        geocode.get("country"),
                        geocode.get("city"),
                        geocode.get("country_code"),
                    ])
                db.insert_tags(tags_to_insert, cur=cur)

            db.insert_metadata(
                path,
                lat_lng_deg=(analysed.get("lat_deg"), analysed.get("lng_deg")),
                iso8601=analysed.get("iso8601"),
                cur=cur,
            )

            for emb in analysed.get("embeddings") or []:
                db.insert_embedding(
                    path=path,
                    model_id=emb["model_id"],
                    embedding=emb["embedding"],
                    cur=cur,
                )


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
