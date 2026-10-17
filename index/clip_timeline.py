"""A clip's timeline: what happens in it, and what is said, moment by moment.

A clip is captioned like a photograph — from its poster frame — which says
nothing of what happens after that frame or of anything said. This pass cuts
each local clip into windows (15 seconds, stretched so a long clip stays under a
cap) and asks the captioner, Gemma 4 E4B through llama-server, for each window:

- a description, from two frames of the window;
- the speech, from the window's own 16 kHz audio.

Each segment keeps the window it came from, so the album page can link a line
to the second it starts at (`?t=`), and its text goes into the search index.

**Speech is believed only when two readings agree.** Measured on this model:
asked to "return nothing if there is no speech", it returned nothing for real,
continuous narration; asked plainly, it transcribed narration almost word for
word — and over a silent clip invented a Portuguese monologue about a dog called
Rex. Two differently phrased requests give near-identical text for real speech
and unrelated inventions for silence, so a window's speech is kept only when
the two agree (`transcripts_agree`). A short phrase both land on by chance
("Hello.") is not enough. Losing a word of real speech is the cheaper mistake:
a transcript is published as something somebody said.

The model call is injected (`ask(kind, window, variant)`), so everything here
is tested without a model; `window_asker` adapts a llama-server completion
function to it. Like weather enrichment, the pass is its own command with its
own provenance (`TIMELINE_STAGE`, pinned to the clip's bytes), so re-running it
never re-captions or re-embeds anything.
"""

import difflib
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import typing
from base64 import b64encode
from datetime import UTC, datetime
from pathlib import Path

TIMELINE_STAGE = "timeline"
WINDOW_SECONDS = 15.0
MAX_WINDOWS = 240
AUDIO_RATE = 16000
FRAME_EDGE = 768

DESCRIPTION_PROMPT = (
    "These are two moments from a {length:.0f}-second stretch of a video, {start:.0f}"
    ' seconds in. Return strict JSON only: {{"description": string}} — one factual'
    " sentence of at most 30 words about what is shown and what happens. Never mention"
    " frames, images, stills or a time-lapse."
)
SPEECH_PROMPT = "Transcribe the speech in this audio verbatim."
# Speech needs this much text before an agreement means anything.
MIN_SPEECH_WORDS = 3
MIN_SPEECH_CHARACTERS = 6
AGREEMENT = 0.8
TIMELINE_PIPELINE_VERSION = (
    "timeline-v1:"
    + hashlib.sha256(
        f"{WINDOW_SECONDS}:{MAX_WINDOWS}:tail-third:agree{AGREEMENT}:{DESCRIPTION_PROMPT}:{SPEECH_PROMPT}".encode()
    ).hexdigest()[:12]
)


Window = tuple[float, float]
Ask = typing.Callable[[str, Window, int], str]


def plan_windows(
    duration: float, window: float = WINDOW_SECONDS, max_windows: int = MAX_WINDOWS
) -> list[Window]:
    """Fixed windows over the clip; a clip too long for the cap stretches them."""
    if not duration or duration <= 0:
        return []
    width = max(window, duration / max_windows)
    windows = []
    start = 0.0
    while start < duration - 1e-6:
        end = min(duration, start + width)
        # A tail shorter than a third of a window has too little in it to
        # describe on its own, so the window before it runs to the end.
        if duration - end < width / 3:
            end = duration
        windows.append((round(start, 3), round(end, 3)))
        start = end
    return windows


_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")


def _tokens(text: str) -> list[str]:
    words = re.findall(r"\w+", (text or "").lower())
    # Japanese and Chinese are not written with spaces, so their characters are
    # the units being compared.
    if any(_CJK.search(word) for word in words):
        return [character for word in words for character in word]
    return words


def transcripts_agree(first: str, second: str) -> bool:
    """Whether two independent readings of a window heard the same speech."""
    a, b = _tokens(first), _tokens(second)
    cjk = any(_CJK.search(token) for token in a + b)
    minimum = MIN_SPEECH_CHARACTERS if cjk else MIN_SPEECH_WORDS
    if len(a) < minimum or len(b) < minimum:
        return False
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio() >= AGREEMENT


def build_timeline(duration: float, ask: Ask) -> list[dict]:
    timeline = []
    for window in plan_windows(duration):
        segment: dict[str, typing.Any] = {
            "start": window[0],
            "end": window[1],
            "description": ask("description", window, 0).strip(),
        }
        first = ask("speech", window, 0).strip()
        second = ask("speech", window, 1).strip()
        if transcripts_agree(first, second):
            segment["speech"] = first
        timeline.append(segment)
    return timeline


def timeline_text(timeline: list[dict]) -> str:
    """The searchable text of a timeline: every description and every line said."""
    parts = []
    for segment in timeline:
        if segment.get("description"):
            parts.append(segment["description"])
        if segment.get("speech"):
            parts.append(segment["speech"])
    return "\n".join(parts)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}


def completion_text(payload: typing.Mapping[str, typing.Any]) -> str:
    """The text of a llama-server chat reply, which may rightly be empty.

    Unlike a caption, an empty transcript is an answer: nothing was said. A reply
    that only reasoned is still an error — the request left thinking on."""
    message = ((payload.get("choices") or [{}])[0]).get("message") or {}
    content = (message.get("content") or "").strip()
    if not content and message.get("reasoning_content"):
        raise RuntimeError(
            "llama-server returned only reasoning_content; thinking must be off."
        )
    return content


def enrich_database(
    dbpath: str,
    ask_for_clip: typing.Callable[[str], Ask],
    log: typing.Callable[[str], None] = print,
    version: str = TIMELINE_PIPELINE_VERSION,
    force: bool = False,
) -> dict[str, int]:
    """Write a timeline for every local clip that needs one.

    `ask_for_clip(path)` returns the model call for that clip's windows."""
    con = sqlite3.connect(dbpath, timeout=30)
    try:
        metadata_columns = _columns(con, "metadata")
        if "timeline_json" not in metadata_columns:
            con.execute("ALTER TABLE metadata ADD COLUMN timeline_json TEXT")
        searchable = "timeline" in _columns(con, "images")
        if not searchable:
            log(
                "The search table has no timeline column yet; run setup first to make timelines searchable."
            )
        not_scene = " AND scene_of IS NULL" if "scene_of" in metadata_columns else ""
        rows = con.execute(
            "SELECT path, duration_seconds, timeline_json FROM metadata"
            f" WHERE media_kind = 'video'{not_scene} ORDER BY path"
        ).fetchall()
        states = {
            row[0]: (row[1], row[2])
            for row in con.execute(
                "SELECT path, source_sha256, pipeline_version FROM pipeline_state WHERE stage = ?",
                (TIMELINE_STAGE,),
            )
        }
        report = {"updated": 0, "existing": 0, "skipped": 0, "failed": 0}
        for path, duration, existing in rows:
            # An external has no file to listen to, and a clip without a length
            # has nothing to cut into windows.
            if not os.path.isfile(path) or not duration:
                report["skipped"] += 1
                continue
            digest = _sha256(path)
            if (
                not force
                and existing is not None
                and states.get(path) == (digest, version)
            ):
                report["existing"] += 1
                continue
            try:
                timeline = build_timeline(duration, ask_for_clip(path))
            # One clip must not take the run down: ffmpeg failing on it, the
            # server dropping a request, or a reply that will not parse.
            except (
                OSError,
                RuntimeError,
                ValueError,
                subprocess.CalledProcessError,
            ) as err:
                log(f"Could not build a timeline for {path}: {err}")
                report["failed"] += 1
                continue
            con.execute(
                "UPDATE metadata SET timeline_json = ? WHERE path = ?",
                (json.dumps(timeline, ensure_ascii=False), path),
            )
            if searchable:
                con.execute(
                    "UPDATE images SET timeline = ? WHERE path = ?",
                    (timeline_text(timeline), path),
                )
            con.execute(
                "INSERT INTO pipeline_state(path, stage, source_sha256, pipeline_version, completed_at)"
                " VALUES (?, ?, ?, ?, ?) ON CONFLICT(path, stage) DO UPDATE SET"
                " source_sha256 = excluded.source_sha256, pipeline_version = excluded.pipeline_version,"
                " completed_at = excluded.completed_at",
                (path, TIMELINE_STAGE, digest, version, datetime.now(UTC).isoformat()),
            )
            con.commit()
            spoken = sum(1 for segment in timeline if segment.get("speech"))
            log(f"Timeline for {path}: {len(timeline)} window(s), {spoken} with speech")
            report["updated"] += 1
        return report
    finally:
        con.close()


def _cut_frames(clip_path: str, window: Window, directory: Path) -> list[dict]:
    """Two frames of the window, a quarter and three quarters through it."""
    start, end = window
    parts = []
    for index, at in enumerate(
        (start + (end - start) * 0.25, start + (end - start) * 0.75)
    ):
        target = directory / f"{start:.3f}-{index}.jpg"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-ss",
                f"{at:.3f}",
                "-i",
                clip_path,
                "-frames:v",
                "1",
                "-vf",
                f"scale='min({FRAME_EDGE},iw)':-2",
                "-q:v",
                "3",
                str(target),
            ],
            check=True,
        )
        parts.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64,"
                    + b64encode(target.read_bytes()).decode()
                },
            }
        )
    return parts


def _cut_audio(clip_path: str, window: Window, directory: Path) -> list[dict]:
    """The window's own soundtrack, mono at 16 kHz."""
    start, end = window
    target = directory / f"{start:.3f}.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{end - start:.3f}",
            "-i",
            clip_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(AUDIO_RATE),
            str(target),
        ],
        check=True,
    )
    return [
        {
            "type": "input_audio",
            "input_audio": {
                "data": b64encode(target.read_bytes()).decode(),
                "format": "wav",
            },
        }
    ]


DESCRIPTION_SCHEMA = {
    "type": "object",
    "properties": {"description": {"type": "string"}},
    "required": ["description"],
    "additionalProperties": False,
}


def window_asker(
    clip_path: str,
    complete: typing.Callable[[list[dict], dict | None], str],
    workdir: str | None = None,
) -> Ask:
    """Adapt a llama-server completion function to `ask` for one clip.

    `complete(content, schema)` posts one chat request and returns its text. A
    window's frames and audio are cut from the clip with ffmpeg as they are
    asked for, and each is cut once.

    The model fumbles a reply now and then — measured, a reasoning-only reply
    on one clip in one run of three, with thinking off and the same request
    answering normally on its own — so an unusable reply is asked once more,
    and then given up: the window has no description, and a speech reading that
    never came is a reading of nothing, which the agreement gate turns away."""
    directory = Path(workdir or tempfile.mkdtemp(prefix="clip-timeline-"))
    cut: dict[tuple[str, Window], list[dict]] = {}

    def parts(kind: str, window: Window) -> list[dict]:
        if (kind, window) not in cut:
            cutter = _cut_frames if kind == "frames" else _cut_audio
            cut[(kind, window)] = cutter(clip_path, window, directory)
        return cut[(kind, window)]

    def attempt(read: typing.Callable[[], str]) -> str:
        for _ in range(2):
            try:
                answer = read()
            except (RuntimeError, ValueError):
                continue
            if answer:
                return answer
        return ""

    def describe(window: Window) -> str:
        prompt = DESCRIPTION_PROMPT.format(
            length=window[1] - window[0], start=window[0]
        )
        text = complete(
            [*parts("frames", window), {"type": "text", "text": prompt}],
            DESCRIPTION_SCHEMA,
        )
        return str(json.loads(text).get("description", "")).strip()

    def ask(kind: str, window: Window, variant: int) -> str:
        if kind == "description":
            return attempt(lambda: describe(window))
        # The two readings differ only in where the instruction sits. An empty
        # reading is a real answer — nothing was said — so it is not retried.
        prompt = [{"type": "text", "text": SPEECH_PROMPT}]
        audio = parts("audio", window)
        content = [*audio, *prompt] if variant == 0 else [*prompt, *audio]
        for _ in range(2):
            try:
                return complete(content, None)
            except RuntimeError:
                continue
        return ""

    return ask
