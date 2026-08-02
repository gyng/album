import json
import math
import os
import shutil
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import click
from click.testing import CliRunner

from index import (
    CAPTION_STAGE,
    CLASSIFIER_BACKEND_GEMMA4_GGUF,
    CLASSIFIER_BACKEND_JANUS,
    CORE_PIPELINE_VERSION,
    CORE_STAGE,
    DEFAULT_GEMMA4_GGUF_MODEL_ID,
    DEFAULT_LLAMA_SERVER_PATHS,
    JANUS_MODEL_ID,
    MODEL_PROFILE_JANUS,
    SIGLIP_V1_STAGE,
    Gemma4Classifier,
    Gemma4GgufClassifier,
    JanusClassifier,
    JsonCompletionLogitsProcessor,
    SiglipEmbedder,
    Sqlite3Client,
    acquire_single_instance_lock,
    analyse_image,
    analyse_image_worker,
    benchmark_caption_quality,
    build_classifier_prompt,
    build_geocode_fields,
    build_janus_prompt,
    build_metadata_fallback_caption,
    cache_tokenizer_vocab,
    caption_pipeline_version,
    cli,
    compare_caption_payloads,
    complete_classifier_json_prefix,
    complete_json_object_end,
    compute_reindex_plan,
    configured_media_root,
    create_classifier,
    decode_embedding,
    effective_free_vram_gb,
    encode_embedding,
    enforce_vram_headroom,
    evaluate_caption_quality_cases,
    evaluate_tag_quality,
    extract_colour_palette,
    file_content_sha256,
    file_content_sha256_many,
    filter_exif_for_search,
    find_files,
    format_mapping,
    format_mapping_values,
    geocode_columns,
    get_album_relative_path,
    get_exif,
    has_repeated_open_classifier_tags,
    heartbeat,
    index,
    insert_analysed_images_batch,
    log_vram,
    log_vram_peak,
    media_kind_for,
    needs_caption_for,
    normalise_classifier_tags,
    parse_caption_with_retry,
    parse_classifier_response,
    parse_janus_response,
    pixel_source_for,
    predict_caption_batch_resilient,
    prepare_colour_thumbnail,
    prepare_staging_database,
    prune,
    publish_index_databases,
    repair_classifier_json_syntax,
    resolve_caption_result,
    resolve_classifier_model_id,
    resolve_llama_server_command,
    restore_interrupted_publish,
    rewrite_default_caption_provenance,
    run_embedding_pass,
    sample_balanced_paths,
    search,
    search_similar_path,
    search_tags,
    source_digests_for,
    split_scene_path,
    update_gps,
    validate_command,
    validate_index_database,
    write_publish_journal,
)
from index import (
    scene_offsets_for as ix_scene_offsets,
)

RUN_MODEL_INFERENCE = os.environ.get("INDEX_RUN_MODEL_INFERENCE") == "1"


class FakeTensor:
    """Small mutable tensor-shaped test double for model-free logic tests."""

    def __init__(self, values):
        self.values = values

    def __iter__(self):
        return (FakeTensor(row) for row in self.values)

    def __getitem__(self, index):
        if isinstance(index, tuple):
            row, column = index
            return self.values[row][column]
        value = self.values[index]
        return FakeTensor(value) if isinstance(value, list) else value

    def __setitem__(self, index, value):
        if isinstance(index, tuple):
            row, column = index
            self.values[row][column] = value
            return
        self.values[index] = value

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.values.copy() if isinstance(self.values, list) else self.values

    def fill_(self, value):
        for position in range(len(self.values)):
            self.values[position] = value
        return self


class TestMain(unittest.TestCase):
    def test_find_files(self):
        # Five photos plus the album's video: a photo glob reports the videos
        # beside it, because both are indexed and both must be seen by prune.
        res = find_files(".", "../albums/test-simple/*.jpg")
        self.assertEqual(len(res), 6)
        self.assertEqual(
            1, len([path for path in res if path.lower().endswith(".mov")])
        )

    def test_format_mapping(self):
        actual = format_mapping({"foo": "bar", "bar": "baz"})
        expected = "foo:bar\nbar:baz"
        self.assertEqual(actual, expected)

    def test_format_mapping_values(self):
        actual = format_mapping_values({"foo": "bar", "bar": "baz"})
        expected = "bar\nbaz"
        self.assertEqual(actual, expected)

    def test_build_janus_prompt_only_requests_used_fields(self):
        actual = build_janus_prompt({"city": "Tokyo", "country": "Japan"})

        self.assertTrue("tags" in actual)
        self.assertTrue("alt_text" in actual)
        self.assertFalse("identified_objects" in actual)
        self.assertFalse('"themes"' in actual)
        self.assertFalse('"subject"' in actual)
        self.assertFalse("critique" in actual)
        self.assertFalse("suggested_title" in actual)
        self.assertFalse("composition_critique" in actual)

    def test_build_classifier_prompt_matches_janus_prompt_contract(self):
        actual = build_classifier_prompt({"city": "Tokyo", "country": "Japan"})
        janus = build_janus_prompt({"city": "Tokyo", "country": "Japan"})

        self.assertEqual(janus, f"<image_placeholder>{actual}")
        self.assertTrue("strict JSON only" in actual)

    def test_parse_janus_response_falls_back_to_plain_text(self):
        actual = parse_janus_response(
            "The photo depicts a serene sky with a bird in flight and a flock of birds."
        )

        self.assertEqual(
            actual["alt_text"],
            "The photo depicts a serene sky with a bird in flight and a flock of birds.",
        )
        self.assertTrue("serene" in actual["tags"])
        self.assertTrue("bird" in actual["tags"])

    def test_parse_janus_response_plain_text_keeps_first_complete_sentence(self):
        actual = parse_janus_response(
            "A red insect rests on a green leaf. The plant has glossy patterned leaves."
        )

        self.assertEqual(actual["alt_text"], "A red insect rests on a green leaf.")
        self.assertIn("insect", actual["tags"])

    def test_parse_janus_response_rejects_incomplete_plain_text(self):
        with self.assertRaises(ValueError):
            parse_janus_response("A red insect rests on a green")

    def test_parse_classifier_response_accepts_embedded_json(self):
        actual = parse_classifier_response(
            'Sure, here it is: {"identified_objects":["tram"],"themes":["commute"],"alt_text":"Red tram at a stop.","subject":"tram"}'
        )

        self.assertEqual(actual["tags"], ["tram", "commute"])

    def test_parse_classifier_response_prefers_last_valid_json_block(self):
        actual = parse_classifier_response(
            '<|channel>thought {"identified_objects":["wrong"],"themes":[],"alt_text":"Wrong.","subject":"wrong"} <channel|> {"identified_objects":["tram"],"themes":["commute"],"alt_text":"Red tram at a stop.","subject":"tram"}'
        )

        self.assertEqual(actual["tags"], ["tram", "commute"])

    def test_parse_classifier_response_coerces_bad_but_valid_json(self):
        # Valid JSON with wrong types must be coerced, never crash a later batch
        # insert: null lists → [], non-coercible list members dropped, numeric
        # Legacy arrays are merged and alt_text is stringified.
        actual = parse_classifier_response(
            '{"identified_objects": null, "themes": ["a", 2, ["nested"], null], '
            '"alt_text": 123, "subject": null}'
        )
        self.assertEqual(actual["tags"], ["a", "2"])
        self.assertEqual(actual["alt_text"], "123")

    def test_parse_classifier_response_repairs_observed_json_punctuation(self):
        raw = (
            'Prose {"tags":["plant","insect",]\n"alt_text":"A small insect on a leaf."}'
        )

        actual = parse_classifier_response(raw)

        self.assertEqual(actual["tags"], ["plant", "insect"])
        self.assertEqual(actual["alt_text"], "A small insect on a leaf.")
        self.assertEqual(
            repair_classifier_json_syntax('{"tags":["plant",]}'),
            '{"tags":["plant"]}',
        )

    def test_parse_classifier_response_deduplicates_tags_case_insensitively(self):
        actual = parse_classifier_response(
            '{"tags":["Water","duck","water"],"alt_text":"A duck."}'
        )

        self.assertEqual(actual["tags"], ["Water", "duck"])

    def test_parse_classifier_response_missing_key_is_malformed(self):
        # A JSON block missing a required key raises so the caller can retry the
        # model, rather than silently producing an empty caption.
        with self.assertRaises(KeyError):
            parse_classifier_response('{"identified_objects": ["x"]}')

    def test_parse_classifier_response_rejects_unbounded_or_leaked_output(self):
        with self.assertRaisesRegex(ValueError, "overlong alt text"):
            parse_classifier_response(
                json.dumps(
                    {
                        "identified_objects": ["cat"],
                        "themes": [],
                        "alt_text": "x" * 601,
                        "subject": "cat",
                    }
                )
            )
        with self.assertRaisesRegex(ValueError, "control token"):
            parse_classifier_response(
                json.dumps(
                    {
                        "identified_objects": ["cat"],
                        "themes": [],
                        "alt_text": "<|channel> leaked output",
                        "subject": "cat",
                    }
                )
            )

    def test_find_files_treats_jpg_and_jpeg_as_equivalent(self):
        # index and prune share this glob, so both extensions must be found (and
        # deduped) regardless of which the --glob names.
        with tempfile.TemporaryDirectory(dir=".") as d:
            rel = os.path.basename(d)
            for name in ["a.jpg", "b.jpeg", "c.JPG", "d.JPEG", "e.png"]:
                open(os.path.join(d, name), "w").close()

            from_jpg = sorted(
                os.path.basename(p) for p in find_files(".", f"./{rel}/*.jpg")
            )
            from_jpeg = sorted(
                os.path.basename(p) for p in find_files(".", f"./{rel}/*.jpeg")
            )

        self.assertEqual(from_jpg, ["a.jpg", "b.jpeg", "c.JPG", "d.JPEG"])
        self.assertEqual(from_jpeg, ["a.jpg", "b.jpeg", "c.JPG", "d.JPEG"])

    def test_find_files_excludes_test_albums_from_generic_production_glob(self):
        with tempfile.TemporaryDirectory(dir=".") as root:
            albums = os.path.join(root, "albums")
            os.makedirs(os.path.join(albums, "real"))
            os.makedirs(os.path.join(albums, "test-fixture"))
            open(os.path.join(albums, "real", "real.jpg"), "w").close()
            open(os.path.join(albums, "test-fixture", "fixture.jpg"), "w").close()
            relative_root = os.path.basename(root)
            pattern = f"./{relative_root}/albums/**/*.jpg"

            without_tests = find_files(".", pattern)
            with mock.patch.dict(os.environ, {"ALBUM_INCLUDE_TEST_ALBUMS": "1"}):
                with_tests = find_files(".", pattern)

        self.assertEqual(
            [os.path.basename(path) for path in without_tests], ["real.jpg"]
        )
        self.assertEqual(
            sorted(os.path.basename(path) for path in with_tests),
            ["fixture.jpg", "real.jpg"],
        )

    def _make_media_album(self, root, album="trip"):
        """Album directory plus the public poster cache the prepass writes."""
        album_dir = os.path.join(root, "albums", album)
        poster_dir = os.path.join(
            root, "src", "public", "data", "albums", album, ".resized_videos"
        )
        os.makedirs(album_dir, exist_ok=True)
        os.makedirs(poster_dir, exist_ok=True)
        return album_dir, poster_dir

    def test_find_files_includes_videos_beside_the_photos(self):
        # The photo glob is what every caller passes; videos live in the same
        # album directories and must come back from the same call so that index
        # and prune keep seeing the same set.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, _ = self._make_media_album(root)
            for name in ["a.jpg", "clip.mov", "reel.MP4", "notes.txt"]:
                open(os.path.join(album_dir, name), "w").close()

            rel = os.path.basename(root)
            found = find_files(".", f"./{rel}/albums/**/*.jpg")

        self.assertEqual(
            sorted(os.path.basename(p) for p in found),
            ["a.jpg", "clip.mov", "reel.MP4"],
        )

    def test_find_files_discovers_externals_from_the_poster_cache(self):
        # A YouTube external has no file on disk; the sidecar written for it by
        # the poster prepass is what proves it exists.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            open(os.path.join(album_dir, "a.jpg"), "w").close()
            with open(
                os.path.join(poster_dir, "ycyUWULJxdU.youtube@poster.json"), "w"
            ) as fh:
                json.dump({"mediaKind": "video", "provider": "youtube"}, fh)

            rel = os.path.basename(root)
            media_root = os.path.join(".", rel, "src", "public", "data", "albums")
            found = find_files(".", f"./{rel}/albums/**/*.jpg", media_root=media_root)

        self.assertEqual(
            sorted(os.path.basename(p) for p in found),
            ["a.jpg", "ycyUWULJxdU.youtube"],
        )
        self.assertTrue(
            any(
                os.path.join("albums", "trip", "ycyUWULJxdU.youtube") in p
                for p in found
            )
        )

    def test_pixel_source_maps_media_to_its_poster_frame(self):
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            photo = os.path.join(album_dir, "a.jpg")
            video = os.path.join(album_dir, "clip.mov")
            external = os.path.join(album_dir, "ycyUWULJxdU.youtube")

            # A photo is its own pixels.
            self.assertEqual(photo, pixel_source_for(photo, media_root))
            self.assertEqual(
                os.path.join(poster_dir, "clip.mov@poster.jpg"),
                pixel_source_for(video, media_root),
            )
            self.assertEqual(
                os.path.join(poster_dir, "ycyUWULJxdU.youtube@poster.jpg"),
                pixel_source_for(external, media_root),
            )

    def test_media_kind_distinguishes_videos_from_photos(self):
        self.assertEqual("photo", media_kind_for("../albums/trip/a.jpg"))
        self.assertEqual("video", media_kind_for("../albums/trip/clip.MOV"))
        self.assertEqual("video", media_kind_for("../albums/trip/abc.youtube"))

    def test_analyse_image_reads_place_and_time_from_a_video_sidecar(self):
        # A poster frame carries no EXIF, so the sidecar the prepass wrote is
        # the only source of the clip's wall-clock time and coordinates.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            video = os.path.join(album_dir, "clip.mov")
            open(video, "w").close()
            poster = os.path.join(poster_dir, "clip.mov@poster.jpg")
            shutil.copyfile("../albums/test-simple/DSCF0593.jpg", poster)
            with open(os.path.join(poster_dir, "clip.mov@poster.json"), "w") as fh:
                json.dump(
                    {
                        "mediaKind": "video",
                        "capturedAtLocal": "2026-02-27T10:52:10",
                        "latDeg": 35.6895,
                        "lngDeg": 139.6917,
                        "durationSeconds": 13.013,
                    },
                    fh,
                )

            with open(poster, "rb") as fh:
                analysed = analyse_image(
                    fh,
                    path=video,
                    pixel_path=poster,
                    media_root=media_root,
                    needs_core=True,
                    precomputed_colors=[],
                )

        self.assertEqual("2026-02-27T10:52:10", analysed["iso8601"])
        self.assertAlmostEqual(35.6895, analysed["lat_deg"], places=4)
        self.assertAlmostEqual(139.6917, analysed["lng_deg"], places=4)
        self.assertEqual("video", analysed["media_kind"])
        self.assertAlmostEqual(13.013, analysed["duration_seconds"], places=3)
        # The clip is placed, so it is geocoded like any photo with coordinates.
        self.assertTrue(analysed["geocode"])

    def test_insert_metadata_records_media_kind_and_duration(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "media-kind.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            db.insert_metadata(
                "../albums/trip/clip.mov",
                lat_lng_deg=(1.0, 2.0),
                iso8601="2026-02-27T10:52:10",
                media_kind="video",
                duration_seconds=13.013,
            )
            db.insert_metadata(
                "../albums/trip/a.jpg",
                lat_lng_deg=(1.0, 2.0),
                iso8601="2026-02-27T10:52:10",
            )

            with db.transaction() as cur:
                rows = dict(
                    cur.execute("SELECT path, media_kind FROM metadata").fetchall()
                )
                duration = cur.execute(
                    "SELECT duration_seconds FROM metadata WHERE path = ?",
                    ("../albums/trip/clip.mov",),
                ).fetchone()[0]

        self.assertEqual("video", rows["../albums/trip/clip.mov"])
        # Photos keep the default so that existing readers see one consistent value.
        self.assertEqual("photo", rows["../albums/trip/a.jpg"])
        self.assertAlmostEqual(13.013, duration, places=3)

    def test_prune_keeps_videos_and_externals_it_can_still_see(self):
        # Prune deletes rows whose source is gone. A video's source is its own
        # file; an external's is the sidecar in the poster cache. Neither may be
        # mistaken for an orphan, or every index run would delete its own work.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            open(os.path.join(album_dir, "a.jpg"), "w").close()
            open(os.path.join(album_dir, "clip.mov"), "w").close()
            with open(
                os.path.join(poster_dir, "ycyUWULJxdU.youtube@poster.json"), "w"
            ) as fh:
                json.dump({"mediaKind": "video", "provider": "youtube"}, fh)

            rel = os.path.basename(root)
            glob = f"./{rel}/albums/**/*.jpg"
            # Seed the database with exactly what discovery reports, so the test
            # asserts prune's decision rather than path-string formatting.
            kept = find_files(".", glob, media_root=media_root)
            orphan = os.path.join(rel, "albums", "trip", "deleted.jpg")

            with tempfile.TemporaryDirectory() as dbdir:
                dbpath = os.path.join(dbdir, "prune.sqlite")
                db = Sqlite3Client(dbpath)
                db.setup_tables()
                with db.transaction() as cur:
                    for path in [*kept, orphan]:
                        db.upsert_image_fields(
                            path, {"filename": os.path.basename(path)}, cur=cur
                        )

                result = CliRunner().invoke(
                    prune,
                    [
                        "--glob",
                        glob,
                        "--dbpath",
                        dbpath,
                        "--media-root",
                        media_root,
                        # The fixture is small enough that one orphan trips the
                        # large-partial-prune guard; the guard is not what this
                        # test is about.
                        "--force",
                    ],
                )
                self.assertEqual(0, result.exit_code, result.output)

                remaining = Sqlite3Client(dbpath, read_only=True).list_paths()

        self.assertEqual(sorted(kept), sorted(remaining))
        self.assertEqual(3, len(kept))

    def test_find_files_expands_a_video_into_its_scenes(self):
        # A long clip is indexed as its own row plus one row per extracted
        # scene, so that a moment inside it can be ranked and linked to. The
        # sidecar written by the poster prepass is the list of scenes that exist.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            open(os.path.join(album_dir, "a.jpg"), "w").close()
            open(os.path.join(album_dir, "clip.mov"), "w").close()
            with open(os.path.join(poster_dir, "clip.mov@poster.json"), "w") as fh:
                json.dump({"mediaKind": "video", "scenes": [60, 120]}, fh)

            rel = os.path.basename(root)
            found = find_files(".", f"./{rel}/albums/**/*.jpg", media_root=media_root)

        self.assertEqual(
            sorted(os.path.basename(p) for p in found),
            ["a.jpg", "clip.mov", "clip.mov@t120", "clip.mov@t60"],
        )

    def test_scene_paths_resolve_to_their_own_frame(self):
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            scene = os.path.join(album_dir, "clip.mov@t60")

            self.assertEqual("video", media_kind_for(scene))
            self.assertEqual(
                os.path.join(poster_dir, "clip.mov@t60@poster.jpg"),
                pixel_source_for(scene, media_root),
            )
            self.assertEqual(
                (os.path.join(album_dir, "clip.mov"), 60.0), split_scene_path(scene)
            )
            self.assertEqual(
                (os.path.join(album_dir, "clip.mov"), None),
                split_scene_path(os.path.join(album_dir, "clip.mov")),
            )

    def test_analyse_image_dates_a_scene_from_its_offset_into_the_clip(self):
        # A scene is a moment of the clip, so it carries the clip's place and
        # the clip's start time plus its own offset — that is what puts it in
        # the right order against the photos taken around it.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            scene = os.path.join(album_dir, "clip.mov@t90")
            poster = os.path.join(poster_dir, "clip.mov@t90@poster.jpg")
            shutil.copyfile("../albums/test-simple/DSCF0593.jpg", poster)
            with open(os.path.join(poster_dir, "clip.mov@poster.json"), "w") as fh:
                json.dump(
                    {
                        "mediaKind": "video",
                        "capturedAtLocal": "2026-02-27T10:52:10",
                        "latDeg": 35.6895,
                        "lngDeg": 139.6917,
                        "durationSeconds": 600.0,
                        "scenes": [90],
                    },
                    fh,
                )

            with open(poster, "rb") as fh:
                analysed = analyse_image(
                    fh,
                    path=scene,
                    pixel_path=poster,
                    media_root=media_root,
                    needs_core=True,
                    precomputed_colors=[],
                )

        self.assertEqual("2026-02-27T10:53:40", analysed["iso8601"])
        self.assertEqual("video", analysed["media_kind"])
        self.assertEqual(90.0, analysed["scene_seconds"])
        self.assertAlmostEqual(35.6895, analysed["lat_deg"], places=4)

    def test_scene_rows_link_into_the_clip_at_their_moment(self):
        self.assertEqual(
            "/album/trip?t=90#clip.mov",
            get_album_relative_path("../albums/trip/clip.mov@t90"),
        )
        self.assertEqual(
            "/album/trip#clip.mov", get_album_relative_path("../albums/trip/clip.mov")
        )

    def test_scenes_are_planned_for_embeddings_only(self):
        # Captioning every minute of a long clip would cost as much as the whole
        # photo library; the frame's embedding is what makes it findable, and the
        # clip's own row carries the caption.
        self.assertFalse(needs_caption_for("../albums/trip/clip.mov@t60"))
        self.assertTrue(needs_caption_for("../albums/trip/clip.mov"))
        self.assertTrue(needs_caption_for("../albums/trip/a.jpg"))

    def test_update_gps_leaves_videos_alone(self):
        # update-gps re-reads EXIF from each indexed file. A video has none: its
        # time and place come from the sidecar the poster prepass wrote, so
        # re-reading it would blank exactly the fields this command exists to
        # maintain.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, _poster_dir = self._make_media_album(root)
            video = os.path.join(album_dir, "clip.mov")
            shutil.copyfile("../albums/test-simple/DSCF0159.MOV", video)

            with tempfile.TemporaryDirectory() as dbdir:
                dbpath = os.path.join(dbdir, "update-gps-video.sqlite")
                db = Sqlite3Client(dbpath)
                db.setup_tables()
                with db.transaction() as cur:
                    db.upsert_image_fields(video, {"filename": "clip.mov"}, cur=cur)
                    db.insert_metadata(
                        video,
                        lat_lng_deg=(35.6895, 139.6917),
                        iso8601="2026-02-27T10:52:10",
                        cur=cur,
                        media_kind="video",
                        duration_seconds=13.013,
                    )

                result = CliRunner().invoke(update_gps, ["--dbpath", dbpath])
                self.assertEqual(0, result.exit_code, result.output)

                with Sqlite3Client(dbpath, read_only=True).transaction() as cur:
                    row = cur.execute(
                        "SELECT iso8601, lat_deg, media_kind, duration_seconds "
                        "FROM metadata WHERE path = ?",
                        (video,),
                    ).fetchone()

        self.assertEqual("2026-02-27T10:52:10", row[0])
        self.assertAlmostEqual(35.6895, row[1], places=4)
        self.assertEqual("video", row[2])
        self.assertAlmostEqual(13.013, row[3], places=3)

    def test_insert_metadata_keeps_a_duration_a_later_write_does_not_carry(self):
        # Other writers (update-gps, backfills) call insert_metadata with only
        # the fields they know about; a clip's length must survive them.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "duration.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            db.insert_metadata(
                "../albums/trip/clip.mov",
                lat_lng_deg=(1.0, 2.0),
                iso8601="2026-02-27T10:52:10",
                media_kind="video",
                duration_seconds=13.013,
            )
            db.insert_metadata(
                "../albums/trip/clip.mov",
                lat_lng_deg=(3.0, 4.0),
                iso8601="2026-02-27T10:52:10",
            )

            with db.transaction() as cur:
                row = cur.execute(
                    "SELECT lat_deg, duration_seconds, media_kind FROM metadata WHERE path = ?",
                    ("../albums/trip/clip.mov",),
                ).fetchone()

        self.assertAlmostEqual(3.0, row[0])
        self.assertAlmostEqual(13.013, row[1], places=3)
        self.assertEqual("video", row[2])

    def test_pixel_reads_follow_the_configured_media_root(self):
        # --media-root moves the poster cache; the models, the colour extractor
        # and the digests all have to read from the same place discovery does.
        with tempfile.TemporaryDirectory(dir=".") as root:
            _album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            scene = os.path.join(root, "albums", "trip", "clip.mov@t60")

            with configured_media_root(media_root):
                self.assertEqual(
                    os.path.join(poster_dir, "clip.mov@t60@poster.jpg"),
                    pixel_source_for(scene),
                )

            # Restored afterwards, so one run cannot leak into the next.
            self.assertNotEqual(
                os.path.join(poster_dir, "clip.mov@t60@poster.jpg"),
                pixel_source_for(scene),
            )

    def test_validate_accepts_a_clip_whose_scenes_have_no_captions(self):
        # Scenes hold a row and a vector but never a caption, so the caption
        # coverage check has to expect them to be absent. A live validate run is
        # what caught this: the provenance loop and the coverage check are two
        # separate gates over the same paths.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            video = os.path.join(album_dir, "clip.mov")
            shutil.copyfile("../albums/test-simple/DSCF0159.MOV", video)
            for name in ["clip.mov@poster.jpg", "clip.mov@t60@poster.jpg"]:
                shutil.copyfile(
                    "../albums/test-simple/DSCF0593.jpg", os.path.join(poster_dir, name)
                )
            with open(os.path.join(poster_dir, "clip.mov@poster.json"), "w") as fh:
                json.dump(
                    {
                        "mediaKind": "video",
                        "capturedAtLocal": "2026-02-27T10:52:10",
                        "durationSeconds": 200.0,
                        "scenes": [60],
                    },
                    fh,
                )

            rel = os.path.basename(root)
            glob = f"./{rel}/albums/**/*.jpg"
            with configured_media_root(media_root):
                paths = find_files(".", glob, media_root=media_root)
                digests = source_digests_for(paths, media_root)

                with tempfile.TemporaryDirectory() as dbdir:
                    dbpath = os.path.join(dbdir, "validate-scenes.sqlite")
                    db = Sqlite3Client(dbpath)
                    db.setup_tables()
                    with db.transaction() as cur:
                        for path in paths:
                            fields = {"filename": os.path.basename(path)}
                            # Only the clip is captioned, exactly as an index run
                            # would leave it.
                            if needs_caption_for(path):
                                fields.update(
                                    {
                                        "tags": "harbour, market",
                                        "alt_text": "A harbour clip.",
                                    }
                                )
                            db.upsert_image_fields(path, fields, cur=cur)
                            db.insert_metadata(
                                path,
                                lat_lng_deg=(None, None),
                                iso8601="2026-02-27T10:52:10",
                                cur=cur,
                            )
                            db.upsert_pipeline_state(
                                path,
                                CORE_STAGE,
                                digests[path],
                                CORE_PIPELINE_VERSION,
                                cur=cur,
                            )
                            if needs_caption_for(path):
                                db.upsert_pipeline_state(
                                    path,
                                    CAPTION_STAGE,
                                    digests[path],
                                    caption_pipeline_version(CLASSIFIER_BACKEND_JANUS),
                                    JANUS_MODEL_ID,
                                    cur,
                                )
                        db.replace_tags_for_source(
                            paths[0], ["harbour", "market"], "classifier", cur
                        )
                        db.rebuild_tag_counts(cur)

                    summary = validate_index_database(
                        dbpath,
                        glob,
                        MODEL_PROFILE_JANUS,
                        CLASSIFIER_BACKEND_JANUS,
                        media_root=media_root,
                    )

        self.assertEqual(2, summary["paths"])

    def test_scene_rows_carry_no_searchable_text(self):
        # The FTS table indexes `filename`, and the browser searches it, so a
        # scene row named "clip.mov@t60" would answer a keyword search for the
        # clip by name with every minute of it — the flooding scenes exist to
        # avoid. A scene is reachable by vector ranking alone.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "scene-text.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": "../albums/trip/clip.mov",
                        "analysed": {
                            "exif": {},
                            "geocode": {},
                            "colors": [],
                            "tags": ["harbour"],
                            "alt_text": "A harbour clip.",
                            "iso8601": "2026-02-27T10:52:10",
                            "media_kind": "video",
                        },
                        "write_core": True,
                        "write_caption": True,
                    },
                    {
                        "path": "../albums/trip/clip.mov@t60",
                        "analysed": {
                            "exif": {},
                            "geocode": {},
                            "colors": [],
                            "tags": [],
                            "alt_text": None,
                            "iso8601": "2026-02-27T10:53:10",
                            "media_kind": "video",
                            "scene_seconds": 60.0,
                        },
                        "write_core": True,
                        "write_caption": False,
                    },
                ],
            )

            with db.transaction() as cur:
                scene = cur.execute(
                    "SELECT filename, album_relative_path, tags, alt_text, colors, geocode "
                    "FROM images WHERE path = ?",
                    ("../albums/trip/clip.mov@t60",),
                ).fetchone()
                # The same query shape the browser sends.
                matched = [
                    row[0]
                    for row in cur.execute(
                        "SELECT path FROM images WHERE images MATCH ?",
                        ('- {path album_relative_path exif colors} : "clip"',),
                    )
                ]

        # Only the link survives, because a tile needs somewhere to go.
        self.assertEqual("/album/trip?t=60#clip.mov", scene[1])
        self.assertFalse(any(scene[index] for index in (0, 2, 3, 4, 5)))
        # The clip answers for itself; its minutes do not answer alongside it.
        self.assertEqual(["../albums/trip/clip.mov"], matched)

    def test_a_corrupt_sidecar_cannot_take_down_an_index_run(self):
        # Sidecars are written by the poster prepass, so garbage means a
        # truncated write or a tampered file — and one of those must not abort a
        # run over thousands of photos. Everything unreadable is ignored the way
        # malformed GPS already is.
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            video = os.path.join(album_dir, "clip.mov")
            open(video, "w").close()
            sidecar_path = os.path.join(poster_dir, "clip.mov@poster.json")

            hostile = [
                "{oops",
                json.dumps([]),
                json.dumps("a string"),
                json.dumps({"scenes": "60"}),
                json.dumps({"scenes": {"a": 1}}),
                json.dumps(
                    {
                        "capturedAtLocal": "not a date",
                        "latDeg": "north",
                        "lngDeg": "east",
                        "durationSeconds": "long",
                    }
                ),
            ]

            for payload in hostile:
                with open(sidecar_path, "w") as fh:
                    fh.write(payload)

                self.assertEqual([], ix_scene_offsets(video, media_root))

                with open("../albums/test-simple/DSCF0593.jpg", "rb") as fh:
                    analysed = analyse_image(
                        fh,
                        path=video,
                        pixel_path="../albums/test-simple/DSCF0593.jpg",
                        media_root=media_root,
                        needs_core=True,
                        precomputed_colors=[],
                    )

                # Nothing unusable reaches the database: a bad duration is no
                # duration, and a bad timestamp leaves the photo's own reading.
                self.assertIsNone(analysed["duration_seconds"])
                self.assertNotEqual("not a date", analysed["iso8601"])
                self.assertIsInstance(analysed["lat_deg"], (float, type(None)))

    def test_sidecar_scene_offsets_ignore_unusable_entries(self):
        with tempfile.TemporaryDirectory(dir=".") as root:
            album_dir, poster_dir = self._make_media_album(root)
            media_root = os.path.join(root, "src", "public", "data", "albums")
            video = os.path.join(album_dir, "clip.mov")
            open(video, "w").close()
            with open(os.path.join(poster_dir, "clip.mov@poster.json"), "w") as fh:
                json.dump({"scenes": [None, "x", 60, 120.5, True]}, fh)

            # Booleans are integers in Python; a scene at "1 second" invented by
            # a `true` in the list would be indexed as a real moment.
            self.assertEqual([60.0, 120.5], ix_scene_offsets(video, media_root))

    def test_run_embedding_pass_skips_unreadable_images(self):
        # A None embedding (unreadable/corrupt image) must be skipped, not stored,
        # and must not abort the pass.
        class StubEmbedder:
            model_id = "stub-model"

            def init_model(self):
                pass

            def predict_image_embeddings_batch(self, paths):
                return [None if p == "bad.jpg" else [float(len(p))] for p in paths]

            def release(self):
                pass

        precomputed = {}
        with mock.patch("index.log_vram"), mock.patch("index.log"):
            run_embedding_pass(StubEmbedder(), ["good.jpg", "bad.jpg"], precomputed)
        self.assertIn("good.jpg", precomputed)
        self.assertNotIn("bad.jpg", precomputed)

    def test_caption_batch_oom_falls_back_to_smaller_batches(self):
        class StubClassifier:
            def __init__(self):
                self.batch_sizes = []
                self.last_generation_metrics = []

            def predict_batch(self, items):
                self.batch_sizes.append(len(items))
                if len(items) > 1:
                    raise RuntimeError("CUDA out of memory")
                self.last_generation_metrics = [{"tokenCount": 12}]
                return [items[0][0]]

        classifier = StubClassifier()
        items = [(f"{index}.jpg", {}) for index in range(4)]
        with mock.patch("index.torch.cuda.empty_cache"), mock.patch("index.log"):
            results, metrics = predict_caption_batch_resilient(classifier, items)

        self.assertEqual(results, ["0.jpg", "1.jpg", "2.jpg", "3.jpg"])
        self.assertEqual(classifier.batch_sizes, [4, 2, 1, 1, 2, 1, 1])
        self.assertTrue(all(metric["oomFallback"] for metric in metrics))

    def test_janus_metrics_ignore_eos_padding_and_flag_only_straggler(self):
        classifier = JanusClassifier(max_new_tokens=5)
        classifier.tokenizer = mock.Mock(eos_token_id=2)
        classifier.tokenizer.decode.side_effect = [
            '{"done": true}',
            "unfinished",
        ]
        classifier._record_generation_metrics(
            FakeTensor(
                [
                    [10, 11, 2, 2, 2],
                    [20, 21, 22, 23, 24],
                ]
            )
        )
        self.assertEqual(
            classifier.last_generation_metrics,
            [
                {
                    "tokenCount": 3,
                    "completedWithEos": True,
                    "completedWithJson": True,
                    "completedWithSchema": True,
                    "hitTokenLimit": False,
                },
                {
                    "tokenCount": 5,
                    "completedWithEos": False,
                    "completedWithJson": False,
                    "completedWithSchema": False,
                    "hitTokenLimit": True,
                },
            ],
        )

    def test_complete_json_object_end_ignores_braces_inside_strings(self):
        value = 'preface {"alt_text": "A {brace} and \\"quote\\""} trailing'

        end = complete_json_object_end(value)

        self.assertEqual(
            value[:end], 'preface {"alt_text": "A {brace} and \\"quote\\""}'
        )
        self.assertIsNone(complete_json_object_end('{"alt_text": "unfinished"'))

    def test_complete_classifier_json_prefix_stops_repeated_schema_fields(self):
        repeated = (
            '{"alt_text":"A snowy mountain.",'
            '"tags":["mountain","winter"],'
            '"alt_text":"A snowy mountain.","tags":["mountain"]'
        )

        repaired = complete_classifier_json_prefix(repeated)

        self.assertIsNotNone(repaired)
        self.assertEqual(parse_classifier_response(repaired)["tags"][0], "mountain")

    def test_complete_classifier_json_prefix_salvages_proven_tag_loop(self):
        repeated = (
            '{"alt_text":"A duck swimming on water.",'
            '"tags":["duck","water","wildlife","reflection","water","water"'
        )

        repaired = complete_classifier_json_prefix(repeated)

        self.assertEqual(
            parse_classifier_response(repaired),
            {
                "alt_text": "A duck swimming on water.",
                "tags": ["duck", "water", "wildlife", "reflection"],
            },
        )

    def test_complete_classifier_json_prefix_does_not_close_unproven_tags(self):
        partial = '{"alt_text":"A duck.","tags":["duck","water"'

        self.assertIsNone(complete_classifier_json_prefix(partial))

    def test_repeated_open_classifier_tags_requires_four_unique_then_repeat(self):
        loop = '{"tags":["duck","water","wildlife","reflection","water","water"'

        self.assertTrue(has_repeated_open_classifier_tags(loop))
        self.assertFalse(
            has_repeated_open_classifier_tags('{"tags":["duck","water","water"')
        )
        self.assertFalse(
            has_repeated_open_classifier_tags(
                '{"tags":["duck","water","wildlife","reflection"]'
            )
        )

    def test_json_completion_logits_processor_forces_eos_per_complete_row(self):
        tokenizer = mock.Mock()
        tokenizer.decode.side_effect = ['{"done": true}', '{"still":']
        processor = JsonCompletionLogitsProcessor(tokenizer, eos_token_id=2)
        scores = FakeTensor([[0.0] * 5 for _ in range(2)])

        actual = processor(FakeTensor([[1, 2], [3, 4]]), scores).tolist()

        self.assertEqual(actual[0][2], 0.0)
        self.assertTrue(math.isinf(actual[0][0]) and actual[0][0] < 0)
        self.assertEqual(actual[1], [0.0] * 5)

    def test_json_completion_logits_processor_closes_repeated_tag_array(self):
        tokenizer = mock.Mock()
        tokenizer.encode.return_value = [4]
        tokenizer.decode.return_value = (
            '{"tags":["duck","water","wildlife","reflection","water"'
        )
        processor = JsonCompletionLogitsProcessor(tokenizer, eos_token_id=2)

        actual = processor(FakeTensor([[1, 2]]), FakeTensor([[0.0] * 6])).tolist()

        self.assertEqual(actual[0][4], 0.0)
        self.assertTrue(math.isinf(actual[0][0]) and actual[0][0] < 0)

    def test_filter_exif_for_search_keeps_only_useful_fields(self):
        actual = filter_exif_for_search(
            {
                "Image Make": "FUJIFILM",
                "Image Model": "X-T5",
                "EXIF LensModel": "XF16-80mmF4 R OIS WR",
                "EXIF FocalLength": "80",
                "EXIF DateTimeOriginal": "2024:11:02 09:00:00",
                "GPS GPSLatitude": "[35, 0, 0]",
                "MakerNote Tag 0x100B": "256",
                "Thumbnail JPEGInterchangeFormat": "1002",
                "Image Software": "Adobe Photoshop",
            }
        )

        self.assertEqual(
            actual,
            {
                "Image Make": "FUJIFILM",
                "Image Model": "X-T5",
                "EXIF LensModel": "XF16-80mmF4 R OIS WR",
                "EXIF FocalLength": "80",
                "EXIF DateTimeOriginal": "2024:11:02 09:00:00",
                "GPS GPSLatitude": "[35, 0, 0]",
            },
        )

    def test_get_exif_skips_unused_embedded_details(self):
        handle = mock.Mock()
        with mock.patch("index.exifread.process_file", return_value={}) as process_file:
            self.assertEqual(get_exif(handle), {})

        process_file.assert_called_once_with(handle, details=False)

    def test_colour_thumbnail_bounds_large_input_and_palette_remains_available(self):
        path = "../src/test/fixtures/monkey.jpg"

        thumbnail = prepare_colour_thumbnail(path, max_dimension=128)
        palette = extract_colour_palette(path)

        self.assertLessEqual(max(thumbnail.shape[:2]), 128)
        self.assertEqual(thumbnail.shape[2], 4)
        self.assertGreater(len(palette), 0)

    def test_create_classifier_supports_janus_gemma_and_gguf(self):
        janus = create_classifier("janus")
        gemma = create_classifier(
            "gemma4",
            model_id="google/gemma-4-E2B-it",
            quantization=None,
            batch_size=1,
            gpu_headroom_gb=3.0,
            low_impact=True,
        )
        gemma_gguf = create_classifier(
            "gemma4-gguf",
            model_id="unsloth/gemma-4-E4B-it-GGUF:Q8_0",
        )

        self.assertEqual(type(janus), JanusClassifier)
        self.assertEqual(type(gemma), Gemma4Classifier)
        self.assertEqual(type(gemma_gguf), Gemma4GgufClassifier)
        self.assertEqual(gemma.model_id, "google/gemma-4-E2B-it")
        self.assertEqual(gemma.quantization, None)
        self.assertEqual(gemma.gpu_headroom_gb, 3.0)
        self.assertEqual(gemma.low_impact, True)
        self.assertEqual(gemma_gguf.model_id, "unsloth/gemma-4-E4B-it-GGUF:Q8_0")

    def test_evaluate_tag_quality_scores_tags_without_the_alt_sentence(self):
        """Tags carry the FTS index, so a good sentence must not mask bad tags."""
        cases = [{"path": "a.jpg", "requiredAny": ["ramen"]}]
        # Real Janus output shape: the concept only exists in the sentence, and
        # the tags are bare words lifted out of it, including a junk head verb.
        captions = {
            "a.jpg": {
                "tags": ["image", "bowl", "chopsticks"],
                "alt_text": "The image shows a bowl of ramen with chopsticks.",
            }
        }

        actual = evaluate_tag_quality(cases, captions)

        self.assertFalse(actual["cases"][0]["conceptInTags"])
        self.assertEqual(actual["cases"][0]["junkTags"], ["image"])
        self.assertEqual(actual["cases"][0]["tagCount"], 3)
        self.assertEqual(actual["junkTagRate"], 1 / 3)
        self.assertEqual(actual["conceptCoverage"], 0.0)

    def test_evaluate_tag_quality_rewards_concrete_phrases(self):
        cases = [{"path": "a.jpg", "requiredAny": ["ramen"]}]
        captions = {
            "a.jpg": {
                "tags": ["ramen bowl", "pork bone broth", "wooden table"],
                "alt_text": "A bowl of ramen on a wooden table.",
            }
        }

        actual = evaluate_tag_quality(cases, captions)

        self.assertTrue(actual["cases"][0]["conceptInTags"])
        self.assertEqual(actual["cases"][0]["junkTags"], [])
        self.assertEqual(actual["phraseRate"], 1.0)
        self.assertEqual(actual["conceptCoverage"], 1.0)

    def test_resolve_classifier_model_id_fills_backend_defaults(self):
        # Provenance must name the model that actually ran; an unset CLI id
        # resolves to each backend's effective default, not None.
        self.assertEqual(
            resolve_classifier_model_id(CLASSIFIER_BACKEND_JANUS), JANUS_MODEL_ID
        )
        self.assertEqual(
            resolve_classifier_model_id(CLASSIFIER_BACKEND_GEMMA4_GGUF),
            DEFAULT_GEMMA4_GGUF_MODEL_ID,
        )
        self.assertEqual(
            resolve_classifier_model_id(CLASSIFIER_BACKEND_GEMMA4_GGUF, "custom:tag"),
            "custom:tag",
        )

    def test_changing_default_gguf_model_bumps_caption_pipeline_version(self):
        """Changing a backend's default model must change the computed pipeline
        version (and name the model), or stale captions validate as current when
        the default drifts, e.g. Q8_0 -> UD-Q4_K_XL."""
        baseline = caption_pipeline_version(CLASSIFIER_BACKEND_GEMMA4_GGUF)
        self.assertIn(DEFAULT_GEMMA4_GGUF_MODEL_ID, baseline)
        self.assertNotIn("default@external", baseline)

        with mock.patch(
            "index.DEFAULT_GEMMA4_GGUF_MODEL_ID", "unsloth/other-model-GGUF:Q2_K"
        ):
            changed = caption_pipeline_version(CLASSIFIER_BACKEND_GEMMA4_GGUF)

        self.assertNotEqual(baseline, changed)
        self.assertIn("unsloth/other-model-GGUF:Q2_K", changed)

    def test_normalise_classifier_tags_drops_degenerate_stopwords(self):
        # Junk single words the model lifts from its own sentence must never reach
        # the FTS tags column, whatever backend produced them; real multi-word
        # tags keep an underscore and survive.
        tags = normalise_classifier_tags(
            {"tags": ["image", "Depicts", "ramen bowl", "the", "chopsticks"]}
        )

        self.assertEqual(tags, ["ramen_bowl", "chopsticks"])

    def test_validate_default_backend_tracks_index_default(self):
        """validate recomputes the expected caption version from its backend, so if
        its default drifts from index's, a correctly-indexed DB is rejected — which
        is exactly the do-full-index abort this guards against."""

        def default_backend(command):
            (option,) = [p for p in command.params if p.name == "classifier_backend"]
            return option.default

        self.assertEqual(default_backend(validate_command), default_backend(index))

    def test_gemma_gguf_request_disables_thinking_and_constrains_json(self):
        """Without enable_thinking=false Gemma 4 spends the whole token budget in
        reasoning_content and returns an empty message, so the request must carry it."""
        classifier = Gemma4GgufClassifier(
            model_id="/models/m.gguf", quantization="/models/p.gguf"
        )
        body = classifier._build_request_body("a prompt", "BASE64DATA")

        self.assertFalse(body["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertEqual(
            sorted(body["response_format"]["json_schema"]["schema"]["required"]),
            ["alt_text", "tags"],
        )
        content = body["messages"][0]["content"]
        self.assertEqual(
            content[0]["image_url"]["url"], "data:image/jpeg;base64,BASE64DATA"
        )
        self.assertEqual(content[1]["text"], "a prompt")

    def test_gemma_gguf_reads_content_and_rejects_an_empty_thinking_only_reply(self):
        classifier = Gemma4GgufClassifier()
        good = {
            "choices": [{"message": {"content": '{"tags": ["a"], "alt_text": "b"}'}}]
        }
        self.assertEqual(
            classifier._read_completion(good), '{"tags": ["a"], "alt_text": "b"}'
        )

        # The failure mode this port exists to avoid: all budget spent thinking.
        empty = {
            "choices": [
                {
                    "finish_reason": "length",
                    "message": {"content": "", "reasoning_content": "Let me think..."},
                }
            ]
        }
        with self.assertRaises(RuntimeError) as raised:
            classifier._read_completion(empty)
        self.assertIn("reasoning", str(raised.exception).lower())

    def test_resolve_llama_server_command_does_not_fall_back_to_tmp(self):
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch("index.shutil.which", return_value=None),
            mock.patch("index.DEFAULT_LLAMA_SERVER_PATHS", ()),
            self.assertRaises(RuntimeError) as raised,
        ):
            resolve_llama_server_command()
        self.assertIn("llama.cpp", str(raised.exception))
        self.assertTrue(
            all(not p.startswith("/tmp/") for p in DEFAULT_LLAMA_SERVER_PATHS),
            DEFAULT_LLAMA_SERVER_PATHS,
        )

    def test_sweep_stale_stderr_logs_only_removes_old_log_files(self):
        # The sweep must reclaim its own stale stderr logs (llama-server-*.log)
        # without touching an unrelated old file that merely shares the
        # llama-server- prefix — e.g. a llama-server binary or tarball parked in
        # the shared temp dir, a real historical habit on this machine.
        with tempfile.TemporaryDirectory() as tmpdir:
            stale_log = Path(tmpdir) / "llama-server-abcd.log"
            binary = Path(tmpdir) / "llama-server-binary"
            fresh_log = Path(tmpdir) / "llama-server-efgh.log"
            for entry in (stale_log, binary, fresh_log):
                entry.write_bytes(b"")
            # Age the stale log and the binary well past the 7-day cutoff.
            for entry in (stale_log, binary):
                os.utime(entry, (0, 0))

            with mock.patch("index.tempfile.gettempdir", return_value=tmpdir):
                Gemma4GgufClassifier._sweep_stale_stderr_logs()

            self.assertFalse(stale_log.exists(), "stale .log should be swept")
            self.assertTrue(binary.exists(), "non-.log file must be preserved")
            self.assertTrue(fresh_log.exists(), "recent .log must be preserved")

    def test_benchmark_caption_quality_runs_the_requested_backend(self):
        class StubClassifier:
            model_id = "unsloth/gemma-4-E4B-it-GGUF:Q8_0"
            quantization = None
            batch_size = 1

            def __init__(self):
                self.last_generation_metrics = []

            def init_model(self):
                pass

            def release(self):
                pass

            def predict_batch(self, items):
                self.last_generation_metrics = [
                    {"completedWithEos": True} for _ in items
                ]
                return [
                    json.dumps(
                        {"tags": ["mountain", "snow"], "alt_text": "A snowy peak."}
                    )
                    for _ in items
                ]

        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = os.path.join(tmpdir, "peak.jpg")
            Path(image_path).write_bytes(b"")
            fixture_path = os.path.join(tmpdir, "fixture.json")
            output_path = os.path.join(tmpdir, "result.json")
            with open(fixture_path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "version": 1,
                        "cases": [
                            {
                                "path": image_path,
                                "category": "snowy landscape",
                                "requiredAny": ["mountain"],
                                "forbidden": ["beach"],
                            }
                        ],
                    },
                    fh,
                )

            stub = StubClassifier()
            # Take a throwaway fd rather than the real global lock: the command
            # closes whatever it is given, and holding the true lock would make
            # this test fail whenever a real benchmark happens to be running.
            with (
                mock.patch("index.create_classifier", return_value=stub) as create,
                mock.patch(
                    "index.acquire_single_instance_lock",
                    side_effect=lambda *a, **k: os.open(os.devnull, os.O_RDONLY),
                ),
                mock.patch("index.log"),
            ):
                result = CliRunner().invoke(
                    benchmark_caption_quality,
                    [
                        "--fixture",
                        fixture_path,
                        "--backend",
                        "gemma4-gguf",
                        "--output",
                        output_path,
                    ],
                )

            self.assertEqual(result.exit_code, 0, result.output)
            self.assertEqual(create.call_args.kwargs["backend"], "gemma4-gguf")

            with open(output_path, encoding="utf-8") as fh:
                payload = json.load(fh)

        self.assertTrue(payload["passed"])
        self.assertEqual(payload["backend"], "gemma4-gguf")
        self.assertEqual(payload["modelId"], "unsloth/gemma-4-E4B-it-GGUF:Q8_0")
        self.assertIn("gemma4-gguf", payload["pipelineVersion"])
        # The tag-only quality metric is surfaced alongside the joined score so a
        # good alt sentence cannot hide unusable tags.
        self.assertIn("tagQuality", payload)
        self.assertIn("junkTagRate", payload["tagQuality"])
        self.assertIn("conceptCoverage", payload["tagQuality"])

    def test_sample_balanced_paths_spreads_across_groups(self):
        paths = [
            "albums/a/1.jpg",
            "albums/a/2.jpg",
            "albums/b/1.jpg",
            "albums/b/2.jpg",
            "albums/c/1.jpg",
        ]

        actual = sample_balanced_paths(paths, sample_size=3, seed=1)
        parents = {os.path.dirname(path) for path in actual}

        self.assertEqual(len(actual), 3)
        self.assertEqual(len(parents), 3)

    def test_compare_caption_payloads_flags_candidate_specificity(self):
        actual = compare_caption_payloads(
            {
                "tags": "tram, stop",
                "alt_text": "Tram",
                "subject": "tram",
            },
            {
                "identified_objects": ["tram", "platform", "wires"],
                "themes": ["commute"],
                "alt_text": "A red tram waiting at a city platform under overhead wires.",
                "subject": "red tram",
            },
        )

        self.assertEqual(actual["verdict"], "candidate_better")
        self.assertTrue("candidate_adds_tags" in actual["reasons"])

    def test_evaluate_caption_quality_cases_checks_required_and_forbidden_terms(self):
        cases = [
            {
                "path": "monkey.jpg",
                "requiredAny": ["monkey", "macaque"],
                "forbidden": ["dog"],
            },
            {"path": "dam.jpg", "requiredAny": ["dam"]},
        ]
        captions = {
            "monkey.jpg": {
                "identified_objects": ["macaque"],
                "themes": ["wildlife"],
                "alt_text": "A macaque in a forest.",
                "subject": "macaque",
            },
            "dam.jpg": {
                "identified_objects": ["bridge"],
                "themes": [],
                "alt_text": "A bridge over water.",
                "subject": "bridge",
            },
        }

        result = evaluate_caption_quality_cases(cases, captions)

        self.assertFalse(result["passed"])
        self.assertEqual(result["passedCases"], 1)
        self.assertEqual(result["cases"][1]["reasons"], ["missing_required_concept"])

    @unittest.skipUnless(
        RUN_MODEL_INFERENCE,
        "Set INDEX_RUN_MODEL_INFERENCE=1 to run live model inference tests",
    )
    def test_analyse_image_worker_with_janus(self):
        import torch

        if not torch.cuda.is_available():
            self.skipTest("Janus inference requires CUDA")

        classifier = JanusClassifier()
        classifier.init_model()
        idx = 0
        path = "../src/test/fixtures/monkey.jpg"
        # Mirror the production Janus pass: predict + parse while the model is
        # loaded, then assemble from the precomputed result (no live model).
        raw = classifier.predict(path=path, geocode=None)
        precomputed_caption = parse_caption_with_retry(classifier, path, None, raw)
        input_tuple = (
            idx,
            path,
            True,
            True,
            precomputed_caption,
            None,
            None,
            file_content_sha256(path),
            "test-caption-v1",
            "test-model",
        )

        actual = analyse_image_worker(input_tuple)
        analysed = actual.get("analysed")

        self.assertGreater(len(analysed.get("tags")), 0)
        self.assertGreater(len(analysed.get("alt_text")), 0)
        self.assertGreater(len(analysed.get("subject")), 0)
        self.assertGreater(len(analysed.get("geocode").get("city")), 0)
        self.assertEqual(isinstance(analysed.get("exif"), dict), True)
        self.assertGreater(len(analysed.get("iso8601")), 0)
        self.assertEqual(len(analysed.get("colors")), 9)
        self.assertEqual(analysed.get("lat_deg"), 1.3714833333333334)
        self.assertEqual(analysed.get("lng_deg"), 103.7822)

    def test_single_instance_lock_blocks_second_run(self):
        with tempfile.TemporaryDirectory() as d:
            dbpath = os.path.join(d, "x.sqlite")
            fd = acquire_single_instance_lock(dbpath)
            try:
                with self.assertRaises(click.ClickException):
                    acquire_single_instance_lock(dbpath)
            finally:
                os.close(fd)

    def test_single_instance_lock_records_holder_pid(self):
        with tempfile.TemporaryDirectory() as d:
            dbpath = os.path.join(d, "x.sqlite")
            fd = acquire_single_instance_lock(dbpath)
            try:
                with open(f"{dbpath}.lock") as handle:
                    self.assertEqual(handle.read().strip(), str(os.getpid()))
            finally:
                os.close(fd)

    def test_single_instance_lock_released_on_close(self):
        with tempfile.TemporaryDirectory() as d:
            dbpath = os.path.join(d, "x.sqlite")
            os.close(acquire_single_instance_lock(dbpath))  # simulates exit
            # A fresh run can now take the lock again.
            os.close(acquire_single_instance_lock(dbpath))

    def test_heartbeat_beats_while_running(self):
        heartbeat_waits = iter([False, False, True])
        real_event_wait = threading.Event.wait

        def controlled_wait(event, timeout=None):
            if timeout == 0.05:
                return next(heartbeat_waits)
            return real_event_wait(event, timeout)

        with (
            mock.patch("index.threading.Event.wait", new=controlled_wait),
            mock.patch("index.log") as mock_log,
            heartbeat("test op", interval_s=0.05),
        ):
            pass
        messages = [call.args[0] for call in mock_log.call_args_list]
        self.assertEqual(len(messages), 2)
        self.assertTrue(all("still running" in m for m in messages))

    def test_heartbeat_silent_when_fast(self):
        with mock.patch("index.log") as mock_log, heartbeat("test op", interval_s=10.0):
            pass
        self.assertEqual(mock_log.call_args_list, [])

    def test_log_vram_is_noop_without_cuda(self):
        with (
            mock.patch("index.torch.cuda.is_available", return_value=False),
            mock.patch("index.log") as mock_log,
        ):
            log_vram("load")
            log_vram_peak()
        self.assertEqual(mock_log.call_args_list, [])

    def test_log_vram_reports_card_usage(self):
        with (
            mock.patch("index.torch.cuda.is_available", return_value=True),
            mock.patch("index.torch.cuda.memory_allocated", return_value=2_000_000_000),
            mock.patch("index.torch.cuda.memory_reserved", return_value=3_000_000_000),
            mock.patch(
                # free=1 GB, total=10 GB → 9 GB used card-wide
                "index.torch.cuda.mem_get_info",
                return_value=(1_000_000_000, 10_000_000_000),
            ),
            mock.patch("index.log") as mock_log,
        ):
            log_vram("Janus load")
        self.assertEqual(len(mock_log.call_args_list), 1)
        message = mock_log.call_args_list[0].args[0]
        self.assertIn("Janus load", message)
        self.assertIn("2.00 GB tensors", message)
        self.assertIn("9.00/10.00 GB used", message)

    # --- one-model-per-pass refactor: pure helpers, no CUDA ---

    def test_parse_caption_with_retry_succeeds_after_retry(self):
        valid = '{"identified_objects": ["cat"], "themes": ["pet"], "alt_text": "a cat", "subject": "cat"}'

        class StubClassifier:
            def __init__(self):
                self.calls = 0

            def predict(self, path, geocode):
                self.calls += 1
                return valid

        stub = StubClassifier()
        # First attempt parses the (malformed) batch caption and fails, then the
        # live model is re-invoked and the retry parses cleanly.
        result = parse_caption_with_retry(stub, "p.jpg", {}, "{bad}", max_attempts=5)
        self.assertEqual(result.get("alt_text"), "a cat")
        self.assertEqual(stub.calls, 1)

    def test_parse_caption_with_retry_gives_up_returns_retryable_none(self):
        class StubClassifier:
            def predict(self, path, geocode):
                return "{bad}"

        result = parse_caption_with_retry(
            StubClassifier(), "p.jpg", {}, "{bad}", max_attempts=3
        )
        self.assertIsNone(result)

    def test_non_eos_caption_is_retried_singly_before_acceptance(self):
        valid = '{"identified_objects":["cat"],"themes":[],"alt_text":"A cat.","subject":"cat"}'

        class StubClassifier:
            def __init__(self):
                self.calls = 0
                self.last_generation_metrics = []

            def predict(self, path, geocode):
                self.calls += 1
                self.last_generation_metrics = [
                    {
                        "tokenCount": 40,
                        "completedWithEos": True,
                        "hitTokenLimit": False,
                    }
                ]
                return valid

        classifier = StubClassifier()
        metrics = []
        with mock.patch("index.log"), mock.patch("index.heartbeat"):
            parsed = resolve_caption_result(
                classifier,
                "cat.jpg",
                {},
                "truncated",
                {"completedWithEos": False, "hitTokenLimit": True},
                metrics,
            )
        self.assertEqual(parsed["tags"][0], "cat")
        self.assertEqual(classifier.calls, 1)
        self.assertTrue(metrics[0]["singleRetry"])

    def test_complete_json_at_token_ceiling_is_accepted_without_retry(self):
        valid = '{"tags":["cat"],"alt_text":"A cat."}'
        classifier = mock.Mock()

        parsed = resolve_caption_result(
            classifier,
            "cat.jpg",
            {},
            valid,
            {"completedWithEos": False, "completedWithJson": True},
        )

        self.assertEqual(parsed["tags"][0], "cat")
        classifier.predict.assert_not_called()

    def test_complete_schema_prefix_at_token_ceiling_is_repaired_without_retry(self):
        repeated = (
            '{"alt_text":"A snowy mountain.",'
            '"tags":["mountain","winter"],'
            '"alt_text":"A snowy mountain."'
        )
        classifier = mock.Mock()

        parsed = resolve_caption_result(
            classifier,
            "mountain.jpg",
            {},
            repeated,
            {
                "completedWithEos": False,
                "completedWithJson": False,
                "completedWithSchema": True,
            },
        )

        self.assertEqual(parsed["tags"][0], "mountain")
        classifier.predict.assert_not_called()

    def test_non_eos_single_retry_remains_incomplete(self):
        class StubClassifier:
            def __init__(self):
                self.last_generation_metrics = []

            def predict(self, path, geocode):
                self.last_generation_metrics = [
                    {
                        "tokenCount": 192,
                        "completedWithEos": False,
                        "hitTokenLimit": True,
                    }
                ]
                return "still truncated"

        with mock.patch("index.log"), mock.patch("index.heartbeat"):
            parsed = resolve_caption_result(
                StubClassifier(),
                "cat.jpg",
                {},
                "truncated",
                {"completedWithEos": False},
            )
        self.assertIsNone(parsed)

    def test_analyse_image_builds_from_precomputed(self):
        path = "../src/test/fixtures/monkey.jpg"
        caption = {
            "identified_objects": ["monkey"],
            "themes": ["nature"],
            "alt_text": "a monkey",
            "subject": "monkey",
        }
        embeddings = {"google/siglip-base-patch16-224": [0.1, 0.2, 0.3]}
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                path=path,
                needs_classifier=True,
                precomputed_caption=caption,
                precomputed_embeddings=embeddings,
                precomputed_colors=[(1, 2, 3)],
            )
        self.assertIn("monkey", analysed["tags"])
        self.assertIn("nature", analysed["tags"])
        self.assertEqual(analysed["alt_text"], "a monkey")
        self.assertIsNone(analysed["subject"])
        self.assertEqual(analysed["colors"], [(1, 2, 3)])
        # Embeddings are emitted from the precomputed dict's keys, not a live model.
        self.assertEqual(len(analysed["embeddings"]), 1)
        self.assertEqual(
            analysed["embeddings"][0]["model_id"], "google/siglip-base-patch16-224"
        )
        self.assertEqual(analysed["embeddings"][0]["embedding"], [0.1, 0.2, 0.3])

    def test_analyse_image_without_classifier_skips_caption_fields(self):
        # Embeddings-only re-index path: no classifier fields written, but the
        # precomputed embedding still persists.
        path = "../src/test/fixtures/monkey.jpg"
        with open(path, "rb") as fh:
            analysed = analyse_image(
                fh,
                path=path,
                needs_classifier=False,
                precomputed_caption=None,
                precomputed_embeddings={"google/siglip2-base-patch16-224": [0.5]},
                precomputed_colors=[(0, 0, 0)],
            )
        self.assertEqual(analysed["tags"], [])
        self.assertIsNone(analysed["alt_text"])
        self.assertIsNone(analysed["subject"])
        self.assertEqual(len(analysed["embeddings"]), 1)

    def test_run_embedding_pass_fills_dict_and_releases(self):
        class StubEmbedder:
            model_id = "stub-model"

            def __init__(self):
                self.released = False

            def init_model(self):
                pass

            def predict_image_embeddings_batch(self, paths):
                return [[float(len(p))] for p in paths]

            def release(self):
                self.released = True

        stub = StubEmbedder()
        precomputed = {}
        with mock.patch("index.log_vram"), mock.patch("index.log"):
            load_ms = run_embedding_pass(stub, ["a.jpg", "bb.jpg"], precomputed)
        self.assertTrue(stub.released)
        self.assertEqual(precomputed["a.jpg"]["stub-model"], [5.0])
        self.assertEqual(precomputed["bb.jpg"]["stub-model"], [6.0])
        self.assertIsInstance(load_ms, float)

    def test_analyse_image_worker_reraises_keyboard_interrupt(self):
        # Ctrl-C must propagate (not be swallowed into a malformed tuple).
        with (
            mock.patch("index.analyse_image", side_effect=KeyboardInterrupt),
            self.assertRaises(KeyboardInterrupt),
        ):
            analyse_image_worker(
                (
                    0,
                    "../src/test/fixtures/monkey.jpg",
                    True,
                    False,
                    None,
                    None,
                    None,
                    "digest",
                    "caption-version",
                    None,
                )
            )


class UsesTestexistsFixture:
    """Runs against a throwaway copy of the committed ``testexists.sqlite``.

    The fixture is WAL-mode, so merely opening it read-only checkpoints on
    close and bumps the SQLite change counter in the file header — which
    otherwise shows up as a spurious 2-byte diff every test run. Copying it to
    a temp dir keeps the committed fixture pristine.
    """

    def setUp(self):
        super().setUp()
        self._fixture_dir = tempfile.TemporaryDirectory()
        self.testexists_db = os.path.join(self._fixture_dir.name, "testexists.sqlite")
        shutil.copy(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "testexists.sqlite"
            ),
            self.testexists_db,
        )

    def tearDown(self):
        self._fixture_dir.cleanup()
        super().tearDown()


class TestCli(UsesTestexistsFixture, unittest.TestCase):
    def test_index_dry_run_siglip2_test_simple(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            glob = "../albums/test-simple/*.[jJ][pP][gG]"
            dbpath = os.path.join(tmpdir, "test-simple.sqlite")
            # An empty media root: the album's video has no poster frame here,
            # so it is reported and left alone rather than indexed blind.
            media_root = os.path.join(tmpdir, "media")
            os.makedirs(media_root)
            result = runner.invoke(
                index,
                f"--glob {glob} --dbpath {dbpath} --dry-run --model-profile siglip2 "
                f"--media-root {media_root}".split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertTrue("Using model profile: siglip2" in result.output)
            self.assertTrue("Found 5 files" in result.output)
            self.assertIn("no extracted poster frame", result.output)
            self.assertFalse(os.path.exists(dbpath))

    def test_index_dry_run_plans_a_video_once_its_poster_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            glob = "../albums/test-simple/*.[jJ][pP][gG]"
            dbpath = os.path.join(tmpdir, "test-simple.sqlite")
            poster_dir = os.path.join(tmpdir, "media", "test-simple", ".resized_videos")
            os.makedirs(poster_dir)
            shutil.copyfile(
                "../albums/test-simple/DSCF0593.jpg",
                os.path.join(poster_dir, "DSCF0159.MOV@poster.jpg"),
            )

            result = runner.invoke(
                index,
                f"--glob {glob} --dbpath {dbpath} --dry-run --model-profile siglip2 "
                f"--media-root {os.path.join(tmpdir, 'media')}".split(),
            )

            self.assertEqual(0, result.exit_code)
            self.assertTrue("Found 6 files" in result.output)
            self.assertNotIn("no extracted poster frame", result.output)

    def test_update_gps_refreshes_coords_from_exif_without_models(self):
        # A row seeded with deliberately wrong coords/date/geocode should be
        # corrected to the photo's real EXIF, purely from CPU work.
        photo = "../albums/test-simple/DSCF0506-2.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "update-gps.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            with db.transaction() as cur:
                db.upsert_image_fields(
                    photo,
                    {"filename": "DSCF0506-2.jpg", "geocode": "WRONGPLACE"},
                    cur=cur,
                )
                db.insert_metadata(
                    photo, (0.0, 0.0), "1999-01-01T00:00:00", {}, cur=cur
                )
            db.con.close()

            result = CliRunner().invoke(update_gps, f"--dbpath {dbpath}".split())
            self.assertEqual(0, result.exit_code, result.output)

            con = sqlite3.connect(dbpath)
            lat, lng, iso, country = con.execute(
                "SELECT lat_deg, lng_deg, iso8601, geo_country FROM metadata WHERE path=?",
                (photo,),
            ).fetchone()
            geocode = con.execute(
                "SELECT geocode FROM images WHERE path=?", (photo,)
            ).fetchone()[0]
            signature = con.execute(
                "SELECT mtime, size FROM file_signatures WHERE path=?", (photo,)
            ).fetchone()
            con.close()

            self.assertAlmostEqual(lat, 36.578858, places=3)
            self.assertAlmostEqual(lng, 137.595973, places=3)
            self.assertEqual(iso, "2019-11-06T10:48:19")
            self.assertEqual(country, "Japan")
            self.assertNotIn(geocode, (None, "WRONGPLACE"))
            self.assertIsNotNone(signature)

    def test_update_gps_dry_run_makes_no_changes(self):
        photo = "../albums/test-simple/DSCF0506-2.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "dry.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            with db.transaction() as cur:
                db.upsert_image_fields(photo, {"geocode": "WRONGPLACE"}, cur=cur)
                db.insert_metadata(
                    photo, (0.0, 0.0), "1999-01-01T00:00:00", {}, cur=cur
                )
            db.con.close()

            result = CliRunner().invoke(
                update_gps, f"--dbpath {dbpath} --dry-run".split()
            )
            self.assertEqual(0, result.exit_code, result.output)

            con = sqlite3.connect(dbpath)
            lat = con.execute(
                "SELECT lat_deg FROM metadata WHERE path=?", (photo,)
            ).fetchone()[0]
            geocode = con.execute(
                "SELECT geocode FROM images WHERE path=?", (photo,)
            ).fetchone()[0]
            con.close()
            self.assertEqual(lat, 0.0)
            self.assertEqual(geocode, "WRONGPLACE")

    def test_update_gps_clears_removed_coordinates_and_geocode_tags(self):
        photo = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "clear-gps.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            with db.transaction() as cur:
                db.upsert_image_fields(photo, {"geocode": "Japan"}, cur=cur)
                db.insert_metadata(
                    photo,
                    (35.0, 139.0),
                    "2020-01-01T00:00:00",
                    {"geo_country": "Japan"},
                    cur=cur,
                )
                db.replace_tags_for_source(photo, ["Japan", "JP"], "geocode", cur)
                db.rebuild_tag_counts(cur)
            db.con.close()

            with mock.patch(
                "index.get_exif",
                return_value={"EXIF DateTimeOriginal": "2020:01:02 03:04:05"},
            ):
                result = CliRunner().invoke(update_gps, ["--dbpath", dbpath])
            self.assertEqual(result.exit_code, 0, result.output)

            con = sqlite3.connect(dbpath)
            metadata = con.execute(
                "SELECT lat_deg, lng_deg, geo_country FROM metadata WHERE path = ?",
                (photo,),
            ).fetchone()
            geocode = con.execute(
                "SELECT geocode FROM images WHERE path = ?", (photo,)
            ).fetchone()[0]
            geo_tags = con.execute(
                "SELECT tag FROM image_tags WHERE path = ? AND source = 'geocode'",
                (photo,),
            ).fetchall()
            con.close()
            self.assertEqual(metadata, (None, None, None))
            self.assertIsNone(geocode)
            self.assertEqual(geo_tags, [])

    def test_index_dry_run_accepts_gemma_classifier_flags(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            glob = "../albums/test-simple/*.[jJ][pP][gG]"
            dbpath = os.path.join(tmpdir, "test-simple.sqlite")
            result = runner.invoke(
                index,
                (
                    f"--glob {glob} --dbpath {dbpath} --dry-run "
                    "--model-profile janus "
                    "--classifier-backend gemma4 "
                    "--classifier-model-id google/gemma-4-E2B-it "
                    "--classifier-gpu-headroom-gb 3 "
                    "--classifier-low-impact "
                    "--classifier-batch-size 1"
                ).split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertTrue("Classifier backend: gemma4" in result.output)

    def test_index_dry_run_accepts_gemma_gguf_classifier_flags(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CliRunner()
            glob = "../albums/test-simple/*.[jJ][pP][gG]"
            dbpath = os.path.join(tmpdir, "test-simple.sqlite")
            result = runner.invoke(
                index,
                (
                    f"--glob {glob} --dbpath {dbpath} --dry-run "
                    "--model-profile janus "
                    "--classifier-backend gemma4-gguf "
                    "--classifier-model-id unsloth/gemma-4-E4B-it-GGUF:Q8_0 "
                    "--classifier-batch-size 1"
                ).split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertTrue("Classifier backend: gemma4-gguf" in result.output)

    def test_index_refuses_experimental_janus_batch_without_override(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "unsafe.sqlite")
            result = CliRunner().invoke(
                index,
                [
                    "--glob",
                    "../albums/test-simple/*.jpg",
                    "--dbpath",
                    dbpath,
                    "--dry-run",
                    # This guard is a Janus production limit, so name the backend
                    # rather than inherit whatever the default happens to be.
                    "--classifier-backend",
                    "janus",
                    "--classifier-batch-size",
                    "5",
                ],
            )
            self.assertNotEqual(result.exit_code, 0)
            self.assertIn("production limit 4", result.output)
            self.assertFalse(os.path.exists(dbpath))

    def test_janus_batch_benchmark_refuses_experimental_default(self):
        result = CliRunner().invoke(
            cli,
            ["benchmark-janus-batch", "--batch-sizes", "5"],
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("production limit 4", result.output)

    def test_legacy_captions_without_provenance_are_recaptioned(self):
        # A caption row with no pipeline_state may have come from the retired
        # four-field v1 prompt. Importing it under the current version would claim
        # provenance that cannot be shown, and validate could never catch it
        # because the claimed version is by construction the expected one.
        runner = CliRunner()
        glob = "../src/test/fixtures/*.jpg"
        dbpath = self.testexists_db
        result = runner.invoke(
            index, f"--glob {glob} --dbpath {dbpath} --dry-run".split()
        )
        self.assertEqual(0, result.exit_code)
        self.assertTrue("Found 2 files" in result.output)
        self.assertTrue("(2 to index, 0 already indexed)" in result.output)

    def test_index_skips_paths_whose_provenance_is_current(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "skip.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": path,
                        "analysed": {
                            "exif": {},
                            "geocode": {},
                            "lat_deg": None,
                            "lng_deg": None,
                            "iso8601": None,
                            "colors": [],
                            "tags": ["monkey"],
                            "alt_text": "A monkey",
                            "subject": None,
                            "embeddings": [],
                        },
                        "write_core": True,
                        "write_caption": True,
                        "source_sha256": file_content_sha256(path),
                        "caption_version": caption_pipeline_version("janus"),
                        "caption_model_id": JANUS_MODEL_ID,
                    }
                ],
            )
            db.con.close()

            # The row above is stamped with Janus provenance, so index must be told
            # to use Janus too — provenance is per backend, and the default is no
            # longer Janus. Inheriting the default here would silently test
            # "backend changed, so reindex", which is a different behaviour.
            result = CliRunner().invoke(
                index,
                (
                    f"--glob {path} --dbpath {dbpath} --model-profile janus "
                    "--classifier-backend janus --dry-run"
                ).split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertIn("(0 to index, 1 already indexed)", result.output)

    class _StubGgufClassifier:
        """Model-free stand-in for the GGUF caption backend used by full `index`
        runs. Subclasses decide what predict_batch/predict return."""

        backend = "gemma4-gguf"
        model_id = DEFAULT_GEMMA4_GGUF_MODEL_ID
        quantization = None
        batch_size = 4

        def __init__(self):
            self.last_generation_metrics = []
            self.released = False

        def init_model(self):
            return None

        def release(self):
            self.released = True

    @staticmethod
    def _lock_stub(*_args, **_kwargs):
        return os.open(os.devnull, os.O_RDONLY)

    def test_index_falls_back_to_metadata_caption_when_model_rejects(self):
        """A caption the model cannot produce must not block the whole index:
        the assembly pass writes a metadata-only fallback so every photo has a
        caption row and validate passes (the fallback's raison d'etre, previously
        dead because the assembly tuple hardcoded needs_classifier=False)."""
        # find_files globs relative to cwd, so the album must live under it.
        with tempfile.TemporaryDirectory(dir=".") as tmpdir:
            album = os.path.join(tmpdir, "nagano")
            os.makedirs(album)
            good = os.path.join(album, "good.jpg")
            rejected = os.path.join(album, "rejected.jpg")
            shutil.copyfile("../src/test/fixtures/monkey.jpg", good)
            shutil.copyfile("../src/test/fixtures/monkey.jpg", rejected)
            dbpath = os.path.join(tmpdir, "index.sqlite")
            glob = os.path.relpath(os.path.join(album, "*.jpg"))

            class RejectingClassifier(self._StubGgufClassifier):
                def predict_batch(inner, items):
                    results = []
                    metrics = []
                    for path, _geo in items:
                        if os.path.basename(path) == "rejected.jpg":
                            results.append("{ not valid json")
                        else:
                            results.append(
                                json.dumps(
                                    {
                                        "tags": ["monkey", "branch"],
                                        "alt_text": "A monkey on a branch.",
                                    }
                                )
                            )
                        metrics.append({"completedWithEos": True})
                    inner.last_generation_metrics = metrics
                    return results

                def predict(inner, path, geocode):
                    # Single-image retry also fails, so the caption is rejected.
                    inner.last_generation_metrics = [{"completedWithEos": True}]
                    return "{ not valid json"

            stub = RejectingClassifier()
            with (
                mock.patch("index.create_classifier", return_value=stub),
                mock.patch(
                    "index.acquire_single_instance_lock", side_effect=self._lock_stub
                ),
            ):
                result = CliRunner().invoke(
                    index,
                    [
                        "--glob",
                        glob,
                        "--dbpath",
                        dbpath,
                        "--model-profile",
                        "janus",
                        "--classifier-backend",
                        "gemma4-gguf",
                    ],
                )
            self.assertEqual(0, result.exit_code, result.output)

            con = sqlite3.connect(dbpath)
            captions = {
                os.path.basename(p): alt
                for p, alt in con.execute("SELECT path, alt_text FROM images")
            }
            tags = {
                os.path.basename(p): tag
                for p, tag in con.execute("SELECT path, tags FROM images")
            }
            con.close()

            self.assertEqual(captions["good.jpg"], "A monkey on a branch.")
            # The rejected photo still has a caption row, built from its album.
            self.assertIn("nagano", captions["rejected.jpg"].lower())
            self.assertIn("nagano", (tags["rejected.jpg"] or "").lower())

            # Validation — the gate that previously blocked publication forever —
            # now passes because every photo has a caption with fresh provenance.
            summary = validate_index_database(
                dbpath, glob, "janus", classifier_backend="gemma4-gguf"
            )
            self.assertEqual(summary["paths"], 2)

    def test_caption_pass_releases_classifier_when_db_write_fails(self):
        """A failure in the per-batch caption DB write must still release the
        classifier through the try/finally, or a backend like llama-server
        orphans a subprocess holding several GB of VRAM after the parent exits."""
        # find_files globs relative to cwd, so the album must live under it.
        with tempfile.TemporaryDirectory(dir=".") as tmpdir:
            album = os.path.join(tmpdir, "nagano")
            os.makedirs(album)
            good = os.path.join(album, "good.jpg")
            shutil.copyfile("../src/test/fixtures/monkey.jpg", good)
            dbpath = os.path.join(tmpdir, "index.sqlite")
            glob = os.path.relpath(os.path.join(album, "*.jpg"))

            class WorkingClassifier(self._StubGgufClassifier):
                def predict_batch(inner, items):
                    inner.last_generation_metrics = [
                        {"completedWithEos": True} for _ in items
                    ]
                    return [
                        json.dumps({"tags": ["monkey"], "alt_text": "A monkey."})
                        for _ in items
                    ]

                def predict(inner, path, geocode):
                    inner.last_generation_metrics = [{"completedWithEos": True}]
                    return json.dumps({"tags": ["monkey"], "alt_text": "A monkey."})

            stub = WorkingClassifier()
            with (
                mock.patch("index.create_classifier", return_value=stub),
                mock.patch(
                    "index.acquire_single_instance_lock", side_effect=self._lock_stub
                ),
                mock.patch.object(
                    Sqlite3Client,
                    "insert_caption_generation_metrics",
                    side_effect=RuntimeError("boom"),
                ),
            ):
                result = CliRunner().invoke(
                    index,
                    [
                        "--glob",
                        glob,
                        "--dbpath",
                        dbpath,
                        "--model-profile",
                        "janus",
                        "--classifier-backend",
                        "gemma4-gguf",
                    ],
                )

            self.assertNotEqual(0, result.exit_code)
            self.assertTrue(stub.released)

    def test_search(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(search, f"--query plant --dbpath {dbpath}".split())

        self.assertEqual(0, result.exit_code)
        self.assertTrue("monkey-for-unoptimised.jpg" in result.output)
        self.assertTrue("monkey.jpg" in result.output)

    def test_search_negative(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(
            search, f"--query randomstring --dbpath {dbpath}".split()
        )

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[]" in result.output)

    def test_search_min_results_pass(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(
            search, f"--query plant --dbpath {dbpath} --min-results 1".split()
        )

        self.assertEqual(0, result.exit_code)

    def test_search_min_results_fail(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(
            search, f"--query randomstring --dbpath {dbpath} --min-results 1".split()
        )

        self.assertNotEqual(0, result.exit_code)

    def test_prune_refuses_empty_glob_without_force(self):
        # H4: a glob that matches nothing must NOT wipe the whole DB.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "prune.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            db.upsert_image_fields("../albums/gone/1.jpg", {"filename": "1.jpg"})
            db.con.close()  # release WAL lock so prune runs against a single connection

            runner = CliRunner()
            result = runner.invoke(
                prune,
                f"--glob ../albums/does-not-exist/*.jpg --dbpath {dbpath}".split(),
            )
            self.assertNotEqual(0, result.exit_code)
            self.assertIn("refusing", result.output.lower())
            self.assertIn("../albums/gone/1.jpg", Sqlite3Client(dbpath).list_paths())

    def test_prune_force_allows_empty_glob(self):
        # H4: --force is the explicit escape hatch when albums really are all gone.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "prune.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            db.upsert_image_fields("../albums/gone/1.jpg", {"filename": "1.jpg"})
            db.con.close()  # release WAL lock so prune runs against a single connection

            runner = CliRunner()
            result = runner.invoke(
                prune,
                f"--glob ../albums/does-not-exist/*.jpg --dbpath {dbpath} --force".split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertNotIn("../albums/gone/1.jpg", Sqlite3Client(dbpath).list_paths())

    def test_prune_refuses_large_nonempty_partial_glob_without_force(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "prune.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            real = "../src/test/fixtures/monkey.jpg"
            db.upsert_image_fields(real, {"filename": "monkey.jpg"})
            for index in range(9):
                db.upsert_image_fields(
                    f"../albums/gone/{index}.jpg", {"filename": f"{index}.jpg"}
                )
            db.con.close()

            result = CliRunner().invoke(
                prune,
                f"--glob {real} --dbpath {dbpath}".split(),
            )
            self.assertNotEqual(result.exit_code, 0)
            self.assertIn("large partial prune", result.output)
            self.assertEqual(len(Sqlite3Client(dbpath).list_paths()), 10)

    def test_metadata_fallback_describes_only_what_is_known(self):
        # A few photos send the model into a loop, and rejecting that is right —
        # but validate demands a caption for every photo, so correct rejections
        # blocked publication of the whole index permanently. The fallback keeps
        # them findable by album, place and year, and claims nothing about the
        # picture itself.
        caption = build_metadata_fallback_caption(
            "../albums/nagano/DSCF4327.JPG",
            {"city": "Nagano", "country": "Japan"},
            "2023-11-08T13:11:57",
        )

        # Tags run through normalise_classifier_tags like every other caption:
        # lower-cased and case-insensitively deduplicated, so album "nagano" and
        # city "Nagano" collapse to one entry rather than a mixed-case duplicate.
        self.assertEqual(caption["tags"], ["nagano", "japan", "2023"])
        self.assertEqual(caption["alt_text"], "Photo from nagano in Nagano, 2023.")

    def test_metadata_fallback_copes_without_place_or_date(self):
        caption = build_metadata_fallback_caption(
            "../albums/snapshots/x.jpg", None, None
        )

        self.assertEqual(caption["tags"], ["snapshots"])
        self.assertEqual(caption["alt_text"], "Photo from snapshots.")
        # Must still satisfy the contract every other caption is held to.
        self.assertEqual(
            parse_classifier_response(json.dumps(caption))["tags"], ["snapshots"]
        )

    def test_over_long_alt_text_is_trimmed_not_discarded(self):
        # Same mistake as the tag cap: rejecting a sound caption for running
        # long left photos permanently uncaptioned, and validate then refused to
        # publish over them. Trimming stops on a sentence so it still reads.
        response = json.dumps(
            {
                "tags": ["snow", "ice"],
                "alt_text": (
                    "A person in white walks in front of a large illuminated structure "
                    "with a snowy landscape and a nighttime exhibition of ice sculptures. "
                    "Behind them a crowd gathers near the entrance while snow keeps "
                    "falling steadily across the whole of the plaza beyond."
                ),
            }
        )

        parsed = parse_classifier_response(response)

        self.assertLessEqual(len(parsed["alt_text"]), 200)
        self.assertTrue(parsed["alt_text"].endswith("."))
        self.assertTrue(parsed["alt_text"].startswith("A person in white walks"))

    def test_alt_text_within_bounds_is_left_alone(self):
        parsed = parse_classifier_response(
            json.dumps({"tags": ["snow"], "alt_text": "A short caption."})
        )

        self.assertEqual(parsed["alt_text"], "A short caption.")

    def test_json_cut_off_by_the_token_limit_is_closed_and_kept(self):
        # Generation stops at a hard token cap, so a schema-complete caption can
        # arrive without its closing brace. The block pattern needs that brace,
        # so these fell through to the plain-text branch and were rejected —
        # photos left uncaptioned over one missing character, which blocked
        # publication because validate demands full coverage.
        truncated = (
            ' {\n  "tags": ["snow", "ice", "architecture"],\n'
            '  "alt_text": "A person walks past an illuminated structure."'
        )

        parsed = parse_classifier_response(truncated)

        self.assertEqual(parsed["tags"], ["snow", "ice", "architecture"])
        self.assertEqual(
            parsed["alt_text"], "A person walks past an illuminated structure."
        )

    def test_json_cut_mid_token_is_not_fabricated_into_a_caption(self):
        # Closing the brace must only rescue responses that genuinely parse;
        # anything truncated mid-value still has no usable caption.
        with self.assertRaises((ValueError, KeyError)):
            parse_classifier_response('{ "tags": ["snow", "ic')

    def test_over_long_tag_lists_are_truncated_not_discarded(self):
        # Rejecting on count left 16 of 1480 photos permanently uncaptioned, and
        # because validate demands full coverage that blocked publication
        # entirely. These are good captions that merely ran long.
        response = json.dumps(
            {
                "tags": [
                    "side mirror",
                    "traffic",
                    "city",
                    "street",
                    "cars",
                    "mirror",
                    "view",
                    "traffic light",
                    "streetlights",
                    "shop",
                    "shopfront",
                    "clothes",
                ],
                "alt_text": "The side mirror reflects a busy city street.",
            }
        )

        parsed = parse_classifier_response(response)

        self.assertEqual(len(parsed["tags"]), 10)
        self.assertEqual(parsed["tags"][0], "side mirror")
        self.assertEqual(
            parsed["alt_text"], "The side mirror reflects a busy city street."
        )

    def test_tags_that_each_extend_the_previous_are_rejected(self):
        # The measured Janus loop. Truncating would keep its degenerate head, so
        # it has to be caught before the list is cut — dedup cannot see it
        # because every string differs.
        response = json.dumps(
            {
                "tags": [
                    "bicycle",
                    "clothing",
                    "drying",
                    "folding",
                    "folding table",
                    "folding tablecloth",
                    "folding tablecloths",
                    "folding tablecloths hanging",
                    "folding tablecloths hanging on",
                ],
                "alt_text": "Clothes drying on a rack.",
            }
        )

        with self.assertRaises(ValueError):
            parse_classifier_response(response)

    def test_ordinary_tag_families_are_not_mistaken_for_a_runaway(self):
        # Real captions routinely contain a couple of extending pairs; only a
        # loop produces many.
        response = json.dumps(
            {
                "tags": ["traffic", "traffic light", "shop", "shopfront", "city"],
                "alt_text": "A busy city street.",
            }
        )

        parsed = parse_classifier_response(response)

        self.assertEqual(
            parsed["tags"], ["traffic", "traffic light", "shop", "shopfront", "city"]
        )

    def test_tokenizer_vocab_is_resolved_once(self):
        # The processor looks up three constant token ids through
        # tokenizer.vocab, and transformers rebuilds the whole ~100k-entry dict
        # on every access — measured at ~200ms a call, six per image, which was
        # most of the time spent preparing each caption.
        calls = []

        class FakeTokenizer:
            def get_vocab(self):
                calls.append(1)
                return {"<image_placeholder>": 100}

        tokenizer = FakeTokenizer()
        cache_tokenizer_vocab(tokenizer)

        for _ in range(6):
            self.assertEqual(tokenizer.get_vocab()["<image_placeholder>"], 100)

        self.assertEqual(len(calls), 1)

    def _fake_cuda(self, free_gb, reserved_gb, allocated_gb):
        cuda = mock.MagicMock()
        cuda.is_available.return_value = True
        cuda.mem_get_info.return_value = (int(free_gb * 1e9), int(10.7 * 1e9))
        cuda.memory_reserved.return_value = int(reserved_gb * 1e9)
        cuda.memory_allocated.return_value = int(allocated_gb * 1e9)
        return cuda

    def test_vram_headroom_counts_the_allocators_reusable_cache(self):
        # The caching allocator reserves memory and reuses it across batches
        # without returning it, so a healthy run sits at ~0 device-free while
        # allocating nothing new. Judging on device-free alone stopped runs that
        # were fine, which is what kept a 294-batch job from ever finishing.
        cuda = self._fake_cuda(free_gb=0.03, reserved_gb=7.10, allocated_gb=4.84)
        with mock.patch("index.torch.cuda", cuda):
            self.assertAlmostEqual(effective_free_vram_gb(), 2.29, places=1)

    def test_vram_guard_continues_when_only_device_free_is_exhausted(self):
        cuda = self._fake_cuda(free_gb=0.03, reserved_gb=7.10, allocated_gb=4.84)
        with mock.patch("index.torch.cuda", cuda), mock.patch("index.log"):
            headroom = enforce_vram_headroom("janus batch 10/281")

        # 0.03 device-free plus 2.26 reusable: the next batch has room.
        self.assertAlmostEqual(headroom, 2.29, places=1)

    def test_vram_guard_stops_when_the_card_is_genuinely_oversubscribed(self):
        # Another process holding the card is the case the guard is for: torch
        # cannot reserve, and WSL2 spills to host RAM rather than raising, so the
        # run would crawl instead of failing.
        cuda = self._fake_cuda(free_gb=0.05, reserved_gb=4.40, allocated_gb=4.35)
        with (
            mock.patch("index.torch.cuda", cuda),
            mock.patch("index.log"),
            self.assertRaises(click.ClickException),
        ):
            enforce_vram_headroom("janus batch 1/281")

    def test_prepare_staging_copies_from_the_working_db_when_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "search.sqlite")
            staging = os.path.join(tmpdir, "search.staging.sqlite")
            db = Sqlite3Client(source)
            db.setup_tables()
            db.upsert_image_fields("a.jpg", {"filename": "a.jpg"})
            db.con.close()

            outcome = prepare_staging_database(source, staging)

            self.assertEqual(outcome, "copied")
            self.assertEqual(Sqlite3Client(staging).list_paths(), {"a.jpg"})
            self.assertFalse(os.path.exists(staging + ".partial"))

    def test_prepare_staging_resumes_a_sound_existing_staging_db(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "search.sqlite")
            staging = os.path.join(tmpdir, "search.staging.sqlite")
            for path, filename in ((source, "old.jpg"), (staging, "resumed.jpg")):
                db = Sqlite3Client(path)
                db.setup_tables()
                db.upsert_image_fields(filename, {"filename": filename})
                db.con.close()

            outcome = prepare_staging_database(source, staging)

            # Resuming must not re-copy over completed staged work.
            self.assertEqual(outcome, "resumed")
            self.assertEqual(Sqlite3Client(staging).list_paths(), {"resumed.jpg"})

    def test_prepare_staging_leaves_nothing_resumable_when_the_copy_fails(self):
        # A copy interrupted by Ctrl-C or ENOSPC must not leave a truncated file at
        # the staging path: the next run matches on existence alone and would
        # resume it, committing GPU hours to a database that can never publish.
        # Copying aside and renaming in is what keeps a partial write invisible.
        def interrupted_copy(src, dst):
            with open(src, "rb") as source_fh, open(dst, "wb") as dest_fh:
                dest_fh.write(source_fh.read(512))
            raise OSError("interrupted")

        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "search.sqlite")
            staging = os.path.join(tmpdir, "search.staging.sqlite")
            db = Sqlite3Client(source)
            db.setup_tables()
            db.con.close()

            with (
                mock.patch("index.shutil.copyfile", side_effect=interrupted_copy),
                self.assertRaises(OSError),
            ):
                prepare_staging_database(source, staging)

            self.assertFalse(os.path.exists(staging))
            self.assertFalse(os.path.exists(staging + ".partial"))

    def test_prepare_staging_refuses_to_resume_a_corrupt_staging_db(self):
        # cp is not atomic: an interrupted copy leaves a truncated staging DB.
        # Resuming it commits GPU hours to a database that cannot be published.
        with tempfile.TemporaryDirectory() as tmpdir:
            source = os.path.join(tmpdir, "search.sqlite")
            staging = os.path.join(tmpdir, "search.staging.sqlite")
            db = Sqlite3Client(source)
            db.setup_tables()
            db.con.close()
            with open(source, "rb") as fh:
                truncated = fh.read(2048)
            with open(staging, "wb") as fh:
                fh.write(truncated[:1024])

            with self.assertRaises(click.ClickException):
                prepare_staging_database(source, staging)

    def test_prune_refuses_when_an_entire_album_has_vanished(self):
        # An album that fails to mount takes every one of its photos at once while
        # staying well under the whole-DB percentage guard, so the count-based
        # guards cannot see it: validate then derives `expected` from the same
        # shrunken glob and passes, publish replaces the live DBs, and the working
        # DB is overwritten — losing that album's captions and embeddings from
        # every copy. A whole album matching zero files is an unmounted directory,
        # not curation; individual deletions leave their album still present.
        # Path.glob rejects absolute patterns, and the suite runs from index/.
        with tempfile.TemporaryDirectory(dir=".") as absolute_tmpdir:
            tmpdir = os.path.relpath(absolute_tmpdir, ".")
            albums = os.path.join(tmpdir, "albums")
            for album, count in (("kept", 20), ("gone", 1)):
                os.makedirs(os.path.join(albums, album))
                for i in range(count):
                    shutil.copy(
                        "../src/test/fixtures/monkey.jpg",
                        os.path.join(albums, album, f"{i}.jpg"),
                    )

            dbpath = os.path.join(tmpdir, "prune.sqlite")
            glob_pattern = os.path.join(albums, "**", "*.jpg")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            indexed = find_files(".", glob_pattern)
            self.assertEqual(len(indexed), 21)
            for path in indexed:
                db.upsert_image_fields(path, {"filename": os.path.basename(path)})
            db.con.close()

            shutil.rmtree(os.path.join(albums, "gone"))  # album fails to mount

            result = CliRunner().invoke(
                prune, ["--glob", glob_pattern, "--dbpath", dbpath]
            )
            self.assertNotEqual(result.exit_code, 0)
            self.assertEqual(len(Sqlite3Client(dbpath).list_paths()), 21)

    def test_prune_allows_individual_photos_to_be_removed_from_a_live_album(self):
        # The vanished-album guard must not block ordinary curation: the album is
        # still present, so deleting some of its photos is a real intent.
        with tempfile.TemporaryDirectory(dir=".") as absolute_tmpdir:
            tmpdir = os.path.relpath(absolute_tmpdir, ".")
            albums = os.path.join(tmpdir, "albums", "kept")
            os.makedirs(albums)
            for i in range(20):
                shutil.copy(
                    "../src/test/fixtures/monkey.jpg", os.path.join(albums, f"{i}.jpg")
                )

            dbpath = os.path.join(tmpdir, "prune.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            glob_pattern = os.path.join(tmpdir, "albums", "**", "*.jpg")
            for path in find_files(".", glob_pattern):
                db.upsert_image_fields(path, {"filename": os.path.basename(path)})
            db.con.close()

            os.remove(os.path.join(albums, "0.jpg"))

            result = CliRunner().invoke(
                prune, ["--glob", glob_pattern, "--dbpath", dbpath]
            )
            self.assertEqual(0, result.exit_code)
            self.assertEqual(len(Sqlite3Client(dbpath).list_paths()), 19)

    def test_prune_removes_only_missing_paths(self):
        # H4: normal operation still prunes rows whose files no longer exist and
        # leaves the DB in delete (non-WAL) journal mode for publishing.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "prune.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            real = "../src/test/fixtures/monkey.jpg"
            bogus = "../src/test/fixtures/deleted.jpg"
            db.upsert_image_fields(real, {"filename": "monkey.jpg"})
            db.upsert_image_fields(bogus, {"filename": "deleted.jpg"})
            db.con.close()  # release WAL lock so prune can switch back to delete mode

            runner = CliRunner()
            result = runner.invoke(
                prune,
                f"--glob ../src/test/fixtures/*.jpg --dbpath {dbpath} --force".split(),
            )
            self.assertEqual(0, result.exit_code)

            # Read via a RAW connection FIRST — opening via Sqlite3Client would flip
            # the DB back to WAL in __init__ and mask the mode prune left behind.
            raw = sqlite3.connect(dbpath)
            journal_mode = raw.execute("PRAGMA journal_mode").fetchone()[0]
            image_paths = {r[0] for r in raw.execute("SELECT path FROM images")}
            raw.close()
            self.assertEqual(journal_mode.lower(), "delete")
            self.assertIn(real, image_paths)
            self.assertNotIn(bogus, image_paths)

    def test_search_tags(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(search_tags, f"--query plant --dbpath {dbpath}".split())

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[('plant', 3)]" in result.output)

    def test_search_tags_negative(self):
        runner = CliRunner()
        dbpath = self.testexists_db

        result = runner.invoke(
            search_tags, f"--query randomstring --dbpath {dbpath}".split()
        )

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[]" in result.output)


class TestDb(UsesTestexistsFixture, unittest.TestCase):
    def test_already_exists(self):
        db = Sqlite3Client(self.testexists_db)
        self.assertEqual(db.already_exists("../src/test/fixtures/monkey.jpg"), True)
        self.assertEqual(
            db.already_exists("../src/test/fixtures/monkey.missing"), False
        )

    def test_embeddings_insert_and_similarity(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "test-simple-vector.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()

            base_path = "../albums/test-simple/DSCF0506-2.jpg"
            near_path = "../albums/test-simple/DSCF0593.jpg"
            far_path = "../albums/test-simple/DSCF2581-2_2.jpg"

            db.insert_embedding(base_path, "unit-test-model", [1.0, 0.0, 0.0])
            db.insert_embedding(near_path, "unit-test-model", [0.9, 0.1, 0.0])
            db.insert_embedding(far_path, "unit-test-model", [0.0, 1.0, 0.0])

            embedding = db.get_embedding(base_path, model_id="unit-test-model")
            self.assertIsNotNone(embedding)
            self.assertEqual(embedding[1], "unit-test-model")
            self.assertEqual(embedding[2], 3)

            runner = CliRunner()
            result = runner.invoke(
                search_similar_path,
                f"--dbpath {dbpath} --path {base_path} --limit 2".split(),
            )

            self.assertEqual(0, result.exit_code)
            self.assertTrue(near_path in result.output)
            self.assertTrue(far_path in result.output)
            self.assertLess(result.output.find(near_path), result.output.find(far_path))

    def test_embedding_blob_round_trip_within_quantisation_tolerance(self):
        # Embeddings are stored as int8 blobs with a per-vector scale; decoding
        # must reproduce every component within half a quantisation step.
        vector = [0.4927, -0.2676, 0.0, 0.001, -0.499]
        blob, scale = encode_embedding(vector)
        self.assertEqual(len(blob), len(vector))
        decoded = decode_embedding(blob, scale)
        tolerance = scale / 2
        for original, roundtripped in zip(vector, decoded):
            self.assertAlmostEqual(original, roundtripped, delta=tolerance)

    def test_encode_embedding_all_zero_vector(self):
        blob, scale = encode_embedding([0.0, 0.0, 0.0])
        self.assertEqual(decode_embedding(blob, scale), [0.0, 0.0, 0.0])

    def test_insert_embedding_stores_blob_and_get_embedding_decodes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "blob.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()

            vector = [0.25, -0.125, 0.5]
            db.insert_embedding("a.jpg", "unit-test-model", vector)

            columns = {
                row[1]
                for row in db.con.execute("PRAGMA table_info(embeddings)").fetchall()
            }
            self.assertIn("embedding_blob", columns)
            self.assertIn("embedding_scale", columns)
            self.assertNotIn("embedding_json", columns)

            row = db.get_embedding("a.jpg", model_id="unit-test-model")
            self.assertEqual(row[2], 3)
            for original, stored in zip(vector, row[3]):
                self.assertAlmostEqual(original, stored, delta=0.5 / 127)

    def test_embedding_json_table_migrates_to_blob_schema(self):
        # A DB written by the previous format (embedding_json TEXT, 1024-byte
        # pages) must be rebuilt in place: blobs + scale columns, values
        # preserved within quantisation tolerance, and 4096-byte pages after
        # the migration VACUUM.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "legacy.sqlite")
            legacy = sqlite3.connect(dbpath)
            legacy.execute("PRAGMA page_size=1024")
            legacy.execute(
                "CREATE TABLE embeddings (path VARCHAR NOT NULL, model_id TEXT NOT NULL, embedding_dim INTEGER, embedding_json TEXT, PRIMARY KEY(path, model_id))"
            )
            vector = [0.1, -0.2, 0.3]
            legacy.execute(
                "INSERT INTO embeddings VALUES (?, ?, ?, ?)",
                ("a.jpg", "unit-test-model", len(vector), json.dumps(vector)),
            )
            legacy.commit()
            legacy.close()

            db = Sqlite3Client(dbpath)
            db.setup_tables()

            columns = {
                row[1]
                for row in db.con.execute("PRAGMA table_info(embeddings)").fetchall()
            }
            self.assertIn("embedding_blob", columns)
            self.assertNotIn("embedding_json", columns)

            row = db.get_embedding("a.jpg", model_id="unit-test-model")
            self.assertIsNotNone(row)
            for original, stored in zip(vector, row[3]):
                self.assertAlmostEqual(original, stored, delta=0.3 / 127)

            page_size = db.con.execute("PRAGMA page_size").fetchone()[0]
            self.assertEqual(page_size, 4096)

    def test_legacy_pk_path_table_migrates_to_blob_schema(self):
        # The oldest schema (PRIMARY KEY(path) only) must also land on the blob
        # schema in one migration pass.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "oldest.sqlite")
            legacy = sqlite3.connect(dbpath)
            legacy.execute(
                "CREATE TABLE embeddings (path VARCHAR PRIMARY KEY, model_id TEXT, embedding_dim INTEGER, embedding_json TEXT)"
            )
            legacy.execute(
                "INSERT INTO embeddings VALUES (?, ?, ?, ?)",
                ("a.jpg", None, 2, json.dumps([1.0, -1.0])),
            )
            legacy.commit()
            legacy.close()

            db = Sqlite3Client(dbpath)
            db.setup_tables()

            row = db.get_embedding("a.jpg")
            self.assertIsNotNone(row)
            self.assertEqual(row[1], "")
            self.assertAlmostEqual(row[3][0], 1.0, delta=1.0 / 127)
            self.assertAlmostEqual(row[3][1], -1.0, delta=1.0 / 127)

    def test_fresh_db_uses_4096_byte_pages(self):
        # 1024-byte pages were a legacy of sql.js-httpvfs range reads; the
        # browser now downloads the DB in full, so fresh DBs use the SQLite
        # default page size.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "fresh.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            page_size = db.con.execute("PRAGMA page_size").fetchone()[0]
            self.assertEqual(page_size, 4096)

    def test_legacy_fts_schema_migrates_to_current_columns(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "legacy-fts.sqlite")
            legacy = sqlite3.connect(dbpath)
            legacy.execute(
                "CREATE VIRTUAL TABLE images USING fts5("
                "path, album_relative_path, filename, geocode, exif, tags, colors, "
                "alt_text, critique, suggested_title, composition_critique, subject, "
                "tokenize='porter trigram')"
            )
            legacy.execute(
                "INSERT INTO images(path, filename, tags, alt_text, critique, subject) "
                "VALUES ('a.jpg', 'a.jpg', 'cat', 'A cat', 'unused', 'cat')"
            )
            legacy.commit()
            legacy.close()

            db = Sqlite3Client(dbpath)
            db.setup_tables()
            columns = [row[1] for row in db.con.execute("PRAGMA table_info(images)")]
            self.assertEqual(
                columns,
                [
                    "path",
                    "album_relative_path",
                    "filename",
                    "geocode",
                    "exif",
                    "tags",
                    "colors",
                    "alt_text",
                    "subject",
                ],
            )
            row = db.con.execute(
                "SELECT path, tags, alt_text, subject FROM images"
            ).fetchone()
            self.assertEqual(row, ("a.jpg", "cat", "A cat", "cat"))

    def test_rewrite_default_caption_provenance_names_current_default(self):
        # The pure rewrite must reconstruct exactly what caption_pipeline_version
        # now emits for the backend's default, and report the resolved model id.
        current = caption_pipeline_version(CLASSIFIER_BACKEND_GEMMA4_GGUF)
        resolved = resolve_classifier_model_id(CLASSIFIER_BACKEND_GEMMA4_GGUF)
        legacy = current.replace(f":{resolved}@external:", ":default@external:")
        self.assertIn(":default@external:", legacy)
        self.assertNotEqual(legacy, current)

        rewritten = rewrite_default_caption_provenance(legacy)
        self.assertEqual(rewritten, (current, resolved))
        # A version with no default marker is left alone.
        self.assertIsNone(rewrite_default_caption_provenance(current))

    def _seed_default_stamped_caption_db(self, dbpath, path):
        """Build a DB whose only caption row carries the legacy default marker."""
        resolved = resolve_classifier_model_id(CLASSIFIER_BACKEND_GEMMA4_GGUF)
        current_version = caption_pipeline_version(CLASSIFIER_BACKEND_GEMMA4_GGUF)
        legacy_version = current_version.replace(
            f":{resolved}@external:", ":default@external:"
        )
        db = Sqlite3Client(dbpath)
        db.setup_tables()
        insert_analysed_images_batch(
            db,
            [
                {
                    "path": path,
                    "analysed": {
                        "exif": {},
                        "geocode": {},
                        "lat_deg": None,
                        "lng_deg": None,
                        "iso8601": None,
                        "colors": [],
                        "tags": ["monkey"],
                        "alt_text": "A monkey",
                        "subject": "monkey",
                        "embeddings": [],
                    },
                    "write_core": True,
                    "write_caption": True,
                    "source_sha256": file_content_sha256(path),
                    "caption_version": legacy_version,
                    # NULL model id, as the pre-resolution pass recorded it.
                    "caption_model_id": None,
                }
            ],
        )
        db.con.close()
        return legacy_version, current_version, resolved

    def test_default_stamped_caption_provenance_migrates_on_open(self):
        # A DB stamped with the pre-resolution `default@external` caption marker
        # (NULL model id) must be healed in place on the next setup_tables open,
        # not recaptioned: the version and model id are rewritten to the current
        # resolved default so validate passes and a re-index does no caption work.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "default-caption.sqlite")
            legacy_version, current_version, resolved = (
                self._seed_default_stamped_caption_db(dbpath, path)
            )

            # Precondition: stored as the legacy default marker with NULL model id.
            con = sqlite3.connect(dbpath)
            stored = con.execute(
                "SELECT pipeline_version, model_id FROM pipeline_state WHERE stage = ?",
                (CAPTION_STAGE,),
            ).fetchone()
            con.close()
            self.assertEqual(stored, (legacy_version, None))

            # Any setup_tables-calling open heals it.
            healed = Sqlite3Client(dbpath)
            healed.setup_tables()
            digest, stored_version, stored_model_id = healed.get_pipeline_states()[
                (path, CAPTION_STAGE)
            ]
            healed.con.close()
            self.assertEqual(stored_version, current_version)
            self.assertEqual(stored_model_id, resolved)

            # validate now accepts it for the default gemma4-gguf backend.
            summary = validate_index_database(dbpath, path, "janus")
            self.assertEqual(summary["paths"], 1)

            # stage_needs_refresh is False through the real planner: a dry-run
            # index against the same default backend finds nothing to caption.
            result = CliRunner().invoke(
                index,
                [
                    "--glob",
                    path,
                    "--dbpath",
                    dbpath,
                    "--dry-run",
                    "--model-profile",
                    "janus",
                ],
            )
            self.assertEqual(0, result.exit_code, result.output)
            self.assertIn("(0 to index", result.output)

            # Idempotent: a second open matches no marker and changes nothing.
            second = Sqlite3Client(dbpath)
            second.setup_tables()
            self.assertEqual(
                second.get_pipeline_states()[(path, CAPTION_STAGE)],
                (digest, current_version, resolved),
            )
            second.con.close()

    def test_dry_run_treats_legacy_default_caption_as_current_without_migrating(self):
        # A read-only path (index --dry-run against an existing DB) never runs
        # setup_tables, so the physical migration cannot heal the default marker.
        # The staleness comparison must still normalise the stored provenance
        # through the marker-gated rewrite, or every default-stamped caption is
        # reported stale ("N to caption") — the exact scare the migration exists
        # to prevent — even though a real run would do byte-identical work.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "default-caption.sqlite")
            self._seed_default_stamped_caption_db(dbpath, path)

            # Deliberately do NOT open/heal the DB before the dry run.
            result = CliRunner().invoke(
                index,
                [
                    "--glob",
                    path,
                    "--dbpath",
                    dbpath,
                    "--dry-run",
                    "--model-profile",
                    "janus",
                ],
            )
            self.assertEqual(0, result.exit_code, result.output)
            self.assertIn("(0 to index", result.output)

            # The DB is genuinely untouched: the marker is still on disk.
            con = sqlite3.connect(dbpath)
            stored = con.execute(
                "SELECT pipeline_version FROM pipeline_state WHERE stage = ?",
                (CAPTION_STAGE,),
            ).fetchone()[0]
            con.close()
            self.assertIn(":default@external:", stored)

    def test_validate_accepts_unmigrated_default_caption_db(self):
        # Standalone `validate` opens read-only (mode=ro) and no write-intent
        # command may have healed the DB first. It must accept a default-stamped
        # caption via the same marker-gated normalisation rather than hard-failing
        # on "unexpected caption pipeline version".
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "default-caption.sqlite")
            self._seed_default_stamped_caption_db(dbpath, path)

            summary = validate_index_database(dbpath, path, "janus")
            self.assertEqual(summary["paths"], 1)

    def test_stale_default_marked_caption_still_reported_through_readonly_path(self):
        # The normalisation must not mask genuine staleness: a marker row whose
        # prompt version differs from the current one is rewritten (marker →
        # resolved) but the prompt-version prefix survives, so it stays stale.
        # Both the dry-run plan and validate must still flag it.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "default-caption.sqlite")
            legacy_version, _current_version, _resolved = (
                self._seed_default_stamped_caption_db(dbpath, path)
            )
            # Bump only the prompt-version prefix (first ':'-separated segment),
            # keeping the ':default@external:' marker intact.
            _first_segment, rest = legacy_version.split(":", 1)
            stale_version = f"v999-deadbeefcafe:{rest}"
            self.assertIn(":default@external:", stale_version)
            con = sqlite3.connect(dbpath)
            con.execute(
                "UPDATE pipeline_state SET pipeline_version = ? WHERE stage = ?",
                (stale_version, CAPTION_STAGE),
            )
            con.commit()
            con.close()

            result = CliRunner().invoke(
                index,
                [
                    "--glob",
                    path,
                    "--dbpath",
                    dbpath,
                    "--dry-run",
                    "--model-profile",
                    "janus",
                ],
            )
            self.assertEqual(0, result.exit_code, result.output)
            self.assertIn("(1 to index", result.output)

            with self.assertRaises(click.ClickException) as raised:
                validate_index_database(dbpath, path, "janus")
            self.assertIn("caption pipeline version", str(raised.exception))

    def test_embeddings_only_profile_still_writes_core_metadata(self):
        # The regression this guards: `needs_core` used to be gated on the
        # profile using a classifier, so an embeddings-only refresh parsed a
        # photo's EXIF and discarded it. 1049 rows ended up with a date in
        # `images.exif` and NULL in `metadata.iso8601`.
        #
        # Set up a row whose embeddings are already current, so the only work
        # left is core. Before the fix this planned nothing at all.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "core.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            existing_path = "../albums/test-simple/DSCF0506-2.jpg"
            db.insert_field(existing_path, field="filename", value="DSCF0506-2.jpg")
            for model_id in (
                "google/siglip-base-patch16-224",
                "google/siglip2-base-patch16-224",
            ):
                db.insert_embedding(existing_path, model_id, [0.1, 0.2, 0.3])
            # No metadata row, so core is the only outstanding stage.
            self.assertNotIn(existing_path, db.list_metadata_paths())

            runner = CliRunner()
            result = runner.invoke(
                index,
                f"--glob {existing_path} --dbpath {dbpath} --dry-run "
                "--model-profile siglip2".split(),
            )

            self.assertEqual(0, result.exit_code)
            self.assertIn("Analysing 1 files needing work", result.output)

    def test_analyse_reads_exif_only_when_core_is_wanted(self):
        # `read_exif` follows `needs_core`, so gating that flag also switched off
        # its own input — which is why the old behaviour lost the timestamp
        # rather than merely failing to store it.
        path = "../src/test/fixtures/monkey.jpg"

        with open(path, "rb") as fh:
            with_core = analyse_image(
                fh,
                path=path,
                needs_core=True,
                needs_classifier=False,
                precomputed_caption=None,
                precomputed_embeddings={"google/siglip2-base-patch16-224": [0.5]},
                precomputed_colors=[(0, 0, 0)],
            )
        with open(path, "rb") as fh:
            without_core = analyse_image(
                fh,
                path=path,
                needs_core=False,
                needs_classifier=False,
                precomputed_caption=None,
                precomputed_embeddings={"google/siglip2-base-patch16-224": [0.5]},
                precomputed_colors=[(0, 0, 0)],
            )

        self.assertTrue(with_core["iso8601"])
        self.assertIsNone(without_core["iso8601"])
        # Both still produce the embedding that the profile actually asked for.
        self.assertEqual(len(with_core["embeddings"]), 1)
        self.assertEqual(len(without_core["embeddings"]), 1)

    def test_siglip2_dry_run_backfills_missing_embeddings_for_existing_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "test-simple.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            existing_path = "../albums/test-simple/DSCF0506-2.jpg"
            db.insert_field(existing_path, field="filename", value="DSCF0506-2.jpg")

            runner = CliRunner()
            result = runner.invoke(
                index,
                f"--glob {existing_path} --dbpath {dbpath} --dry-run --model-profile siglip2".split(),
            )

            self.assertEqual(0, result.exit_code)
            self.assertTrue("Analysing 1 files needing work" in result.output)

    def test_indexed_image_populates_zfree_iso8601(self):
        # H3/L1: a newly indexed image must get a populated metadata.iso8601 (the
        # key mismatch previously left it NULL for every row), stored as naive
        # camera-local wall time with NO "Z" suffix.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "iso.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()

            with open(path, "rb") as fh:
                analysed = analyse_image(
                    fh,
                    path=path,
                    needs_classifier=False,
                    precomputed_caption=None,
                    precomputed_embeddings=None,
                    precomputed_colors=[(0, 0, 0)],
                )

            iso = analysed["iso8601"]
            self.assertTrue(iso)
            self.assertFalse(iso.endswith("Z"))
            self.assertRegex(iso, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

            insert_analysed_images_batch(
                db,
                [{"path": path, "analysed": analysed, "used_classifier": False}],
            )
            row = db.con.execute(
                "SELECT iso8601 FROM metadata WHERE path = ?", (path,)
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertIsNotNone(row[0])
            self.assertFalse(row[0].endswith("Z"))
            self.assertRegex(row[0], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")

    def test_delete_path_decrements_and_cleans_tag_counts(self):
        # L2: deleting/pruning a path must decrement its tags' frequency counts
        # and drop tags that reach zero, so the smoke-test's top tag can't end up
        # with zero remaining images.
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "tags.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()

            shared = "../albums/test-simple/DSCF0506-2.jpg"
            other = "../albums/test-simple/DSCF0593.jpg"
            db.upsert_image_fields(shared, {"filename": "a.jpg", "tags": "cat, dog"})
            db.upsert_image_fields(other, {"filename": "b.jpg", "tags": "dog"})
            db.replace_image_tags(shared, ["cat", "dog"])
            db.replace_image_tags(other, ["dog"])

            db.delete_path(shared)

            counts = dict(db.con.execute("SELECT tag, count FROM tags").fetchall())
            self.assertEqual(counts, {"dog": 1})

    def test_compute_reindex_plan_flags_changed_and_backfills_missing(self):
        indexed = {"a.jpg", "b.jpg", "c.jpg", "gone.jpg"}
        existing = {
            "a.jpg": (100.0, 10),  # unchanged
            "b.jpg": (200.0, 20),  # will differ -> changed
            # "c.jpg" has no stored signature -> backfill
        }
        current = {
            "a.jpg": (100.0, 10),
            "b.jpg": (250.0, 22),
            "c.jpg": (300.0, 30),
            # "gone.jpg" absent from disk -> neither changed nor backfilled
        }
        changed, backfill = compute_reindex_plan(indexed, existing, current)
        self.assertEqual(changed, {"b.jpg"})
        self.assertEqual(backfill, {"c.jpg": (300.0, 30)})

    def test_file_signature_roundtrip_and_delete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "sig.sqlite"))
            db.setup_tables()

            db.upsert_file_signature("x.jpg", 123.5, 4096)
            db.upsert_file_signatures({"y.jpg": (200.0, 8192)})
            db.con.commit()
            self.assertEqual(
                db.list_file_signatures(),
                {"x.jpg": (123.5, 4096), "y.jpg": (200.0, 8192)},
            )

            # Re-writing replaces rather than duplicating.
            db.upsert_file_signature("x.jpg", 999.0, 1)
            db.con.commit()
            self.assertEqual(db.list_file_signatures()["x.jpg"], (999.0, 1))

            # delete_path drops the signature so a re-added file re-indexes.
            db.upsert_image_fields("x.jpg", {"filename": "x.jpg"})
            db.con.commit()
            db.delete_path("x.jpg")
            self.assertNotIn("x.jpg", db.list_file_signatures())

    def test_stage_specific_refresh_preserves_unselected_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "stage.sqlite"))
            db.setup_tables()
            path = "photo.jpg"
            initial = {
                "exif": {},
                "geocode": {},
                "lat_deg": None,
                "lng_deg": None,
                "iso8601": None,
                "colors": [],
                "tags": ["old_tag"],
                "alt_text": "Old caption",
                "subject": "old subject",
                "embeddings": [
                    {"model_id": SiglipEmbedder.MODEL_ID, "embedding": [1.0, 0.0]},
                    {
                        "model_id": "google/siglip2-base-patch16-224",
                        "embedding": [0.0, 1.0],
                    },
                ],
            }
            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": path,
                        "analysed": initial,
                        "write_core": True,
                        "write_caption": True,
                        "source_sha256": "old-digest",
                        "caption_version": "old-caption-version",
                        "caption_model_id": "old-caption-model",
                    }
                ],
            )

            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": path,
                        "analysed": {
                            "embeddings": [
                                {
                                    "model_id": SiglipEmbedder.MODEL_ID,
                                    "embedding": [0.5, 0.5],
                                }
                            ]
                        },
                        "write_core": False,
                        "write_caption": False,
                        "source_sha256": "new-digest",
                    }
                ],
            )

            row = db.get_image_row(path)
            self.assertEqual(row["alt_text"], "Old caption")
            self.assertEqual(row["tags"], "old_tag")
            self.assertIsNotNone(
                db.get_embedding(path, "google/siglip2-base-patch16-224")
            )
            states = db.get_pipeline_states()
            self.assertEqual(states[(path, CAPTION_STAGE)][0], "old-digest")
            self.assertEqual(states[(path, SIGLIP_V1_STAGE)][0], "new-digest")

    def test_failed_caption_does_not_overwrite_or_complete_stage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "caption.sqlite"))
            db.setup_tables()
            path = "photo.jpg"
            db.upsert_image_fields(
                path,
                {"alt_text": "Existing caption", "subject": "subject", "tags": "tag"},
            )
            db.upsert_pipeline_state(
                path,
                CAPTION_STAGE,
                "old-digest",
                "old-caption-version",
            )

            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": path,
                        "analysed": {"embeddings": []},
                        "write_core": False,
                        "write_caption": False,
                        "caption_failed": True,
                        "source_sha256": "new-digest",
                    }
                ],
            )

            self.assertEqual(db.get_image_row(path)["alt_text"], "Existing caption")
            self.assertEqual(
                db.get_pipeline_states()[(path, CAPTION_STAGE)][0], "old-digest"
            )

    def test_caption_generation_metrics_are_persisted_per_attempt(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "metrics.sqlite"))
            db.setup_tables()
            db.insert_caption_generation_metrics(
                [
                    {
                        "path": "photo.jpg",
                        "pipelineVersion": "caption-v1",
                        "attempt": "batch",
                        "batchSize": 4,
                        "maxNewTokens": 128,
                        "tokenCount": 74,
                        "completedWithEos": True,
                        "hitTokenLimit": False,
                        "parseSuccess": True,
                        "decodeMs": 12.5,
                        "processorMs": 4.0,
                        "visionPreparationMs": 8.0,
                        "generateBatchMs": 1000.0,
                    }
                ]
            )

            row = db.con.execute(
                "SELECT path, attempt, batch_size, max_new_tokens, token_count, "
                "completed_with_eos, parse_success, decode_ms, generate_batch_ms "
                "FROM caption_generation_metrics"
            ).fetchone()
            self.assertEqual(
                row,
                ("photo.jpg", "batch", 4, 128, 74, 1, 1, 12.5, 1000.0),
            )

    def test_incomplete_core_write_remains_retryable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "core.sqlite"))
            db.setup_tables()
            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": "photo.jpg",
                        "analysed": {
                            "exif": {},
                            "geocode": {},
                            "lat_deg": None,
                            "lng_deg": None,
                            "iso8601": None,
                            "colors": [],
                            "embeddings": [],
                        },
                        "write_core": True,
                        "write_caption": False,
                        "core_complete": False,
                        "source_sha256": "digest",
                    }
                ],
            )
            self.assertIsNotNone(db.get_image_row("photo.jpg"))
            self.assertNotIn(("photo.jpg", CORE_STAGE), db.get_pipeline_states())

    def test_content_digest_detects_same_size_same_mtime_replacement(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "photo.jpg")
            with open(path, "wb") as fh:
                fh.write(b"first")
            timestamp = os.stat(path).st_mtime
            first = file_content_sha256(path)
            with open(path, "wb") as fh:
                fh.write(b"other")
            os.utime(path, (timestamp, timestamp))
            self.assertNotEqual(first, file_content_sha256(path))

    def test_parallel_content_digests_map_to_their_own_paths(self):
        # Every file must get *its own* digest back. Descending sizes mean workers
        # finish in a different order to submission, so a concurrency change that
        # stops preserving order (`as_completed` in place of `executor.map`) hands
        # each photo a neighbour's digest and silently corrupts every stage
        # freshness decision. Distinct contents are what make that detectable.
        with tempfile.TemporaryDirectory() as tmpdir:
            paths = []
            for i in range(8):
                path = os.path.join(tmpdir, f"file-{i}.bin")
                with open(path, "wb") as fh:
                    fh.write(f"content-{i}".encode() * (10_000 - i * 1_000))
                paths.append(path)

            actual = file_content_sha256_many(paths, workers=4)
            expected = {path: file_content_sha256(path) for path in paths}

            self.assertEqual(actual, expected)
            self.assertEqual(len(set(expected.values())), len(paths))

    def test_parallel_content_digests_report_unreadable_files_as_none(self):
        # `index` turns a None digest into an actionable "could not fingerprint"
        # error and `validate` treats it as stale provenance. Dropping the file or
        # killing the pool instead would either abort a whole run over one bad
        # photo, or mark it fresh forever.
        with tempfile.TemporaryDirectory() as tmpdir:
            readable = os.path.join(tmpdir, "readable.bin")
            with open(readable, "wb") as fh:
                fh.write(b"readable")
            missing = os.path.join(tmpdir, "missing.bin")

            actual = file_content_sha256_many([readable, missing], workers=2)

            self.assertEqual(actual[readable], file_content_sha256(readable))
            self.assertIsNone(actual[missing])

    def test_validate_proves_exact_core_and_caption_coverage(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "validate.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            digest = file_content_sha256(path)
            analysed = {
                "exif": {},
                "geocode": {},
                "lat_deg": None,
                "lng_deg": None,
                "iso8601": None,
                "colors": [],
                "tags": ["monkey"],
                "alt_text": "A monkey",
                "subject": "monkey",
                "embeddings": [],
            }
            insert_analysed_images_batch(
                db,
                [
                    {
                        "path": path,
                        "analysed": analysed,
                        "write_core": True,
                        "write_caption": True,
                        "source_sha256": digest,
                        "caption_version": caption_pipeline_version("janus"),
                        "caption_model_id": "deepseek-ai/Janus-Pro-1B",
                    }
                ],
            )
            db.con.close()

            summary = validate_index_database(
                dbpath, path, "janus", classifier_backend="janus"
            )
            self.assertEqual(summary["paths"], 1)
            self.assertEqual(summary["quickCheck"], "ok")

            core_output = os.path.join(tmpdir, "core.sqlite")
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")
            publish_index_databases(dbpath, embeddings_output, core_output)
            core = sqlite3.connect(core_output)
            embeddings = sqlite3.connect(embeddings_output)
            self.assertIsNone(
                core.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'embeddings'"
                ).fetchone()
            )
            self.assertIsNone(
                core.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'pipeline_state'"
                ).fetchone()
            )
            self.assertIsNone(
                core.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'caption_generation_metrics'"
                ).fetchone()
            )
            self.assertIsNotNone(
                embeddings.execute(
                    "SELECT 1 FROM sqlite_master WHERE name = 'embeddings'"
                ).fetchone()
            )
            self.assertEqual(core.execute("PRAGMA quick_check").fetchone()[0], "ok")
            self.assertEqual(
                embeddings.execute("PRAGMA quick_check").fetchone()[0], "ok"
            )
            core.close()
            embeddings.close()

    def _seed_validatable_db(self, dbpath, path, embeddings=None):
        """Build a single-path DB that passes validate, for negative-case tests."""
        db = Sqlite3Client(dbpath)
        db.setup_tables()
        insert_analysed_images_batch(
            db,
            [
                {
                    "path": path,
                    "analysed": {
                        "exif": {},
                        "geocode": {},
                        "lat_deg": None,
                        "lng_deg": None,
                        "iso8601": None,
                        "colors": [],
                        "tags": ["monkey"],
                        "alt_text": "A monkey",
                        "subject": "monkey",
                        "embeddings": embeddings or [],
                    },
                    "write_core": True,
                    "write_caption": True,
                    "source_sha256": file_content_sha256(path),
                    "caption_version": caption_pipeline_version("janus"),
                    "caption_model_id": JANUS_MODEL_ID,
                }
            ],
        )
        db.con.close()

    # validate is the only gate between a partial staging DB and publish
    # overwriting the live databases, so each rejection branch needs a test: an
    # inverted comparison here turns the gate into a no-op that always passes.

    def test_validate_rejects_missing_image_coverage(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "validate.sqlite")
            self._seed_validatable_db(dbpath, path)
            con = sqlite3.connect(dbpath)
            con.execute("DELETE FROM images WHERE path = ?", (path,))
            con.commit()
            con.close()

            with self.assertRaises(click.ClickException):
                validate_index_database(
                    dbpath, path, "janus", classifier_backend="janus"
                )

    def test_validate_rejects_stale_source_provenance(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "validate.sqlite")
            self._seed_validatable_db(dbpath, path)
            con = sqlite3.connect(dbpath)
            con.execute(
                "UPDATE pipeline_state SET source_sha256 = ? WHERE stage = ?",
                ("0" * 64, CORE_STAGE),
            )
            con.commit()
            con.close()

            with self.assertRaises(click.ClickException):
                validate_index_database(
                    dbpath, path, "janus", classifier_backend="janus"
                )

    def test_validate_rejects_unexpected_caption_pipeline_version(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "validate.sqlite")
            self._seed_validatable_db(dbpath, path)
            con = sqlite3.connect(dbpath)
            con.execute(
                "UPDATE pipeline_state SET pipeline_version = ? WHERE stage = ?",
                ("caption-search-json-v1-deadbeef:janus", CAPTION_STAGE),
            )
            con.commit()
            con.close()

            with self.assertRaises(click.ClickException):
                validate_index_database(
                    dbpath, path, "janus", classifier_backend="janus"
                )

    def test_validate_rejects_tag_counts_diverging_from_image_tags(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "validate.sqlite")
            self._seed_validatable_db(dbpath, path)
            con = sqlite3.connect(dbpath)
            con.execute("UPDATE tags SET count = count + 41")
            con.commit()
            con.close()

            with self.assertRaises(click.ClickException):
                validate_index_database(
                    dbpath, path, "janus", classifier_backend="janus"
                )

    def test_publish_copies_embedding_rows_to_their_own_paths(self):
        # The publish INSERT lists five columns positionally; a reordering or a
        # row-dropping filter ships an empty or scrambled search-embeddings.sqlite
        # and semantic search silently returns garbage. Nothing validates the
        # published outputs, so this is the only place it can be caught.
        path = "../src/test/fixtures/monkey.jpg"
        vector = [0.5, -0.25, 0.75, 1.0]
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "source.sqlite")
            self._seed_validatable_db(
                dbpath,
                path,
                embeddings=[{"model_id": SiglipEmbedder.MODEL_ID, "embedding": vector}],
            )
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")
            publish_index_databases(dbpath, embeddings_output)

            con = sqlite3.connect(embeddings_output)
            row = con.execute(
                "SELECT path, model_id, embedding_dim, embedding_blob, embedding_scale "
                "FROM embeddings"
            ).fetchone()
            con.close()

            self.assertEqual(row[0], path)
            self.assertEqual(row[1], SiglipEmbedder.MODEL_ID)
            self.assertEqual(row[2], len(vector))
            decoded = decode_embedding(row[3], row[4])
            for actual, expected in zip(decoded, vector):
                self.assertAlmostEqual(actual, expected, places=2)

    def test_publish_retains_runtime_tables_in_the_core_output(self):
        # The core output drops build-only tables. Adding a runtime table to that
        # drop list would ship a DB with no facets or no map, which the existing
        # "these tables are absent" assertions cannot detect.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            core_output = os.path.join(tmpdir, "core.sqlite")
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")
            publish_index_databases(dbpath, embeddings_output, core_output)

            con = sqlite3.connect(core_output)
            self.assertEqual(
                con.execute("SELECT COUNT(*) FROM images").fetchone()[0], 1
            )
            self.assertEqual(
                con.execute("SELECT COUNT(*) FROM metadata").fetchone()[0], 1
            )
            self.assertEqual(con.execute("SELECT COUNT(*) FROM tags").fetchone()[0], 1)
            con.close()

    def test_publish_leaves_live_outputs_untouched_when_generation_fails(self):
        # Publication builds .tmp files and only renames after both pass their
        # checks. Connecting straight to the output path, or renaming inside the
        # build loop, would truncate the live DB on any mid-run failure.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            con = sqlite3.connect(dbpath)
            con.execute("DROP TABLE embeddings")
            con.commit()
            con.close()

            core_output = os.path.join(tmpdir, "core.sqlite")
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")
            for output in (core_output, embeddings_output):
                with open(output, "wb") as fh:
                    fh.write(b"live-database")

            with self.assertRaises(sqlite3.OperationalError):
                publish_index_databases(dbpath, embeddings_output, core_output)

            for output in (core_output, embeddings_output):
                with open(output, "rb") as fh:
                    self.assertEqual(fh.read(), b"live-database")
                self.assertFalse(os.path.exists(output + ".tmp"))

    def test_publish_keeps_one_backup_of_each_replaced_database(self):
        # `rename` unlinks the previous inode, so without this the last good
        # published DB is gone the instant a publish lands. The backup goes beside
        # the source, never into public/, which is copied wholesale into the site
        # build and would serve it.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = os.path.join(tmpdir, "index")
            public_dir = os.path.join(tmpdir, "public")
            os.makedirs(source_dir)
            os.makedirs(public_dir)
            dbpath = os.path.join(source_dir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)

            core_output = os.path.join(public_dir, "search.sqlite")
            embeddings_output = os.path.join(public_dir, "search-embeddings.sqlite")
            for output in (core_output, embeddings_output):
                with open(output, "wb") as fh:
                    fh.write(b"previous-published-database")

            publish_index_databases(
                dbpath, embeddings_output, core_output, allow_shrink=True
            )

            for output in (core_output, embeddings_output):
                backup = os.path.join(
                    source_dir, f"published-{os.path.basename(output)}.bak"
                )
                self.assertTrue(os.path.exists(backup))
                with open(backup, "rb") as fh:
                    self.assertEqual(fh.read(), b"previous-published-database")
                # The replaced output is the new DB, not the old bytes.
                with open(output, "rb") as fh:
                    self.assertNotEqual(fh.read(), b"previous-published-database")
                # Nothing extra may land in public/, which ships as static assets.
                self.assertFalse(os.path.exists(output + ".bak"))

    def test_publish_backup_keeps_only_the_most_recent_replaced_copy(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = os.path.join(tmpdir, "index")
            public_dir = os.path.join(tmpdir, "public")
            os.makedirs(source_dir)
            os.makedirs(public_dir)
            dbpath = os.path.join(source_dir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            embeddings_output = os.path.join(public_dir, "search-embeddings.sqlite")
            backup = os.path.join(source_dir, "published-search-embeddings.sqlite.bak")

            with open(embeddings_output, "wb") as fh:
                fh.write(b"generation-one")
            publish_index_databases(dbpath, embeddings_output, allow_shrink=True)
            with open(backup, "rb") as fh:
                self.assertEqual(fh.read(), b"generation-one")

            # Publishing again replaces the backup rather than accumulating copies.
            publish_index_databases(dbpath, embeddings_output, allow_shrink=True)
            with open(backup, "rb") as fh:
                self.assertNotEqual(fh.read(), b"generation-one")
            self.assertEqual(
                len([n for n in os.listdir(source_dir) if n.endswith(".bak")]), 1
            )

    def test_publish_backup_falls_back_to_a_copy_across_filesystems(self):
        # Hard linking is the fast path, but --core-output may sit on another
        # filesystem, where link() raises EXDEV and only a copy can work.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = os.path.join(tmpdir, "index")
            public_dir = os.path.join(tmpdir, "public")
            os.makedirs(source_dir)
            os.makedirs(public_dir)
            dbpath = os.path.join(source_dir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            embeddings_output = os.path.join(public_dir, "search-embeddings.sqlite")
            with open(embeddings_output, "wb") as fh:
                fh.write(b"previous-published-database")

            with mock.patch(
                "index.os.link", side_effect=OSError(18, "Invalid cross-device link")
            ):
                publish_index_databases(dbpath, embeddings_output, allow_shrink=True)

            backup = os.path.join(source_dir, "published-search-embeddings.sqlite.bak")
            with open(backup, "rb") as fh:
                self.assertEqual(fh.read(), b"previous-published-database")
            self.assertFalse(os.path.exists(backup + ".partial"))

    def _published_pair(self, tmpdir):
        source_dir = os.path.join(tmpdir, "index")
        public_dir = os.path.join(tmpdir, "public")
        os.makedirs(source_dir, exist_ok=True)
        os.makedirs(public_dir, exist_ok=True)
        return (
            source_dir,
            os.path.join(source_dir, "source.sqlite"),
            os.path.join(public_dir, "search.sqlite"),
            os.path.join(public_dir, "search-embeddings.sqlite"),
        )

    def test_publish_restores_the_whole_pair_when_one_rename_fails(self):
        # Each rename is atomic, but the pair is not. Replacing core and then
        # failing on embeddings would leave a new core against old vectors: photos
        # with no embeddings, and vectors for paths no longer in core. The site
        # loads both, so the pair must move together or not at all.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            _source_dir, dbpath, core_output, embeddings_output = self._published_pair(
                tmpdir
            )
            self._seed_validatable_db(dbpath, path)
            for output in (core_output, embeddings_output):
                with open(output, "wb") as fh:
                    fh.write(b"consistent-live-pair")

            # Count only renames onto the published outputs: replace_atomically
            # also writes the journal, and counting those would trip the failure
            # before anything had actually moved.
            published = {str(core_output), str(embeddings_output)}
            attempts = []
            failed = []

            def fail_after_first_output(source, destination):
                # Stop counting once we have failed: the rollback restores through
                # this same helper, and counting those would mask the failure.
                if str(destination) in published and not failed:
                    attempts.append(str(destination))
                    if len(attempts) == 2:
                        failed.append(True)
                        raise OSError("interrupted between renames")
                source.replace(destination)

            with (
                mock.patch(
                    "index.replace_atomically", side_effect=fail_after_first_output
                ),
                self.assertRaises(OSError),
            ):
                publish_index_databases(
                    dbpath, embeddings_output, core_output, allow_shrink=True
                )

            # The first output really was replaced before the second failed, so the
            # pair below is only consistent because it was rolled back.
            self.assertEqual(len(attempts), 2)
            for output in (core_output, embeddings_output):
                with open(output, "rb") as fh:
                    self.assertEqual(fh.read(), b"consistent-live-pair")

    def test_publish_journals_its_intent_before_moving_anything(self):
        # The journal is the only thing that survives a SIGKILL, so it has to be on
        # disk before the first rename, not after the last.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir, dbpath, core_output, embeddings_output = self._published_pair(
                tmpdir
            )
            self._seed_validatable_db(dbpath, path)
            for output in (core_output, embeddings_output):
                with open(output, "wb") as fh:
                    fh.write(b"consistent-live-pair")

            journal = os.path.join(source_dir, ".publish-journal.json")
            published = {str(core_output), str(embeddings_output)}
            seen_during_rename = []

            def record_journal(source, destination):
                if str(destination) in published:
                    seen_during_rename.append(os.path.exists(journal))
                source.replace(destination)

            with mock.patch("index.replace_atomically", side_effect=record_journal):
                publish_index_databases(
                    dbpath, embeddings_output, core_output, allow_shrink=True
                )

            self.assertEqual(len(seen_during_rename), 2)
            self.assertTrue(all(seen_during_rename))

    def test_publish_repairs_a_pair_left_skewed_by_an_interrupted_publish(self):
        # A SIGKILL or power loss between the two renames cannot be caught in
        # process, so the intent is journalled: the next publish must put the pair
        # back before doing anything else.
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir, _dbpath, core_output, embeddings_output = self._published_pair(
                tmpdir
            )
            backups = {}
            for output in (core_output, embeddings_output):
                backup = os.path.join(
                    source_dir, f"published-{os.path.basename(output)}.bak"
                )
                with open(backup, "wb") as fh:
                    fh.write(b"previous-consistent-pair")
                backups[output] = backup

            # Core was replaced; the process died before embeddings followed.
            with open(core_output, "wb") as fh:
                fh.write(b"half-applied-new-core")
            with open(embeddings_output, "wb") as fh:
                fh.write(b"previous-consistent-pair")
            write_publish_journal(
                Path(source_dir),
                [(Path(o), Path(b)) for o, b in backups.items()],
            )

            restored = restore_interrupted_publish(Path(source_dir))

            self.assertEqual(len(restored), 2)
            for output in (core_output, embeddings_output):
                with open(output, "rb") as fh:
                    self.assertEqual(fh.read(), b"previous-consistent-pair")
            self.assertFalse(
                os.path.exists(os.path.join(source_dir, ".publish-journal.json"))
            )

    def test_publish_repairs_an_interrupted_publish_before_republishing(self):
        # Proves publish actually runs the repair rather than merely offering it.
        # The journal names the core output, which this publish does not write, so
        # its restored content is only explicable by the repair having run.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir, dbpath, core_output, embeddings_output = self._published_pair(
                tmpdir
            )
            self._seed_validatable_db(dbpath, path)

            core_backup = os.path.join(source_dir, "published-search.sqlite.bak")
            with open(core_backup, "wb") as fh:
                fh.write(b"previous-consistent-core")
            with open(core_output, "wb") as fh:
                fh.write(b"half-applied-new-core")
            write_publish_journal(
                Path(source_dir), [(Path(core_output), Path(core_backup))]
            )

            # Publishes embeddings only — nothing here touches the core output.
            publish_index_databases(dbpath, embeddings_output)

            with open(core_output, "rb") as fh:
                self.assertEqual(fh.read(), b"previous-consistent-core")
            self.assertFalse(
                os.path.exists(os.path.join(source_dir, ".publish-journal.json"))
            )

    def test_publish_leaves_no_journal_behind_on_success(self):
        # A journal surviving a good publish would make the next run roll back a
        # perfectly healthy pair.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir, dbpath, core_output, embeddings_output = self._published_pair(
                tmpdir
            )
            self._seed_validatable_db(dbpath, path)

            publish_index_databases(dbpath, embeddings_output, core_output)

            self.assertFalse(
                os.path.exists(os.path.join(source_dir, ".publish-journal.json"))
            )

    def test_publish_writes_no_backup_when_there_is_nothing_to_replace(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            source_dir = os.path.join(tmpdir, "index")
            public_dir = os.path.join(tmpdir, "public")
            os.makedirs(source_dir)
            os.makedirs(public_dir)
            dbpath = os.path.join(source_dir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)

            publish_index_databases(
                dbpath, os.path.join(public_dir, "search-embeddings.sqlite")
            )

            self.assertEqual(
                [n for n in os.listdir(source_dir) if n.endswith(".bak")], []
            )

    def test_publish_refuses_to_replace_a_live_index_with_a_much_smaller_one(self):
        # quick_check proves structure, not content. Without a row-count floor a
        # stray publish from a fixture DB replaces the live index, and rename has
        # already unlinked the only copy.
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            core_output = os.path.join(tmpdir, "core.sqlite")
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")

            published = Sqlite3Client(core_output)
            published.setup_tables()
            with published.transaction() as cur:
                for i in range(50):
                    cur.execute("INSERT INTO images(path) VALUES (?)", (f"{path}#{i}",))
            published.con.close()

            with self.assertRaises(click.ClickException):
                publish_index_databases(dbpath, embeddings_output, core_output)

            con = sqlite3.connect(core_output)
            self.assertEqual(
                con.execute("SELECT COUNT(*) FROM images").fetchone()[0], 50
            )
            con.close()

    def test_publish_allows_a_smaller_index_when_explicitly_permitted(self):
        path = "../src/test/fixtures/monkey.jpg"
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "source.sqlite")
            self._seed_validatable_db(dbpath, path)
            core_output = os.path.join(tmpdir, "core.sqlite")
            embeddings_output = os.path.join(tmpdir, "embeddings.sqlite")

            published = Sqlite3Client(core_output)
            published.setup_tables()
            with published.transaction() as cur:
                for i in range(50):
                    cur.execute("INSERT INTO images(path) VALUES (?)", (f"{path}#{i}",))
            published.con.close()

            publish_index_databases(
                dbpath, embeddings_output, core_output, allow_shrink=True
            )

            con = sqlite3.connect(core_output)
            self.assertEqual(
                con.execute("SELECT COUNT(*) FROM images").fetchone()[0], 1
            )
            con.close()

    def test_geocode_columns_keyed_off_admin_fields(self):
        # region = admin1 (state), subregion = admin2 (county), by key.
        self.assertEqual(
            geocode_columns(
                {
                    "country_code": "JP",
                    "city": "Kamikawa",
                    "state": "Hokkaido",
                    "county": "Kamikawa-gun (Ishikari)",
                    "country": "Japan",
                }
            ),
            {
                "geo_city": "Kamikawa",
                "geo_region": "Hokkaido",
                "geo_subregion": "Kamikawa-gun (Ishikari)",
                "geo_country": "Japan",
            },
        )
        # Kyoto: admin1 absent, admin2 present — county must NOT slide into the
        # region slot (the positional bug this refinement fixes).
        self.assertEqual(
            geocode_columns(
                {"city": "Kyoto", "county": "Kyōto Shi", "country": "Japan"}
            ),
            {
                "geo_city": "Kyoto",
                "geo_region": None,
                "geo_subregion": "Kyōto Shi",
                "geo_country": "Japan",
            },
        )
        # Tokyo: prefecture == city, so the library omits state/county.
        self.assertEqual(
            geocode_columns({"city": "Tokyo", "country": "Japan"}),
            {
                "geo_city": "Tokyo",
                "geo_region": None,
                "geo_subregion": None,
                "geo_country": "Japan",
            },
        )

    def test_build_geocode_fields_strips_numbers_from_searchable_blob(self):
        # City "Singapore" == country "Singapore" is the single-line case.
        blob, columns = build_geocode_fields(
            {"country_code": "SG", "city": "Singapore", "country": "Singapore"}
        )
        self.assertEqual(blob, "Singapore\nSingapore")
        self.assertEqual(columns["geo_city"], "Singapore")
        self.assertEqual(columns["geo_country"], "Singapore")
        # No geocode -> nothing to store.
        self.assertEqual(build_geocode_fields(None), (None, {}))
        self.assertEqual(build_geocode_fields({}), (None, {}))

    def test_insert_metadata_stores_geocode_columns(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "geo.sqlite"))
            db.setup_tables()
            db.insert_metadata(
                "x.jpg",
                lat_lng_deg=(35.0, 139.0),
                iso8601="2024-01-02T03:04:05",
                geocode={
                    "geo_city": "Kamikawa",
                    "geo_region": "Hokkaido",
                    "geo_subregion": "Kamikawa-gun",
                    "geo_country": "Japan",
                },
            )
            db.con.commit()
            row = db.con.execute(
                "SELECT geo_city, geo_region, geo_subregion, geo_country "
                "FROM metadata WHERE path = ?",
                ("x.jpg",),
            ).fetchone()
            self.assertEqual(row, ("Kamikawa", "Hokkaido", "Kamikawa-gun", "Japan"))

    def _seed_tags(self, db, counts):
        with db.transaction() as cur:
            cur.execute("DELETE FROM tags")
            cur.executemany(
                "INSERT INTO tags (tag, count) VALUES (?, ?)",
                list(counts.items()),
            )

    def _read_counts(self, dbpath):
        # Short-lived connection: a held-open one would lock the DB against the
        # CLI's journal-mode switch on a subsequent invoke.
        con = sqlite3.connect(dbpath)
        try:
            return dict(con.execute("SELECT tag, count FROM tags").fetchall())
        finally:
            con.close()

    def _read_geo(self, dbpath, path):
        con = sqlite3.connect(dbpath)
        try:
            return con.execute(
                "SELECT geo_city, geo_country FROM metadata WHERE path = ?",
                (path,),
            ).fetchone()
        finally:
            con.close()

    def test_backfill_corrects_counts_and_populates_geo_idempotently(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "backfill.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()

            # Two geolocated images (Tokyo, Singapore), indexed the old way: no
            # geo_* (insert_metadata with no geocode leaves them NULL).
            db.insert_metadata("a.jpg", (35.68, 139.76), "")  # Tokyo
            db.insert_metadata("b.jpg", (1.29, 103.85), "")  # Singapore
            db.upsert_image_fields("a.jpg", {"tags": "cityscape"})
            db.upsert_image_fields("b.jpg", {"tags": "skyline"})
            # Old inflated counts: geocode-derived tags (Japan/JP/Singapore),
            # a comma-bearing VLM tag, and a "ghost" orphan — none recoverable by
            # re-splitting images.tags, so the fix must preserve them in place.
            self._seed_tags(
                db,
                {
                    "Japan": 2,
                    "JP": 2,
                    "Singapore": 2,
                    "nature, relaxation": 3,
                    "ghost": 1,
                },
            )
            db.con.commit()
            db.con.close()  # release the DB before the CLI re-opens it

            result = CliRunner().invoke(cli, ["backfill", "--dbpath", dbpath])
            self.assertEqual(result.exit_code, 0, result.output)

            tokyo = self._read_geo(dbpath, "a.jpg")
            self.assertEqual(tokyo[1], "Japan")
            self.assertTrue(tokyo[0])  # a city resolved from the coordinates
            self.assertEqual(self._read_geo(dbpath, "b.jpg")[1], "Singapore")
            counts = self._read_counts(dbpath)
            self.assertEqual(counts["Japan"], 1)
            self.assertEqual(counts["JP"], 1)
            self.assertEqual(counts["Singapore"], 1)
            self.assertEqual(counts["SG"], 1)
            self.assertEqual(counts["cityscape"], 1)
            self.assertEqual(counts["skyline"], 1)
            self.assertNotIn("ghost", counts)
            self.assertNotIn("nature, relaxation", counts)

            # Re-running must not decrement again (geo_* now populated → skip).
            again = CliRunner().invoke(cli, ["backfill", "--dbpath", dbpath])
            self.assertEqual(again.exit_code, 0, again.output)
            self.assertEqual(self._read_counts(dbpath), counts)

    def test_backfill_dry_run_leaves_db_untouched(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "backfill-dry.sqlite")
            db = Sqlite3Client(dbpath)
            db.setup_tables()
            db.insert_metadata("a.jpg", (35.68, 139.76), "")
            db.upsert_image_fields("a.jpg", {"tags": "cityscape"})
            self._seed_tags(db, {"Japan": 2, "JP": 2})
            db.con.commit()
            db.con.close()

            result = CliRunner().invoke(
                cli, ["backfill", "--dbpath", dbpath, "--dry-run"]
            )
            self.assertEqual(result.exit_code, 0, result.output)

            self.assertIsNone(self._read_geo(dbpath, "a.jpg")[0])
            self.assertEqual(self._read_counts(dbpath), {"Japan": 2, "JP": 2})

    def test_benchmark_index_outputs_summary_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "benchmark.json")
            runner = CliRunner()

            result = runner.invoke(
                cli,
                f"benchmark-index --rows 5 --repeat 2 --output {output_path}".split(),
                standalone_mode=False,
            )

            self.assertEqual(0, result.exit_code)
            with open(output_path, "r", encoding="utf-8") as fh:
                parsed = json.load(fh)

            self.assertEqual(parsed["rows"], 5)
            self.assertEqual(parsed["repeat"], 2)
            self.assertEqual(len(parsed["runs"]), 2)
            self.assertTrue(parsed["medianInsertTotalMs"] >= 0)

    def test_compare_captioners_writes_report_from_existing_db_baseline(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dbpath = os.path.join(tmpdir, "baseline.sqlite")
            output_json = os.path.join(tmpdir, "compare.json")
            output_md = os.path.join(tmpdir, "compare.md")

            db = Sqlite3Client(dbpath)
            db.setup_tables()
            path = "../albums/test-simple/DSCF0506-2.jpg"
            db.upsert_image_fields(
                path,
                {
                    "filename": "DSCF0506-2.jpg",
                    "album_relative_path": "/album/test-simple#DSCF0506-2.jpg",
                    "tags": "monkey, branch",
                    "alt_text": "Monkey on a branch",
                    "subject": "monkey",
                },
            )

            runner = CliRunner()

            class StubClassifier:
                backend = "gemma4"
                model_id = "stub/gemma4"
                quantization = "bnb-4bit"

                def init_model(self):
                    return None

                def release(self):
                    return None

                def predict(self, _path, _geocode):
                    return json.dumps(
                        {
                            "identified_objects": ["monkey", "branch", "leaves"],
                            "themes": ["wildlife"],
                            "alt_text": "Monkey sitting on a branch among leaves.",
                            "subject": "monkey on branch",
                        }
                    )

            with mock.patch("index.create_classifier", return_value=StubClassifier()):
                result = runner.invoke(
                    cli,
                    [
                        "compare-captioners",
                        "--glob",
                        path,
                        "--baseline-dbpath",
                        dbpath,
                        "--sample-size",
                        "1",
                        "--output-json",
                        output_json,
                        "--output-md",
                        output_md,
                    ],
                    standalone_mode=False,
                )

            self.assertEqual(0, result.exit_code)
            self.assertTrue(os.path.exists(output_json))
            self.assertTrue(os.path.exists(output_md))
            with open(output_json, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
            self.assertEqual(payload["summary"]["sampleSize"], 1)
            self.assertEqual(payload["summary"]["verdictCounts"]["candidate_better"], 1)


class SplitEmbeddingsDatabaseTest(unittest.TestCase):
    """`do-full-index.sh` moves the embeddings into their own database and leaves
    the table behind, empty. Anything that asks "which photos are embedded?" has
    to look there too — otherwise every indexed photo reads as unembedded and the
    next index run re-derives thousands of embeddings on the GPU for photos that
    already have them."""

    def test_reads_embedding_paths_from_the_split_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            core_path = os.path.join(tmp, "search.sqlite")
            split_path = os.path.join(tmp, "search-embeddings.sqlite")

            core = Sqlite3Client(core_path)
            core.setup_tables()
            core.con.commit()

            split = sqlite3.connect(split_path)
            split.execute(
                "CREATE TABLE embeddings (path VARCHAR, model_id TEXT, embedding_dim INTEGER,"
                " embedding_blob BLOB, embedding_scale REAL)"
            )
            split.execute(
                "INSERT INTO embeddings (path, model_id) VALUES (?, ?)",
                ("../albums/trip/a.jpg", "google/siglip-base-patch16-224"),
            )
            split.commit()
            split.close()

            self.assertEqual(
                core.list_embedding_paths("google/siglip-base-patch16-224"),
                {"../albums/trip/a.jpg"},
            )

    def test_prefers_its_own_embeddings_when_it_has_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            core_path = os.path.join(tmp, "search.sqlite")
            core = Sqlite3Client(core_path)
            core.setup_tables()
            core.con.execute(
                "INSERT INTO embeddings (path, model_id) VALUES (?, ?)",
                ("../albums/trip/own.jpg", "google/siglip-base-patch16-224"),
            )
            core.con.commit()

            self.assertEqual(
                core.list_embedding_paths("google/siglip-base-patch16-224"),
                {"../albums/trip/own.jpg"},
            )


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    unittest.main()
