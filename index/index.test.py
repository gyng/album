from index import (
    acquire_single_instance_lock,
    analyse_image,
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    build_classifier_prompt,
    build_janus_prompt,
    build_geocode_fields,
    compare_caption_payloads,
    compute_reindex_plan,
    create_classifier,
    decode_embedding,
    encode_embedding,
    geocode_columns,
    extract_geocode_from_path,
    filter_exif_for_search,
    heartbeat,
    insert_analysed_images_batch,
    log_vram,
    log_vram_peak,
    parse_caption_with_retry,
    run_embedding_pass,
    Gemma4Classifier,
    Gemma4GgufClassifier,
    JanusClassifier,
    parse_classifier_response,
    parse_janus_response,
    prune,
    sample_balanced_paths,
    Sqlite3Client,
    cli,
    index,
    search,
    search_similar_path,
    search_tags,
    update_gps,
)
import os
import shutil
import sqlite3
import tempfile
import time
import unittest
import click
from click.testing import CliRunner
import json
from unittest import mock


RUN_MODEL_INFERENCE = os.environ.get("INDEX_RUN_MODEL_INFERENCE") == "1"


class TestMain(unittest.TestCase):
    def test_find_files(self):
        res = find_files(".", "../albums/test-simple/*.jpg")
        self.assertEqual(len(res), 5)

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

        self.assertTrue("identified_objects" in actual)
        self.assertTrue("themes" in actual)
        self.assertTrue("alt_text" in actual)
        self.assertTrue("subject" in actual)
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
        self.assertTrue("serene" in actual["identified_objects"])
        self.assertTrue("bird" in actual["identified_objects"])
        self.assertEqual(actual["themes"], [])

    def test_parse_classifier_response_accepts_embedded_json(self):
        actual = parse_classifier_response(
            'Sure, here it is: {"identified_objects":["tram"],"themes":["commute"],"alt_text":"Red tram at a stop.","subject":"tram"}'
        )

        self.assertEqual(actual["identified_objects"], ["tram"])
        self.assertEqual(actual["themes"], ["commute"])
        self.assertEqual(actual["subject"], "tram")

    def test_parse_classifier_response_prefers_last_valid_json_block(self):
        actual = parse_classifier_response(
            '<|channel>thought {"identified_objects":["wrong"],"themes":[],"alt_text":"Wrong.","subject":"wrong"} <channel|> {"identified_objects":["tram"],"themes":["commute"],"alt_text":"Red tram at a stop.","subject":"tram"}'
        )

        self.assertEqual(actual["identified_objects"], ["tram"])
        self.assertEqual(actual["themes"], ["commute"])
        self.assertEqual(actual["subject"], "tram")

    def test_parse_classifier_response_coerces_bad_but_valid_json(self):
        # Valid JSON with wrong types must be coerced, never crash a later batch
        # insert: null lists → [], non-coercible list members dropped, numeric
        # alt_text stringified, null subject → "".
        actual = parse_classifier_response(
            '{"identified_objects": null, "themes": ["a", 2, ["nested"], null], '
            '"alt_text": 123, "subject": null}'
        )
        self.assertEqual(actual["identified_objects"], [])
        self.assertEqual(actual["themes"], ["a", "2"])
        self.assertEqual(actual["alt_text"], "123")
        self.assertEqual(actual["subject"], "")

    def test_parse_classifier_response_missing_key_is_malformed(self):
        # A JSON block missing a required key raises so the caller can retry the
        # model, rather than silently producing an empty caption.
        with self.assertRaises(KeyError):
            parse_classifier_response('{"identified_objects": ["x"]}')

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
        geocode = extract_geocode_from_path(path)
        raw = classifier.predict(path=path, geocode=geocode)
        precomputed_caption = parse_caption_with_retry(classifier, path, geocode, raw)
        input_tuple = (idx, path, True, precomputed_caption, None, None)

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
        with mock.patch("index.log") as mock_log:
            with heartbeat("test op", interval_s=0.05):
                time.sleep(0.18)
        messages = [call.args[0] for call in mock_log.call_args_list]
        self.assertGreaterEqual(len(messages), 2)
        self.assertTrue(all("still running" in m for m in messages))

    def test_heartbeat_silent_when_fast(self):
        with mock.patch("index.log") as mock_log:
            with heartbeat("test op", interval_s=10.0):
                pass
        self.assertEqual(mock_log.call_args_list, [])

    def test_log_vram_is_noop_without_cuda(self):
        with mock.patch("index.torch.cuda.is_available", return_value=False):
            with mock.patch("index.log") as mock_log:
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

    def test_parse_caption_with_retry_gives_up_returns_empty(self):
        class StubClassifier:
            def predict(self, path, geocode):
                return "{bad}"

        result = parse_caption_with_retry(
            StubClassifier(), "p.jpg", {}, "{bad}", max_attempts=3
        )
        self.assertEqual(result, {})

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
        self.assertEqual(analysed["subject"], "monkey")
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
        with mock.patch("index.analyse_image", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                analyse_image_worker(
                    (0, "../src/test/fixtures/monkey.jpg", True, None, None, None)
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
            result = runner.invoke(
                index,
                f"--glob {glob} --dbpath {dbpath} --dry-run --model-profile siglip2".split(),
            )
            self.assertEqual(0, result.exit_code)
            self.assertTrue("Using model profile: siglip2" in result.output)
            self.assertTrue("Found 5 files" in result.output)

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

    def test_skip_index_already_exists(self):
        runner = CliRunner()
        glob = "../src/test/fixtures/*.jpg"
        dbpath = self.testexists_db
        result = runner.invoke(
            index, f"--glob {glob} --dbpath {dbpath} --dry-run".split()
        )
        self.assertEqual(0, result.exit_code)
        self.assertTrue("Found 2 files" in result.output)
        self.assertTrue("skipping 2 already-indexed)" in result.output)

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
                f"--glob ../src/test/fixtures/*.jpg --dbpath {dbpath}".split(),
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
            db.upsert_image_fields(shared, {"filename": "a.jpg", "tags": "cat, dog"})
            # Seed counts directly so the test targets delete_path's decrement
            # logic (insert_tags' own counting quirk is out of scope): cat is held
            # by one image, dog by two.
            db.con.execute(
                "INSERT INTO tags (tag, count) VALUES ('cat', 1), ('dog', 2)"
            )
            db.con.commit()

            db.delete_path(shared)

            counts = dict(db.con.execute("SELECT tag, count FROM tags").fetchall())
            # "cat" reached 0 and was removed; "dog" decremented to 1.
            self.assertEqual(counts, {"dog": 1})

    def test_insert_tags_counts_one_per_image(self):
        # Stored count must equal the number of images carrying the tag — not
        # one more. Seeding new tags at 1 then incrementing double-counted the
        # first image (the old off-by-one the frontend used to subtract back).
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "tags.sqlite"))
            db.setup_tables()

            db.insert_tags(["cat", "dog"])  # first image: cat, dog
            db.insert_tags(["cat"])  # second image: cat only
            db.con.commit()

            counts = dict(db.con.execute("SELECT tag, count FROM tags").fetchall())
            self.assertEqual(counts, {"cat": 2, "dog": 1})

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

    def test_correct_legacy_tag_counts_decrements_and_drops_orphans(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db = Sqlite3Client(os.path.join(tmpdir, "counts.sqlite"))
            db.setup_tables()
            # seed-at-1 counts: stored = images + 1; "ghost" is an orphan at 1.
            self._seed_tags(db, {"cat": 3, "dog": 2, "ghost": 1})
            db.correct_legacy_tag_counts()
            db.con.commit()
            counts = dict(db.con.execute("SELECT tag, count FROM tags").fetchall())
            self.assertEqual(counts, {"cat": 2, "dog": 1})

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
            # Every count -1, orphan dropped, comma-bearing tag preserved intact.
            expected = {"Japan": 1, "JP": 1, "Singapore": 1, "nature, relaxation": 2}
            self.assertEqual(self._read_counts(dbpath), expected)

            # Re-running must not decrement again (geo_* now populated → skip).
            again = CliRunner().invoke(cli, ["backfill", "--dbpath", dbpath])
            self.assertEqual(again.exit_code, 0, again.output)
            self.assertEqual(self._read_counts(dbpath), expected)

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


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    unittest.main()
