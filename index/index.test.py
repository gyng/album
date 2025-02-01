from index import (
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    JanusClassifier,
    Sqlite3Client,
    index,
    search,
    search_tags,
)
import os
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
            input = (idx, path, classifier)

            actual = analyse_image_worker(input)
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
            pass


class TestCli(unittest.TestCase):
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


if __name__ == "__main__":
    print(f"cwd:\t{os.getcwd()}")
    unittest.main()
