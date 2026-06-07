from index import (
    acquire_single_instance_lock,
    analyse_image,
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    build_classifier_prompt,
    build_janus_prompt,
    compare_caption_payloads,
    create_classifier,
    extract_geocode_from_path,
    filter_exif_for_search,
    heartbeat,
    log_vram,
    log_vram_peak,
    parse_caption_with_retry,
    run_embedding_pass,
    Gemma4Classifier,
    Gemma4GgufClassifier,
    JanusClassifier,
    parse_classifier_response,
    parse_janus_response,
    sample_balanced_paths,
    Sqlite3Client,
    cli,
    index,
    search,
    search_similar_path,
    search_tags,
)
import os
import tempfile
import time
import unittest
import click
from click.testing import CliRunner
import torch
import json
from unittest import mock


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

    def test_analyse_image_worker(self):
        if torch.cuda.is_available():
            classifier = JanusClassifier()
            try:
                classifier.init_model()
            except Exception as err:
                self.skipTest(
                    f"Skipping Janus CUDA integration test because Janus is not compatible with the current transformers runtime: {err}"
                )
            idx = 0
            path = "../src/test/fixtures/monkey.jpg"
            # Mirror the production Janus pass: predict + parse while the model is
            # loaded, then assemble from the precomputed result (no live model).
            geocode = extract_geocode_from_path(path)
            raw = classifier.predict(path=path, geocode=geocode)
            precomputed_caption = parse_caption_with_retry(
                classifier, path, geocode, raw
            )
            input_tuple = (idx, path, True, precomputed_caption, None, None)

            actual = analyse_image_worker(input_tuple)
            analysed = actual.get("analysed")

            self.assertGreater(len(analysed.get("tags")), 0)
            self.assertGreater(len(analysed.get("alt_text")), 0)
            self.assertGreater(len(analysed.get("subject")), 0)
            self.assertGreater(len(analysed.get("geocode").get("city")), 0)
            self.assertEqual(isinstance(analysed.get("exif"), dict), True)
            self.assertGreater(len(analysed.get("datetime")), 0)
            self.assertEqual(len(analysed.get("colors")), 9)
            self.assertEqual(analysed.get("lat_deg"), 1.3714833333333334)
            self.assertEqual(analysed.get("lng_deg"), 103.7822)
        else:
            print("Skipping test_analyse_image_worker as CUDA is not available")

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
        with mock.patch("index.torch.cuda.is_available", return_value=True), mock.patch(
            "index.torch.cuda.memory_allocated", return_value=2_000_000_000
        ), mock.patch(
            "index.torch.cuda.memory_reserved", return_value=3_000_000_000
        ), mock.patch(
            # free=1 GB, total=10 GB → 9 GB used card-wide
            "index.torch.cuda.mem_get_info",
            return_value=(1_000_000_000, 10_000_000_000),
        ), mock.patch(
            "index.log"
        ) as mock_log:
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


class TestCli(unittest.TestCase):
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
        dbpath = "./testexists.sqlite"
        result = runner.invoke(
            index, f"--glob {glob} --dbpath {dbpath} --dry-run".split()
        )
        self.assertEqual(0, result.exit_code)
        self.assertTrue("Found 2 files" in result.output)
        self.assertTrue("skipping 2 already-indexed)" in result.output)

    def test_search(self):
        runner = CliRunner()
        dbpath = "./testexists.sqlite"

        result = runner.invoke(search, f"--query plant --dbpath {dbpath}".split())

        self.assertEqual(0, result.exit_code)
        self.assertTrue("monkey-for-unoptimised.jpg" in result.output)
        self.assertTrue("monkey.jpg" in result.output)

    def test_search_negative(self):
        runner = CliRunner()
        dbpath = "./testexists.sqlite"

        result = runner.invoke(
            search, f"--query randomstring --dbpath {dbpath}".split()
        )

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[]" in result.output)

    def test_search_tags(self):
        runner = CliRunner()
        dbpath = "./testexists.sqlite"

        result = runner.invoke(search_tags, f"--query plant --dbpath {dbpath}".split())

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[('plant', 3)]" in result.output)

    def test_search_tags_negative(self):
        runner = CliRunner()
        dbpath = "./testexists.sqlite"

        result = runner.invoke(
            search_tags, f"--query randomstring --dbpath {dbpath}".split()
        )

        self.assertEqual(0, result.exit_code)
        self.assertTrue("[]" in result.output)


class TestDb(unittest.TestCase):
    def test_already_exists(self):
        db = Sqlite3Client("./testexists.sqlite")
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
