import torch
import click
from pathlib import Path, PosixPath
import pprint
import fast_colorthief
import exifread
import reverse_geocode
import sqlite3
import typing
from typing import IO, Mapping, Optional, Tuple
import os
import json
import re
import uuid

from transformers import AutoModelForCausalLM
from janus.models import MultiModalityCausalLM, VLChatProcessor
from janus.utils.io import load_pil_images

import concurrent.futures
import time


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
        schema = r"\{ \"identified_objects\": string[], \"themes\": string[], \"alt_text\": string, \"critique\": string, \"composition_critique\": string, \"suggested_title\": string, \"subject\": string }"

        geocode_prompt = None
        if geocode:
            geocode_prompt = f"\nThis photo was taken near {geocode.get('city', '')}, {geocode.get('state')}, {geocode.get('country', '')}, {geocode.get('country', '')}."

        prompt = f"<image_placeholder>{geocode_prompt}\nYou are the best photographer and brutally honest acclaimed photography critic and gallery curator. Your writing style is witty, sardonic, concise, and sarcastic like those of the best writers such as Hemingway and Roger Ebert. Classify and describe the following photo into JSON (MUST BE JSON!) with this schema:\n{schema}\n{uuid.uuid4()}. IT IS IMPORTANT THAT YOU ONLY RETURN VALID JSON ANOD NOTHING ELSE! Do not keep repeating yourself in your answer."

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
            max_new_tokens=512,
            do_sample=False,
            use_cache=True,
        )

        answer = self.tokenizer.decode(
            outputs[0].cpu().tolist(), skip_special_tokens=True
        )
        return answer


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
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, alt_text, critique, suggested_title, composition_critique, subject, tokenize='porter trigram')"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS tags (tag VARCHAR PRIMARY KEY, count INTEGER DEFAULT 0)"
        )
        cur.execute(
            "CREATE TABLE IF NOT EXISTS metadata (path VARCHAR PRIMARY KEY, lat_deg REAL, lng_deg REAL, iso8601 TEXT)"
        )
        # Optimise loads from the browser https://github.com/phiresky/sql.js-httpvfs#readme
        cur.execute("PRAGMA journal_mode = delete;")
        cur.execute("PRAGMA page_size = 1024;")
        cur.execute("INSERT INTO images(images) VALUES ('optimize');")
        cur.execute("COMMIT")
        cur.execute("VACUUM")

    def already_exists(self, path: str) -> bool:
        cur = self.con.cursor()
        result = cur.execute(
            "SELECT COUNT(*) FROM images WHERE path = ?", (path,)
        ).fetchone()
        # Result is a Tuple
        return len(result) > 0 and result[0] > 0

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

        resolved_paths = {
            p[0]
            for path_list in [resolved_image_paths, resolved_metadata_paths]
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
        cur.execute("COMMIT")

        return (res_images, res_metadata)

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

    def insert_field(self, path: str, field: str, value: str):
        cur = self.con.cursor()
        # Upsert is not implemented for virtual tables
        cur.execute("BEGIN")
        count = cur.execute(
            "SELECT COUNT(*) FROM images WHERE path = ?;", (path,)
        ).fetchall()

        if len(count) > 0 and count[0][0] > 0:
            cur.execute(f"UPDATE images SET {field} = ? WHERE path = ?;", (value, path))
        else:
            # No point INSERT OR IGNORE-ing: fts5 auto creates a random primary key
            cur.execute(
                f"INSERT INTO images (path, {field}) VALUES (?, ?);",
                (path, value),
            )
        cur.execute("COMMIT")

    def insert_tag(self, tag: str):
        cur = self.con.cursor()
        cur.execute("BEGIN")
        cur.execute(
            "INSERT OR IGNORE INTO tags (tag, count) VALUES (?, 1);",
            (tag,),
        )
        cur.execute(
            "UPDATE tags SET count = count + 1 WHERE tag = ?",
            (tag,),
        )
        cur.execute("COMMIT")

    def insert_metadata(
        self, path: str, lat_lng_deg: Tuple[float, float], iso8601: str
    ):
        cur = self.con.cursor()
        cur.execute("BEGIN")
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
        cur.execute("COMMIT")


@click.group()
@click.pass_context
def cli(ctx):
    ctx.ensure_object(dict)


@cli.command("index")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--dry-run", is_flag=True, default=False, help="Dry run.")
def index(glob: str, dbpath: str, dry_run: bool):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    pprint.pprint(db.info())

    files = find_files(".", glob)
    valid_files = [f for f in files if not db.already_exists(f)]

    print(f"Found {len(files)} files for the the glob pattern {glob}")
    print(
        f"Analysing {len(valid_files)} unindexed files (skipping {len(files) - len(valid_files)} already-indexed)."
    )

    if not dry_run and len(valid_files) > 0:
        classifier = JanusClassifier()
        classifier.init_model()

        enumerated = [
            (index, item, classifier) for index, item in enumerate(valid_files)
        ]

        # Disable concurrency as it doesn't help performance on a RTX3080
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            start_time = time.perf_counter()

            for i, result in enumerate(executor.map(analyse_image_worker, enumerated)):
                time_now = time.perf_counter()
                time_per_image = (time_now - start_time) / (i + 1)
                rate = 1 / time_per_image
                percent = i / float(len(valid_files)) * 100
                estimated_time_min = (len(valid_files) - i) * time_per_image / 60

                pprint.pprint(result)
                print(
                    f"[{percent:.1f}% {i}/{len(valid_files)} {rate:.2f}it/s {estimated_time_min:.1f}min]\tAnalysed image {result["path"]}. Inserting image..."
                )
                insert_analysed_image(
                    db=db, analysed=result.get("analysed"), path=result.get("path")
                )


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


def analyse_image(fh: IO[bytes], classifier: JanusClassifier, path: str) -> Mapping:
    start_time = time.perf_counter()

    exif_full = get_exif(fh)
    exif = {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}

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

    attempts = 0
    max_attempts = 20
    result = None
    while attempts < max_attempts:
        try:
            result = classifier.predict(path=path, geocode=geo)

            JSON_BLOCK_PATTERN = re.compile(r"\{.*?\}", re.DOTALL | re.MULTILINE)
            blocks = JSON_BLOCK_PATTERN.findall(result)
            block = blocks[0]
            result = json.loads(block)

            # Ensure we have the right keys as a poor man's schema check
            assert isinstance(result, dict)
            if isinstance(result["identified_objects"], str):
                result["identified_objects"] = [result["identified_objects"]]
            if isinstance(result["themes"], str):
                result["themes"] = [result["themes"]]
            result["alt_text"]
            result["critique"]
            result["suggested_title"]
            result["composition_critique"]
            result["subject"]
            break
        except Exception:
            attempts += 1
            print(f"Attempt {attempts}/{max_attempts} failed for {path}, got {result}")
            if attempts >= max_attempts:
                print(
                    f"Failed to classify {path} after {max_attempts} attempts, skipping."
                )
                result = {}
                break

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
        "critique": result.get("critique"),
        "suggested_title": result.get("suggested_title"),
        "composition_critique": result.get("composition_critique"),
        "subject": result.get("subject"),
        "_duration": end_time - start_time,
    }


def analyse_image_worker(
    input: list[Tuple[int, str, JanusClassifier]],
) -> Mapping[str, typing.Any]:
    try:
        """Multiprocessable worker"""
        idx = input[0]
        path = input[1]
        classifier = input[2]

        print(f"[{idx}] Analysing {path}...")
        with open(path, "rb") as fh:
            analysed = analyse_image(fh, classifier=classifier, path=path)
            return {
                "path": path,
                "analysed": analysed,
            }
    except (KeyboardInterrupt, SystemExit):
        print("Exiting...")
        return (index, False)


def insert_analysed_image(db, analysed: Mapping, path):
    db.insert_field(path, field="filename", value=get_filename(path))
    db.insert_field(
        path,
        field="album_relative_path",
        value=get_album_relative_path(path),
    )
    db.insert_field(path, field="exif", value=format_mapping(analysed.get("exif")))
    db.insert_field(
        path,
        field="colors",
        value=format_mapping(analysed.get("colors")),
    )
    db.insert_field(path, field="alt_text", value=analysed.get("alt_text"))
    db.insert_field(path, field="critique", value=analysed.get("critique"))
    db.insert_field(
        path, field="suggested_title", value=analysed.get("suggested_title")
    )
    db.insert_field(
        path, field="composition_critique", value=analysed.get("composition_critique")
    )
    db.insert_field(path, field="subject", value=analysed.get("subject"))

    geocode = analysed.get("geocode")
    if geocode:
        db.insert_geocode(path, format_mapping_values(geocode))
        db.insert_tag(geocode["country"])
        db.insert_tag(geocode["city"])
        db.insert_tag(geocode["country_code"])
    db.insert_field(path, field="tags", value=", ".join(analysed.get("tags")))
    for tag in analysed.get("tags"):
        db.insert_tag(tag)

    db.insert_metadata(
        path,
        lat_lng_deg=(
            analysed.get("lat_deg"),
            analysed.get("lng_deg"),
        ),
        iso8601=analysed.get("iso8601"),
    )


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
