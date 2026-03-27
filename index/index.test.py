from index import (
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    JanusClassifier,
    Sqlite3Client,
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
            self.assertGreater(len(analysed.get("critique")), 0)
            self.assertGreater(len(analysed.get("suggested_title")), 0)
            self.assertGreater(len(analysed.get("composition_critique")), 0)
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


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    unittest.main()
