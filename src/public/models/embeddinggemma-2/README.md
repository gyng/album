# EmbeddingGemma 2 browser graphs

Derived from `onnx-community/embeddinggemma-2-ONNX` revision
`daa72c51243991dfcaf9f9137d2c573d8f7790c0` (Apache 2.0), from Google's
`google/embeddinggemma-2`.

The standard WASM runtime does not implement `GatherBlockQuantized`.
`index/benchmarks/prepare_gemma_browser.py` replaces its 4-bit row gather with
standard Gather, integer nibble unpacking and per-block dequantisation.
All original quantised weights and external-data offsets remain unchanged.
The worker substitutes these small graphs and downloads/caches the original
external weights from the pinned Hub revision. Audio weights are not downloaded
by the browser.

Regenerate both model_q4.onnx and vision_encoder_q4.onnx with that script.
Verify numerical parity and real browser inference before publishing changes.
