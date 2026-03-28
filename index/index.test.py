from index import (
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    build_janus_prompt,
    filter_exif_for_search,
    parse_janus_response,
    JanusClassifier,
    Sqlite3Client,
    cli,
    index,
    search,
    search_similar_path,
    search_tags,
)
import os
import tempfile
import unittest
from click.testing import CliRunner
import torch
import json


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

    def test_parse_janus_response_falls_back_to_plain_text(self):
        actual = parse_janus_response(
            "The photo depicts a serene sky with a bird in flight and a flock of birds."
        )

        self.assertEqual(actual["alt_text"], "The photo depicts a serene sky with a bird in flight and a flock of birds.")
        self.assertTrue("serene" in actual["identified_objects"])
        self.assertTrue("bird" in actual["identified_objects"])
        self.assertEqual(actual["themes"], [])

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

    def test_analyse_image_worker(self):
        if torch.cuda.is_available():
            classifier = JanusClassifier()
            classifier.init_model()
            idx = 0
            path = "../src/test/fixtures/monkey.jpg"
            input_tuple = (idx, path, classifier)

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


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    unittest.main()
