"""Bounded local audio/video decoding for EmbeddingGemma 2 indexing.

A minute of video uses at most 24 visual frames and 60 seconds of mono audio.
This stays within the model's shared 8,192-token context at 140 tokens/frame.
Decoding happens offline; search clients only load the text encoder.
"""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass

SEGMENT_SECONDS = 60.0
MAX_FRAMES = 24
AUDIO_RATE = 16000
FRAME_EDGE = 256


@dataclass(frozen=True)
class MediaSegment:
    start: float
    duration: float
    frames: int
    has_audio: bool


def plan_segment(
    duration: float, start: float = 0, has_audio: bool = False
) -> MediaSegment:
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Media duration must be finite and positive")
    if not math.isfinite(start) or start < 0 or start >= duration:
        raise ValueError("Media offset is outside the clip")
    length = min(SEGMENT_SECONDS, duration - start)
    return MediaSegment(
        start, length, min(MAX_FRAMES, max(1, math.ceil(length))), has_audio
    )


def probe_media(path: str) -> tuple[float, bool, bool]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            path,
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    info = json.loads(result.stdout)
    streams = info.get("streams", [])
    duration = float(info.get("format", {}).get("duration", 0))
    return (
        duration,
        any(s.get("codec_type") == "audio" for s in streams),
        any(s.get("codec_type") == "video" for s in streams),
    )


def decode_segment(path: str, segment: MediaSegment, *, has_video: bool = True):
    import numpy as np

    common = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-ss",
        str(segment.start),
        "-i",
        path,
        "-t",
        str(segment.duration),
    ]
    inputs = {}
    if has_video:
        frames = subprocess.run(
            common
            + [
                "-an",
                "-vf",
                f"fps={segment.frames / segment.duration},scale={FRAME_EDGE}:{FRAME_EDGE}:force_original_aspect_ratio=decrease,pad={FRAME_EDGE}:{FRAME_EDGE}:(ow-iw)/2:(oh-ih)/2",
                "-frames:v",
                str(segment.frames),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=180,
        ).stdout
        frames = np.frombuffer(frames, dtype=np.uint8)
        if not frames.size:
            raise ValueError("Video decoder produced no frames")
        inputs["videos"] = [frames.reshape(-1, FRAME_EDGE, FRAME_EDGE, 3).copy()]
        inputs["videos_kwargs"] = {
            "do_sample_frames": False,
            "add_timestamps": False,
            "max_soft_tokens": 140,
        }
    if segment.has_audio:
        samples = subprocess.run(
            common
            + ["-vn", "-ac", "1", "-ar", str(AUDIO_RATE), "-f", "f32le", "pipe:1"],
            check=True,
            capture_output=True,
            timeout=180,
        ).stdout
        audio = np.frombuffer(samples, dtype="<f4").copy()
        if not audio.size or not np.isfinite(audio).all():
            raise ValueError("Audio decoder produced empty or invalid samples")
        inputs["audio"] = audio
        inputs["audio_kwargs"] = {"sampling_rate": AUDIO_RATE, "truncation": False}
    return inputs


MODEL_ID = "google/embeddinggemma-2"
MODEL_REVISION = "914f7f89142e33e77833254d9c9b90c3cef7303b"
PIPELINE_VERSION = (
    f"multimodal-embedding-v1:{MODEL_ID}@{MODEL_REVISION}:frames24:seconds60:audio16k"
)


class Gemma2Embedder:
    MODEL_ID = MODEL_ID
    MODEL_REVISION = MODEL_REVISION

    def __init__(self, pixel_source=None):
        self.model_id = self.MODEL_ID
        self.pixel_source = pixel_source or (lambda path: path)

    def init_model(self):
        import os

        import torch
        from transformers import AutoModel, AutoProcessor

        torch.set_num_threads(4)
        location = os.environ.get("EMBEDDINGGEMMA_MODEL_PATH", self.MODEL_ID)
        options = {} if location != self.MODEL_ID else {"revision": self.MODEL_REVISION}
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = (
            torch.bfloat16
            if self.device == "cuda" and torch.cuda.is_bf16_supported()
            else torch.float32
        )
        self.processor = AutoProcessor.from_pretrained(location, **options)
        self.model = (
            AutoModel.from_pretrained(
                location,
                dtype=dtype,
                attn_implementation={"": "sdpa", "audio_config": "eager"},
                **options,
            )
            .to(self.device)
            .eval()
        )

    def encode(self, **kwargs):
        import torch

        inputs = self.processor(padding=True, return_tensors="pt", **kwargs).to(
            self.device
        )
        if inputs["input_ids"].shape[-1] > 8192:
            raise ValueError("Media input exceeds the embedding context")
        with torch.inference_mode():
            output = self.model(**inputs).last_hidden_state.float()
            mask = inputs["attention_mask"].unsqueeze(-1)
            vector = (output * mask).sum(1) / mask.sum(1)
            vector = torch.nn.functional.normalize(vector, p=2, dim=-1)
        if not torch.isfinite(vector).all() or (vector.norm(dim=-1) == 0).any():
            raise ValueError("Embedding model produced invalid vectors")
        return vector.cpu().tolist()

    def predict_image_embedding(self, path):
        return self.predict_image_embeddings_batch([path])[0]

    def predict_image_embeddings_batch(self, paths):
        # Imported late so model-free planner tests need no inference packages.
        import re
        from pathlib import Path

        from PIL import Image, ImageOps

        results = [None] * len(paths)
        photos = []
        for i, path in enumerate(paths):
            try:
                match = re.search(r"@t(\d+(?:\.\d+)?)$", path)
                clip = path[: match.start()] if match else path
                offset = float(match[1]) if match else 0
                if Path(clip).suffix.lower() in {
                    ".mp4",
                    ".mov",
                    ".m4v",
                    ".webm",
                    ".mkv",
                    ".avi",
                }:
                    duration, has_audio, has_video = probe_media(clip)
                    segment = plan_segment(duration, offset or 0, has_audio)
                    results[i] = self.encode(
                        **decode_segment(clip, segment, has_video=has_video)
                    )[0]
                else:
                    # Remote YouTube entries have no local clip: only their cached
                    # poster is available. No network media is downloaded here.
                    with Image.open(self.pixel_source(path)) as image:
                        photos.append(
                            (i, ImageOps.exif_transpose(image).convert("RGB"))
                        )
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                import logging

                logging.getLogger(__name__).warning(
                    "Skipping unreadable media %s: %s", path, error
                )
        if photos:
            vectors = self.encode(images=[[image] for _, image in photos])
            for (i, _), vector in zip(photos, vectors, strict=True):
                results[i] = vector
        return results

    def release(self):
        import gc

        import torch

        self.model = self.processor = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
