import click
import glob as _glob
from pathlib import Path
import pprint
from colorthief import ColorThief
import exifread
import reverse_geocode
import sqlite3
from ultralytics import YOLO
import typing
from typing import IO, TYPE_CHECKING, Mapping, Optional, Tuple
import os


class Classifier:
    def init_model(self) -> None:
        print("Loading YOLOv8...")
        self.model = YOLO("yolov8n-cls.pt")

    def predict(self, path: str):
        results = self.model(path, conf=0.7)
        if len(results) > 0:
            classes = results[0].names
            top5 = results[0].probs.top5
            top5_mapped = [f"{classes[x]}" for x in top5]
            return top5_mapped
        return {}


def classify(fh: IO[any]):
    None


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
    return f"/album/{p.parts[-2]}#{p.parts[-1]}"


def get_filename(path: str) -> str:
    return str(os.path.basename(Path(path)))


class Sqlite3Client:
    def __init__(self, db_path: typing.Union[str, bytes, os.PathLike]):
        self.con = sqlite3.connect(db_path)

    def info(self):
        print(f"""sqlite:\t{sqlite3.sqlite_version}""")

    def setup_tables(self):
        cur = self.con.cursor()
        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, album_relative_path, filename, geocode, exif, tags, colors, tokenize='porter trigram')"
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

    def search(
        self, query: str, limit: Optional[int] = 999999, offset: Optional[int] = 999999
    ):
        cur = self.con.cursor()
        statement = f"""
        SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE images MATCH ?
        ORDER BY rank
        LIMIT ?
        OFFSET ?
        """

        limit = limit or 99999
        offset = offset or 99999

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
    print(db.info())

    files = _glob.glob(glob)
    valid_files = [f for f in files if not db.already_exists(f)]

    pprint.pprint(files)
    print(f"Found {len(files)} files for the the glob pattern {glob}")

    print(
        f"Indexing {len(valid_files)} unindexed files (skipping {len(files) - len(valid_files)} already-indexed). Valid files:"
    )
    pprint.pprint(valid_files)

    if not dry_run:
        classifier = Classifier()
        classifier.init_model()

        for idx, path in enumerate(valid_files):
            with open(path, "rb") as fh:
                print(f"[{idx}/{len(valid_files)}] Indexing {path}...")
                analysed = analyse_image(fh, classifier=classifier, path=path)
                pprint.pprint(analysed)
                db.insert_field(path, field="filename", value=get_filename(path))
                db.insert_field(
                    path,
                    field="album_relative_path",
                    value=get_album_relative_path(path),
                )
                db.insert_field(
                    path, field="exif", value=format_mapping(analysed.get("exif"))
                )
                db.insert_field(
                    path, field="colors", value=format_mapping(analysed.get("colors"))
                )

                geocode = analysed.get("geocode")
                if geocode:
                    db.insert_geocode(path, format_mapping_values(geocode))
                    db.insert_tag(geocode["country"])
                    db.insert_tag(geocode["city"])
                    db.insert_tag(geocode["country_code"])
                db.insert_field(
                    path, field="tags", value=", ".join(analysed.get("tags"))
                )
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
@click.option("--offset", default=0, help="Search query offset.")
def search(dbpath: str, query: str, limit: Optional[int]):
    db = Sqlite3Client(dbpath)
    db.setup_tables()
    results = db.search_tags(query, limit)
    pprint.pprint(results)


@cli.command("search-metadata")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search(dbpath: str, query: str, limit: Optional[int]):
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


def analyse_image(fh: IO[bytes], classifier: Classifier, path: str) -> Mapping:
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

    color_thief = ColorThief(fh)
    colors = color_thief.get_palette(color_count=3)

    tags = classifier.predict(path=path)

    # 2000:01:01 12:34:56 > 2000-01-01T12:34:56
    datetime = (
        str(exif_full.get("EXIF DateTimeOriginal", ""))
        .replace(":", "-", 2)
        .replace(" ", "T", 1)
    )

    return {
        # assume TZ = Z
        "datetime": f"{datetime}Z" if datetime else None,
        "exif": exif,
        "geocode": geo,
        "lat_deg": lat_deg,
        "lng_deg": lng_deg,
        "colors": colors,
        "tags": tags,
    }


def format_mapping(mapping: Optional[Mapping[str, str]]) -> str:
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([f"{k}:{v}" for k, v in mapping.items()])


def format_mapping_values(mapping: Optional[Mapping[str, str]]) -> str:
    if not mapping or not hasattr(mapping, "items"):
        return str(mapping)
    return "\n".join([str(v) for v in mapping.values()])


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    cli(obj={})
