import json
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError

from weather import VARIABLES, enrich_database, sample_hour

NOW = datetime(2026, 10, 12, tzinfo=UTC)


def response():
    values = {variable: [0, 1] for variable in VARIABLES}
    values["temperature_2m"] = [27, 28]
    return {
        "latitude": 1.25,
        "longitude": 103.75,
        "hourly": dict(time=["2024-01-01T23:00", "2024-01-02T00:00"], **values),
    }


class WeatherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "test.sqlite")
        with sqlite3.connect(self.db) as c:
            c.execute(
                "CREATE TABLE metadata(path TEXT PRIMARY KEY, lat_deg REAL, lng_deg REAL, iso8601 TEXT, tz_offset TEXT, media_kind TEXT)"
            )
            c.executemany(
                "INSERT INTO metadata VALUES (?,?,?,?,?,?)",
                [
                    ("one.jpg", 1.3, 103.8, "2024-01-02T07:45:00", "+08:00", "photo"),
                    ("two.jpg", 1.3, 103.8, "2024-01-02T08:15:00", "+08:00", "photo"),
                ],
            )

    def run_enrichment(self, fetch):
        return enrich_database(
            self.db, interval=0, fetch=fetch, now=NOW, log=lambda _: None
        )

    def test_derived_zone_matches_correct_utc_day_and_hour(self):
        self.assertEqual(
            sample_hour("2024-01-02T07:45:00", "+08:00"),
            datetime(2024, 1, 1, 23, tzinfo=UTC),
        )
        self.assertIsNone(sample_hour("2024-01-02T07:45:00", None))
        self.assertIsNone(sample_hour("bad", "+08:00"))

    def test_caches_by_location_and_utc_day_and_resumes_without_requests(self):
        fetch = mock.Mock(return_value=response())
        report = self.run_enrichment(fetch)
        self.assertEqual(report["updated"], 2)
        self.assertEqual(fetch.call_count, 2)  # The local day crosses midnight UTC.
        self.assertEqual(self.run_enrichment(fetch)["existing"], 2)
        self.assertEqual(fetch.call_count, 2)
        with sqlite3.connect(self.db) as c:
            payloads = [
                json.loads(r[0])
                for r in c.execute("SELECT weather_json FROM metadata ORDER BY path")
            ]
        self.assertEqual([p["temperature_2m"] for p in payloads], [27, 28])

    def test_same_day_photos_share_one_response(self):
        with sqlite3.connect(self.db) as c:
            c.execute(
                "UPDATE metadata SET iso8601='2024-01-02T07:15:00' WHERE path='two.jpg'"
            )
        fetch = mock.Mock(return_value=response())
        self.assertEqual(self.run_enrichment(fetch)["updated"], 2)
        self.assertEqual(fetch.call_count, 1)

    def test_failure_is_non_fatal_and_retries_next_run(self):
        fetch = mock.Mock(side_effect=OSError("offline"))
        self.assertEqual(self.run_enrichment(fetch)["failed"], 2)
        self.assertEqual(
            self.run_enrichment(mock.Mock(return_value=response()))["updated"], 2
        )

    def test_rate_refusal_stops_the_run(self):
        fetch = mock.Mock(side_effect=HTTPError("url", 429, "rate limit", {}, None))
        self.assertEqual(self.run_enrichment(fetch)["failed"], 1)
        self.assertEqual(fetch.call_count, 1)

    def test_location_change_clears_stale_weather_if_fetch_fails(self):
        self.run_enrichment(mock.Mock(return_value=response()))
        with sqlite3.connect(self.db) as c:
            c.execute("UPDATE metadata SET lat_deg=2 WHERE path='one.jpg'")
        self.run_enrichment(mock.Mock(side_effect=OSError("offline")))
        with sqlite3.connect(self.db) as c:
            rows = dict(c.execute("SELECT path, weather_json FROM metadata"))
        self.assertIsNone(rows["one.jpg"])
        self.assertIsNotNone(rows["two.jpg"])

    def test_missing_hour_is_not_persisted_as_success(self):
        fetch = mock.Mock(return_value={"hourly": {"time": []}})
        self.assertEqual(self.run_enrichment(fetch)["updated"], 0)
        self.assertEqual(
            self.run_enrichment(mock.Mock(return_value=response()))["updated"], 2
        )

    def test_malformed_hourly_values_remain_pending(self):
        malformed = response()
        malformed["hourly"]["temperature_2m"] = None
        self.assertEqual(
            self.run_enrichment(mock.Mock(return_value=malformed))["updated"], 0
        )
        self.assertEqual(
            self.run_enrichment(mock.Mock(return_value=response()))["updated"], 2
        )

    def test_hourly_budget_survives_separate_runs(self):
        self.run_enrichment(mock.Mock(side_effect=OSError("offline")))
        with sqlite3.connect(self.db) as c:
            import time

            c.executemany(
                "INSERT INTO weather_requests VALUES (?)", [(time.time(),)] * 4500
            )
        fetch = mock.Mock(return_value=response())
        self.assertEqual(self.run_enrichment(fetch)["requests"], 0)
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
