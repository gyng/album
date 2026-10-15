import unittest

from media_embedding import plan_segment


class SegmentTests(unittest.TestCase):
    def test_long_clip_stays_inside_shared_context(self):
        segment = plan_segment(600, 120, True)
        self.assertEqual(segment.start, 120)
        self.assertEqual(segment.duration, 60)
        self.assertEqual(segment.frames, 24)
        self.assertTrue(segment.has_audio)
        self.assertLess(segment.frames * 140 + segment.duration * 25 + 100, 8192)

    def test_short_tail_is_not_padded_past_clip(self):
        segment = plan_segment(61.25, 60)
        self.assertEqual(segment.duration, 1.25)
        self.assertEqual(segment.frames, 2)
        self.assertFalse(segment.has_audio)

    def test_invalid_boundaries_are_rejected(self):
        for duration, start in [
            (0, 0),
            (float("nan"), 0),
            (30, -1),
            (30, 30),
            (30, float("inf")),
        ]:
            with (
                self.subTest(duration=duration, start=start),
                self.assertRaises(ValueError),
            ):
                plan_segment(duration, start)


class DecoderTests(unittest.TestCase):
    def test_decodes_bounded_frames_and_mono_audio(self):
        from types import SimpleNamespace
        from unittest.mock import patch

        import numpy as np
        from media_embedding import FRAME_EDGE, decode_segment

        frames = np.zeros((2, FRAME_EDGE, FRAME_EDGE, 3), dtype=np.uint8).tobytes()
        audio = np.zeros(32000, dtype="<f4").tobytes()
        with patch(
            "media_embedding.subprocess.run",
            side_effect=[SimpleNamespace(stdout=frames), SimpleNamespace(stdout=audio)],
        ) as run:
            result = decode_segment("clip.mov", plan_segment(2, has_audio=True))
        self.assertEqual(result["videos"][0].shape[0], 2)
        self.assertEqual(result["audio"].shape[0], 32000)
        self.assertEqual(result["audio_kwargs"]["sampling_rate"], 16000)
        self.assertEqual(result["videos_kwargs"]["max_soft_tokens"], 140)
        self.assertIn("1", run.call_args_list[1].args[0])
        self.assertTrue(result["videos"][0].flags.writeable)

    def test_silent_video_does_not_invent_an_audio_track(self):
        from types import SimpleNamespace
        from unittest.mock import patch

        from media_embedding import FRAME_EDGE, decode_segment

        with patch(
            "media_embedding.subprocess.run",
            return_value=SimpleNamespace(stdout=bytes(FRAME_EDGE * FRAME_EDGE * 3)),
        ) as run:
            result = decode_segment("silent.mov", plan_segment(1))
        self.assertNotIn("audio", result)
        self.assertEqual(run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
