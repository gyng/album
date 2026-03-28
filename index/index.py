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


class Siglip2Embedder:
    def init_model(self) -> None:
        self.model_id = "google/siglip2-base-patch16-224"
        print(f"Loading image embedder {self.model_id}...")
        self.processor = AutoImageProcessor.from_pretrained(self.model_id)
        self.model = AutoModel.from_pretrained(self.model_id)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = self.model.to(self.device).eval()
        print(f"Loaded image embedder {self.model_id} on {self.device}.")

    @torch.inference_mode()
    def predict_image_embedding(self, path: str) -> list[float]:
        image = Image.open(path).convert("RGB")
        inputs = self.processor(images=[image], return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        features = self.model.get_image_features(**inputs)
        # Normalise for cosine similarity and keep as float list for sqlite JSON storage.
        features = torch.nn.functional.normalize(features, p=2, dim=-1)
        return features[0].detach().float().cpu().tolist()


def convert_to_degress(value: exifread.utils.Ratio, lat_or_lng_ref: str) -> float:
    is_s_or_w = str(lat_or_lng_ref) == "W" or str(lat_or_lng_ref) == "S"
    sign = -1 if is_s_or_w else 1
    d = float(value.values[0].num) / float(value.values[0].den)
    m = float(value.values[1].num) / float(value.values[1].den)
    s = float(value.values[2].num) / float(value.values[2].den)
    return sign * (d + (m / 60.0) + (s / 3600.0))


def get_image_geocode(lat_deg: float, lng_deg: float) -> Mapping:
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
    pprint.pprint(db.info())

    planning_started_at = time.perf_counter()
    files = find_files(".", glob)
    existing_image_paths = db.list_image_paths()
    existing_embedding_paths = db.list_embedding_paths()
    work_items = []
    for file_path in files:
        has_image = file_path in existing_image_paths
        has_embedding = file_path in existing_embedding_paths
        needs_classifier = model_profile in [MODEL_PROFILE_JANUS, MODEL_PROFILE_HYBRID] and not has_image
        needs_embedding = model_profile in [MODEL_PROFILE_SIGLIP2, MODEL_PROFILE_HYBRID] and not has_embedding

        if needs_classifier or needs_embedding:
            work_items.append(
                {
                    "path": file_path,
                    "needs_classifier": needs_classifier,
                    "needs_embedding": needs_embedding,
                }
            )
    planning_ms = (time.perf_counter() - planning_started_at) * 1000

    print(f"Found {len(files)} files for the the glob pattern {glob}")
    print(
        f"Analysing {len(work_items)} files needing work (skipping {len(files) - len(work_items)} already-indexed)."
    )
    print(f"Using model profile: {model_profile}")

    if not dry_run and len(work_items) > 0:
        classifier = None
        embedder = None
        model_init_started_at = time.perf_counter()

        if any(item["needs_classifier"] for item in work_items):
            classifier = JanusClassifier()
            classifier.init_model()

        if any(item["needs_embedding"] for item in work_items):
            embedder = Siglip2Embedder()
            embedder.init_model()

        model_init_ms = (time.perf_counter() - model_init_started_at) * 1000

        enumerated = [
            (
                item_index,
                item["path"],
                classifier if item["needs_classifier"] else None,
                embedder if item["needs_embedding"] else None,
            )
            for item_index, item in enumerate(work_items)
        ]

        # Disable concurrency as it doesn't help performance on a RTX3080
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            start_time = time.perf_counter()
            analysis_durations_ms = []
            insert_durations_ms = []

            for i, result in enumerate(executor.map(analyse_image_worker, enumerated)):
                time_now = time.perf_counter()
                time_per_image = (time_now - start_time) / (i + 1)
                rate = 1 / time_per_image
                percent = i / float(len(work_items)) * 100
                estimated_time_min = (len(work_items) - i) * time_per_image / 60

                analysed = result.get("analysed")
                analysis_durations_ms.append((analysed.get("_duration") or 0) * 1000)

                pprint.pprint(result)
                print(
                    f"[{percent:.1f}% {i}/{len(work_items)} {rate:.2f}it/s {estimated_time_min:.1f}min]\tAnalysed image {result['path']}. Inserting image..."
                )
                insert_started_at = time.perf_counter()
                insert_analysed_image(
                    db=db,
                    analysed=analysed,
                    path=result.get("path"),
                    include_classifier_fields=result.get("used_classifier", False),
                )
                insert_durations_ms.append((time.perf_counter() - insert_started_at) * 1000)

        db.optimize()
    else:
        model_init_ms = 0.0
        analysis_durations_ms = []
        insert_durations_ms = []

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


def analyse_image(
    fh: IO[bytes],
    classifier: Optional[JanusClassifier],
    path: str,
    embedder: Optional[Siglip2Embedder] = None,
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

    # We could maybe speed this up by scaling images down?
    # Resizing doesn't do much to improve speed?
    colors = fast_colorthief.get_palette(path)

    result: Mapping = {}
    if classifier is not None:
        attempts = 0
        max_attempts = 20
        raw_result = None
        while attempts < max_attempts:
            try:
                raw_result = classifier.predict(path=path, geocode=geo)

                result = parse_janus_response(raw_result)
                break
            except Exception:
                attempts += 1
                print(
                    f"Attempt {attempts}/{max_attempts} failed for {path}, got {raw_result}"
                )
                if attempts >= max_attempts:
                    print(
                        f"Failed to classify {path} after {max_attempts} attempts, skipping."
                    )
                    result = {}
                    break

    embedding = None
    embedding_model_id = None
    if embedder is not None:
        try:
            embedding = embedder.predict_image_embedding(path)
            embedding_model_id = embedder.model_id
        except Exception as err:
            print(f"Embedding failed for {path}: {err}")

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
        "embedding": embedding,
        "embedding_model_id": embedding_model_id,
        "_duration": end_time - start_time,
    }


def analyse_image_worker(
    input: list[Tuple[int, str, Optional[JanusClassifier], Optional[Siglip2Embedder]]],
) -> Mapping[str, typing.Any]:
    try:
        """Multiprocessable worker"""
        idx = input[0]
        path = input[1]
        classifier = input[2]
        embedder = input[3] if len(input) > 3 else None

        print(f"[{idx}] Analysing {path}...")
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                classifier=classifier,
                path=path,
                embedder=embedder,
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

        embedding = analysed.get("embedding")
        embedding_model_id = analysed.get("embedding_model_id")
        if embedding and embedding_model_id:
            db.insert_embedding(
                path=path,
                model_id=embedding_model_id,
                embedding=embedding,
                cur=cur,
            )


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
