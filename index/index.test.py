from index import (
    find_files,
    format_mapping,
    format_mapping_values,
    analyse_image_worker,
    Classifier,
    Sqlite3Client,
    index,
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
            classifier = Classifier()
            classifier.init_model()
            idx = 0
            path = "../src/test/fixtures/monkey.jpg"
            input = (idx, path, classifier)

            actual = analyse_image_worker(input)

            self.assertEqual(
                actual.get("analysed").get("tags"),
                [
                    "Madagascar_cat",
                    "worm_fence",
                    "siamang",
                    "milk_can",
                    "spider_monkey",
                ],
            )
            self.assertEqual(len(actual.get("analysed").get("colors")), 9)
        else:
            print("Skipping test_analyse_image_worker as CUDA is not available")
            pass


class TestCli(unittest.TestCase):
    def test_skip_index_already_exists(self):
        runner = CliRunner()
        glob = "../src/test/fixtures/*.jpg"
        dbpath = "./testexists.sqlite"
        result = runner.invoke(
            index, f"--glob {glob} --dbpath {dbpath} --dry-run".split(), input="2"
        )
        self.assertEqual(0, result.exit_code)
        self.assertTrue("Found 2 files" in result.output)
        self.assertTrue("skipping 2 already-indexed)" in result.output)


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
