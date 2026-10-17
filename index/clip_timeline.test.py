import json
import sqlite3
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from clip_timeline import (
    TIMELINE_STAGE,
    build_timeline,
    completion_text,
    enrich_database,
    plan_windows,
    timeline_text,
    transcripts_agree,
    window_asker,
)

SPEECH = (
    "KDE is an international free software community that develops free and"
    " open source software."
)


class PlanWindowsTests(unittest.TestCase):
    def test_a_short_clip_is_one_window(self):
        self.assertEqual(plan_windows(7.2), [(0.0, 7.2)])

    def test_a_longer_clip_is_cut_into_fifteen_second_windows(self):
        self.assertEqual(plan_windows(40), [(0.0, 15.0), (15.0, 30.0), (30.0, 40.0)])

    # A sixteen-second clip was cut into fifteen seconds and one, and the
    # second window described the first again. A short tail joins the window
    # before it.
    def test_a_short_tail_joins_the_window_before_it(self):
        self.assertEqual(plan_windows(16.016), [(0.0, 16.016)])
        self.assertEqual(plan_windows(34), [(0.0, 15.0), (15.0, 34.0)])

    def test_a_very_long_clip_stretches_its_windows_to_stay_under_the_cap(self):
        windows = plan_windows(3600, max_windows=120)
        self.assertEqual(len(windows), 120)
        self.assertEqual(windows[1][0], 30.0)

    def test_nothing_to_plan_without_a_duration(self):
        self.assertEqual(plan_windows(0), [])


class AgreementTests(unittest.TestCase):
    # Measured on Gemma 4 E4B: two phrasings of the request transcribe real
    # speech near-identically, differing only in case and punctuation...
    def test_two_readings_of_real_speech_agree(self):
        self.assertTrue(
            transcripts_agree(
                SPEECH,
                "kde is an international free software community that develops free"
                " and open-source software",
            )
        )

    # ...and invent something different each time over silence.
    def test_two_inventions_over_silence_disagree(self):
        self.assertFalse(
            transcripts_agree(
                "Oi, meu nome é Ana Paula e eu moro em São Paulo.",
                "Oi, I have a meeting at the library.",
            )
        )
        self.assertFalse(transcripts_agree("The audio is silent.", "[music]"))

    # A short phrase both requests land on by chance is not evidence of speech:
    # the model said "Hello." over three different silent clips.
    def test_a_short_agreement_is_not_enough(self):
        self.assertFalse(transcripts_agree("Hello.", "Hello."))

    def test_empty_readings_never_agree(self):
        self.assertFalse(transcripts_agree("", ""))


class CompletionTextTests(unittest.TestCase):
    # Asked to transcribe a silent window, the model may say nothing at all.
    # That is an answer, not a failure: it failed a whole clip once.
    def test_an_empty_reply_is_an_empty_answer(self):
        self.assertEqual(
            completion_text({"choices": [{"message": {"content": ""}}]}), ""
        )
        self.assertEqual(completion_text({"choices": [{"message": {}}]}), "")

    def test_reads_the_reply(self):
        self.assertEqual(
            completion_text({"choices": [{"message": {"content": " Hello there. "}}]}),
            "Hello there.",
        )

    # Thinking mode spends the whole budget and returns nothing; that is a
    # misconfigured request, and saying nothing about it would hide it.
    def test_a_reply_that_only_reasoned_is_an_error(self):
        with self.assertRaises(RuntimeError):
            completion_text(
                {"choices": [{"message": {"content": "", "reasoning_content": "Hmm"}}]}
            )


class WindowAskerTests(unittest.TestCase):
    # A reply the model fumbles now and then (measured: a reasoning-only reply
    # on one clip, in one run of three) must cost a retry, not the clip.
    def test_a_fumbled_reply_is_retried_once_then_given_up_quietly(self):
        replies = iter([RuntimeError("reasoning only"), '{"description": "A bus."}'])

        def complete(_content, _schema):
            reply = next(replies)
            if isinstance(reply, Exception):
                raise reply
            return reply

        ask = window_asker("clip.mov", complete)
        with unittest.mock.patch("clip_timeline._cut_frames", return_value=[]):
            self.assertEqual(ask("description", (0.0, 15.0), 0), "A bus.")

        def always_fails(_content, _schema):
            raise RuntimeError("reasoning only")

        ask = window_asker("clip.mov", always_fails)
        with unittest.mock.patch("clip_timeline._cut_audio", return_value=[]):
            self.assertEqual(ask("speech", (0.0, 15.0), 0), "")


class FakeModel:
    """Answers like Gemma did: consistent on speech, inventive on silence."""

    def __init__(self, speech_windows):
        self.speech_windows = speech_windows
        self.calls = []

    def __call__(self, kind, window, variant):
        start = window[0]
        self.calls.append((kind, start, variant))
        if kind == "description":
            return f"Traffic passes a lit crossing at {start:.0f}s."
        if start in self.speech_windows:
            return SPEECH if variant == 0 else SPEECH.lower().replace(".", "")
        return ["Oi, meu nome é Ana Paula.", "I'm going on a road trip."][variant]


class BuildTimelineTests(unittest.TestCase):
    def test_describes_every_window_and_keeps_only_agreed_speech(self):
        model = FakeModel(speech_windows={15.0})
        timeline = build_timeline(40, model)

        self.assertEqual(
            [(segment["start"], segment["end"]) for segment in timeline],
            [(0.0, 15.0), (15.0, 30.0), (30.0, 40.0)],
        )
        self.assertTrue(all(segment["description"] for segment in timeline))
        self.assertEqual(
            [segment.get("speech") for segment in timeline], [None, SPEECH, None]
        )

    def test_timeline_text_is_what_search_reads(self):
        text = timeline_text(
            [
                {"start": 0.0, "end": 15.0, "description": "A crossing at night."},
                {"start": 15.0, "end": 30.0, "description": "A bus.", "speech": SPEECH},
            ]
        )
        self.assertIn("A crossing at night.", text)
        self.assertIn(SPEECH, text)


class EnrichDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.clip = root / "clip.mov"
        self.clip.write_bytes(b"clip bytes")
        self.db = str(root / "test.sqlite")
        with sqlite3.connect(self.db) as c:
            c.execute(
                "CREATE VIRTUAL TABLE images USING fts5(path, alt_text, timeline)"
            )
            c.execute(
                "CREATE TABLE metadata(path TEXT PRIMARY KEY, media_kind TEXT,"
                " duration_seconds REAL, scene_of TEXT, timeline_json TEXT)"
            )
            c.execute(
                "CREATE TABLE pipeline_state(path TEXT, stage TEXT, source_sha256 TEXT,"
                " pipeline_version TEXT, model_id TEXT, completed_at TEXT NOT NULL,"
                " PRIMARY KEY (path, stage))"
            )
            for path, kind, duration, scene_of in [
                (str(self.clip), "video", 20.0, None),
                (f"{self.clip}@t60", "video", 20.0, str(self.clip)),
                (str(root / "photo.jpg"), "photo", None, None),
            ]:
                c.execute("INSERT INTO images(path, alt_text) VALUES (?, '')", (path,))
                c.execute(
                    "INSERT INTO metadata(path, media_kind, duration_seconds, scene_of)"
                    " VALUES (?,?,?,?)",
                    (path, kind, duration, scene_of),
                )

    def run_enrich(self, model):
        return enrich_database(self.db, lambda path: model, log=lambda _: None)

    def test_writes_a_clips_timeline_and_its_searchable_text(self):
        report = self.run_enrich(FakeModel(speech_windows={0.0}))

        with sqlite3.connect(self.db) as c:
            stored = json.loads(
                c.execute(
                    "SELECT timeline_json FROM metadata WHERE path = ?",
                    (str(self.clip),),
                ).fetchone()[0]
            )
            found = c.execute(
                "SELECT path FROM images WHERE images MATCH ?",
                ('"international free software"',),
            ).fetchall()
        self.assertEqual(stored[0]["speech"], SPEECH)
        self.assertEqual(found, [(str(self.clip),)])
        self.assertEqual(report["updated"], 1)

    # A clip's moments and the photographs are not clips to be described.
    def test_leaves_scene_rows_and_photos_alone(self):
        model = FakeModel(speech_windows=set())
        self.run_enrich(model)

        with sqlite3.connect(self.db) as c:
            rows = dict(c.execute("SELECT path, timeline_json FROM metadata"))
        self.assertIsNone(rows[f"{self.clip}@t60"])
        self.assertIsNone(rows[str(Path(self.tmp.name) / "photo.jpg")])

    # Provenance: an unchanged clip is not described again, a changed one is.
    def test_skips_a_clip_already_described_and_redoes_a_changed_one(self):
        self.run_enrich(FakeModel(speech_windows=set()))
        again = FakeModel(speech_windows=set())
        self.assertEqual(self.run_enrich(again)["existing"], 1)
        self.assertEqual(again.calls, [])

        self.clip.write_bytes(b"re-exported clip bytes")
        changed = FakeModel(speech_windows=set())
        self.assertEqual(self.run_enrich(changed)["updated"], 1)
        with sqlite3.connect(self.db) as c:
            stage = c.execute(
                "SELECT stage FROM pipeline_state WHERE path = ?", (str(self.clip),)
            ).fetchone()
        self.assertEqual(stage, (TIMELINE_STAGE,))

    # One clip that cannot be read must not take the run down.
    def test_a_clip_that_fails_is_reported_and_the_run_goes_on(self):
        def failing(_kind, _window, _variant):
            raise RuntimeError("llama-server went away")

        report = self.run_enrich(failing)
        self.assertEqual(report["failed"], 1)


if __name__ == "__main__":
    unittest.main()
