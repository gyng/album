import click
import glob as _glob
import pprint
from PIL import Image, ExifTags
import exifread
import reverse_geocode
import sys
import sqlite3

import typing
from typing import IO, TYPE_CHECKING, Mapping, Optional, Tuple
import os


def convert_to_degress(value: exifread.utils.Ratio) -> float:
    d = float(value.values[0].num) / float(value.values[0].den)
    m = float(value.values[1].num) / float(value.values[1].den)
    s = float(value.values[2].num) / float(value.values[2].den)
    return d + (m / 60.0) + (s / 3600.0)


def get_image_geocode(lat_deg: float, lng_deg: float):
    return reverse_geocode.search([(lat_deg, lng_deg)])


def get_exif(fh: IO[any]):
    tags = exifread.process_file(fh)
    return tags


class Sqlite3Client:
    def __init__(self, db_path: typing.Union[str, bytes, os.PathLike]):
        self.con = sqlite3.connect(db_path)
        print(sqlite3.sqlite_version)

    def setup_tables(self):
        cur = self.con.cursor()
        cur.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS images USING fts5(path, geocode, exif, tags, colors, tokenize='trigram')"
        )

    def index_geocode(self, path: str, geocode: str):
        cur = self.con.cursor()
        # Upsert is not implemented for virtual tables
        cur.execute("BEGIN")
        count = cur.execute(
            "SELECT COUNT(*) FROM images WHERE path = ?;", (path,)
        ).fetchall()

        if len(count) > 0 and count[0][0] > 0:
            cur.execute(
                "UPDATE images SET geocode = ? WHERE path = ?;", (geocode, path)
            )
        else:
            # No point INSERT OR IGNORE-ing: fts5 auto creates a random primary key
            cur.execute(
                "INSERT INTO images (path, geocode) VALUES (?, ?);",
                (path, geocode),
            )
        cur.execute("COMMIT")

    def inspect(self):
        cur = self.con.cursor()
        res = cur.execute("SELECT * FROM images")
        resolved = res.fetchall()
        return resolved

    def search(self, query: str, limit: Optional[int] = None):
        cur = self.con.cursor()
        if limit:
            res = cur.execute(
                "SELECT * FROM images WHERE images MATCH ? ORDER BY rank LIMIT ?",
                (f"geocode:{query} OR path:{query}", limit),
            )
        else:
            res = cur.execute(
                "SELECT * FROM images WHERE images MATCH ? ORDER BY rank",
                (f"geocode:{query} OR path:{query}",),
            )

        resolved = res.fetchall()
        return resolved


@click.group()
@click.pass_context
def cli(ctx):
    ctx.ensure_object(dict)


@cli.command("index")
@click.option("--glob", help="glob to recursively index.")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--ignore", default=[".resized_images"], help="Paths to ignore.")
@click.option("--dry-run", default=False, help="Dry run.")
def index(glob: str, dbpath: str, ignore: str, dry_run: bool):
    sqlite = Sqlite3Client(dbpath)
    sqlite.setup_tables()

    files = _glob.glob(glob)
    pprint.pprint(files)
    print(f"Found the above {len(files)} files for the glob {glob}")

    if not dry_run:
        for path in files:
            with open(path, "rb") as fh:
                analysed = analyze_image(fh)
                sqlite.index_geocode(glob, analysed.get("geocode"))


@cli.command("search")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
@click.option("--query", default="", help="Search query.")
@click.option("--limit", default=None, help="Search query limit.")
def search(dbpath: str, query: str, limit: Optional[int]):
    sqlite = Sqlite3Client(dbpath)
    sqlite.setup_tables()
    results = sqlite.search(query, limit)
    pprint.pprint(results)


@cli.command("dump")
@click.option("--dbpath", default="testdb.sqlite", help="sqlite database path to use.")
def dump(dbpath: str):
    sqlite = Sqlite3Client(dbpath)
    sqlite.setup_tables()
    results = sqlite.inspect()
    pprint.pprint(results)


def analyze_image(fh: IO[bytes]) -> Mapping[str, str]:
    exif_full = get_exif(fh)
    exif = {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}

    lat = exif.get("GPS GPSLatitude", exif.get("GPS GPSLatitudeRef", None))
    lng = exif.get("GPS GPSLongitude", exif.get("GPS GPSLongitudeRef", None))

    if lat and lng:
        lat_deg = convert_to_degress(lat)
        lng_deg = convert_to_degress(lng)

    geo = get_image_geocode(lat_deg, lng_deg)

    return {"exif": str(exif), "geocode": str(geo)}


if __name__ == "__main__":
    cli(obj={})

    print(f"cwd: {os.getcwd()}")
    path = sys.argv[1]
    fh = open(path, "rb")
    exif_full = get_exif(fh)
    exif = {k: v for k, v in exif_full.items() if not isinstance(v, bytes)}

    lat = exif.get("GPS GPSLatitude", exif.get("GPS GPSLatitudeRef", None))
    lng = exif.get("GPS GPSLongitude", exif.get("GPS GPSLongitudeRef", None))

    if lat and lng:
        lat_deg = convert_to_degress(lat)
        lng_deg = convert_to_degress(lng)

    geo = get_image_geocode(lat_deg, lng_deg)

    sqlite = Sqlite3Client("testdb.sqlite")
    sqlite.setup_tables()
    sqlite.index_geocode(path, str(geo))
    print(sqlite._inspect())
    print(sqlite._search("Singapore"))
