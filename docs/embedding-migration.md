# EmbeddingGemma 2 migration

The search model is `google/embeddinggemma-2`, revision
`914f7f89142e33e77833254d9c9b90c3cef7303b`. It replaces the two SigLIP spaces.
Vectors have 768 dimensions and are L2-normalised before int8 storage.

Hybrid search stays: keyword matches from captions, tags and metadata are merged
with semantic matches using reciprocal rank fusion. Gemma 4 still generates
captions. Captions are not inputs to photo embeddings or photo similarity.

## Browser

The worker loads the pinned ONNX q4 export for text queries. Uploaded images and
drawings lazily load the vision encoder and the shared text backbone. Audio and
video uploads are not supported. Gallery similarity uses saved vectors and needs
no encoder download. There is no SigLIP model fallback.

The published export uses `GatherBlockQuantized`, which the standard browser WASM
build cannot execute. Two small adapted graphs replace that operation with
standard row gathering and nibble dequantisation. They reuse the original q4
weights without changing a byte. See `public/models/embeddinggemma-2/README.md`.
The browser cache still stores the original large weights.

The adapted graphs were checked against all 24 saved text queries and three
image shapes. The largest text-vector difference was 1.39e-7; the vision outputs
were identical. Real Chromium WASM inference produced finite 768-dimensional
unit vectors for both text and image inputs.

## Local indexing

Use `index/do-full-index.sh` or `index/do-embeddings-index.sh`. They stage changes,
run the `gemma2-hybrid` or `gemma2` profile, validate coverage, retire legacy
vectors, then publish. Legacy Python profiles remain for reproducing old tests;
production scripts do not select them. Batch size is four.

Local video rows use up to 60 seconds from their start. Each existing minute-scene
row uses the minute beginning at its timestamp. Each segment has at most 24 frames
and mono 16 kHz audio, when a track exists. The combined token budget remains
below 8,192. Silent clips have no fabricated audio track. A text query can find
content in either the frames or the sound. Scene hits retain their seek offsets.

Local clips are decoded with ffmpeg and inspected with ffprobe. Both commands
have timeouts. A bad input leaves its vector missing for a later retry; validation
blocks publication of an incomplete corpus. Clip hashes include all source bytes,
so changing audio or a later frame invalidates its embeddings even if the poster
is unchanged. Existing image-only caption/core hashes remain independent.

YouTube entries have no local clip. They keep using their cached poster image;
this process does not download remote video or audio. Standalone audio albums
are not introduced by this change. Audio support covers tracks in local gallery
videos. The gallery's existing media and playback types remain in place.

Audio/video inference was checked with a local fixture clip, a short synthetic
audio input, and a complete one-minute synthetic clip with sound. The minute used
24 frames, 960,000 audio samples and 4,457 input tokens, producing a finite
768-dimensional unit vector. This is a compatibility check, not an audio/video retrieval benchmark.
The photo benchmark's relevance scores do not establish media-search quality.
