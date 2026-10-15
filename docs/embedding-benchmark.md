# Photo embedding benchmark

Date: 16 October 2026. Status: complete.

## Decision

EmbeddingGemma 2 is a useful upgrade candidate. Its image-only results beat the
current SigLIP v1 query model in this sample. The main gain is multilingual search.
Treat this as a screening result. The sample is too small to approve a full migration.

Unsloth UD-Q4 gives strong results with a smaller file than the ONNX q4 package.
It needs a GGUF browser runtime. Our current Transformers.js worker cannot load it.
The ONNX variants fit the current runtime, but each needs a larger download than
SigLIP v1. This upgrade does not solve the mobile download problem.

## Sample and scoring

Every system searches the same 1,518 archive images. The test does not change the
production databases. The fixed query file contains 24 text queries. At the user's
request, the final rating sample uses 12 of them: eight English queries and four
multilingual queries. It also uses three image references. Each system contributes
its top three results. There are 103 distinct query/photo pairs in this final pool.

The sample was reduced before aggregate scores were calculated. Query IDs are
T01, T02, T03, T06, T09, T11, T12, T16, T19, T21, T23 and T24.
Image reference IDs are I01, I03 and I05. The reference photos came from the existing
SigLIP v2 top result for fixed subject queries. This can favour that model's choices.

Sol (`gpt-6.1-sol`) rates the pooled photos without model names, model scores or
captions. A query/photo pair gets one grade. Every system reuses that grade.

- 0: the defining subject or action is absent.
- 1: the match is weak, incidental or uncertain.
- 2: the main intent is clear; a secondary condition is absent or uncertain.
- 3: the photo gives a clear, prominent and complete match.

Scores measure visible relevance, not image quality. A generated caption is not
an answer key. An uncertain species or location stays uncertain.

Ranking score is pooled nDCG@3, shown from 0 to 100. Higher is better. It uses
exponential gains (0, 1, 3, 7) and gives more weight to the first result. The ideal
rank comes from the judged pool. Relevant results have grade 2 or 3.
These scores do not measure recall over the full archive.

Sol had already finished a wider set when the user reduced the scope. The final
analysis reuses only the selected grades. Additional rating work covers only new
caption-aware results in this sample. No photo is rated again for another model.

## Text-to-photo results

| Model and query encoder | Ranking score | English | Multilingual | Relevant results |
| --- | ---: | ---: | ---: | ---: |
| EmbeddingGemma 2 Unsloth UD-Q4 | 91.5 | 88.4 | 97.6 | 91.7% |
| EmbeddingGemma 2 BF16 reference | 88.9 | 87.9 | 90.7 | 91.7% |
| EmbeddingGemma 2 ONNX q8 | 88.9 | 87.9 | 90.7 | 91.7% |
| EmbeddingGemma 2 Unsloth Q8 | 88.9 | 87.9 | 90.7 | 91.7% |
| EmbeddingGemma 2 ONNX q4 | 84.4 | 83.7 | 85.7 | 86.1% |
| EmbeddingGemma 2 q4 + int8 storage | 84.3 | 84.3 | 84.3 | 86.1% |
| EmbeddingGemma 2 ONNX q4f16 | 82.6 | 83.7 | 80.4 | 86.1% |
| EmbeddingGemma 2, 256 dimensions | 82.6 | 84.5 | 79.0 | 86.1% |
| Image + caption, BF16 | 80.7 | 85.5 | 71.1 | 86.1% |
| Image + caption, ONNX q4 | 79.9 | 84.2 | 71.1 | 83.3% |
| Image + caption, Unsloth UD-Q4 | 79.7 | 83.9 | 71.1 | 86.1% |
| SigLIP v2 FP32 | 75.9 | 87.2 | 53.2 | 75.0% |
| SigLIP v1 FP32 | 69.9 | 74.9 | 59.8 | 77.8% |
| Current SigLIP v1 q4 | 65.9 | 75.5 | 46.6 | 77.8% |

The image-only and image-plus-caption rows use separate corpus indexes.
Both contain all 1,518 photos. The caption text comes from the existing gallery
index. This tests caption-aware retrieval. It does not test a new caption generator.

## Effect of captions

Captions reduced the ranking score in this sample. With the same ONNX q4 query
encoder, the score fell from **84.4** for image-only inputs to **79.9** for image
plus caption. With Unsloth UD-Q4, it fell from **91.5** to **79.7**.

The captions came from the current Gemma 4 index. This result does not show that
Gemma 4 is a poor caption model. It shows that adding its text to every photo did
not help this retrieval test. Keep the image-only index as the main candidate.
Keep captions for keyword search and display unless a separate test supports a change.

## Difference from the current query model

| Candidate | Ranking points | 95% query-bootstrap interval | Wins / ties / losses |
| --- | ---: | ---: | ---: |
| EmbeddingGemma 2 ONNX q4 | +18.5 | +1.9 to +38.2 | 7 / 3 / 2 |
| EmbeddingGemma 2 Unsloth UD-Q4 | +25.6 | +6.2 to +47.4 | 8 / 2 / 2 |
| Image + caption, ONNX q4 | +14.0 | +3.4 to +28.6 | 8 / 3 / 1 |
| Image + caption, Unsloth UD-Q4 | +13.8 | +2.8 to +28.4 | 8 / 3 / 1 |

Intervals use 10,000 paired query samples with seed 20261016. They measure query
variation only. They do not measure uncertainty in Sol's grades. Four multilingual
queries and three image references cannot establish broad model quality.

## Photo-to-photo results

| Corpus embedding | Ranking score | Relevant results |
| --- | ---: | ---: |
| EmbeddingGemma 2 image | 84.6 | 88.9% |
| EmbeddingGemma 2 image + caption | 80.8 | 88.9% |
| SigLIP v1 | 58.8 | 66.7% |
| SigLIP v2 | 57.6 | 66.7% |

Only three reference photos were rated. Use this result to choose a larger follow-up
test. Do not replace the cloud or game similarity model on this result alone.

## Quantisation checks

These query encoders search the same BF16 image corpus. The numeric comparison
uses all 24 fixed text queries. The relevance tables above use the reduced sample.

| Query encoder | Mean cosine to BF16 | Same top-three photos | Same first photo |
| --- | ---: | ---: | ---: |
| EmbeddingGemma 2 ONNX q4 | 0.99166 | 88.9% | 83.3% |
| EmbeddingGemma 2 ONNX q8 | 0.99995 | 98.6% | 100.0% |
| EmbeddingGemma 2 ONNX q4f16 | 0.99166 | 88.9% | 83.3% |
| Unsloth UD-Q4 | 0.99702 | 97.2% | 91.7% |
| Unsloth Q8 | 0.99989 | 98.6% | 95.8% |

Vector similarity is not a relevance grade. A small numeric change can reorder
near-equal results. A quantised model can win on this small sample by changing a
few ranks. This does not prove that quantisation improves the model.

Q4f16 completed the native ONNX test. Its valid output does not prove support on
every phone. The failed q4f16 export in September was a different SigLIP model.

The 256-dimension row truncates the first 256 values and normalises the vectors
again. It reduces index size, not the query model download. The int8 row uses a
separate scale for each image vector. It tests storage quantisation, not a
quantised offline vision encoder.

## Download size and query time

| Query encoder | Model plus tokenizer | Median query time |
| --- | ---: | ---: |
| Current SigLIP v1 q4 | 157.1 MB | 34.6 ms |
| EmbeddingGemma 2 ONNX q4 | 206.7 MB | 24.9 ms |
| EmbeddingGemma 2 ONNX q4f16 | 189.5 MB | 31.3 ms |
| EmbeddingGemma 2 ONNX q8 | 346.4 MB | 151.6 ms |
| EmbeddingGemma 2 Unsloth UD-Q4 | 175.7 MB | 20.5 ms |
| EmbeddingGemma 2 Unsloth Q8 | 309.9 MB | 24.2 ms |

Sizes are published file sizes in decimal MB. Small configuration files are included
for ONNX. GGUF contains its tokenizer. Runtime code, network compression and the
photo index are excluded. These are not measured transfer sizes.

Times use native CPU inference on a Ryzen 9 5950X with four threads. They cover
all 24 queries and include the first query. Model load and download time are excluded.
They are not phone, browser WASM or WebGPU timings. Other desktop activity was
present. Do not use these times as a direct comparison with the old caption tests.

## Method and records

The reference uses Google's pinned EmbeddingGemma 2 checkpoint in BF16 on an
RTX 3080 10 GB. It disables the audio encoder. It uses the default image token
budget, masked mean pooling, and L2 normalisation. The caption corpus appends the
existing caption to the image input. Text queries use `task: search result | query: `.

Existing SigLIP image vectors come from the read-only int8 index. The current q4
query row uses the shipped ONNX text encoder. The FP32 rows use the matching
Google checkpoints. Each query is compared only with its own model's image space.

Quantised query encoders use full-precision offline corpus embeddings. The test does
not evaluate quantising all vision weights during indexing. Image-to-image tests
also use the reference corpus vectors. The image pass used batches of four. The
caption pass resumed from its checkpoint with batches of eight and threaded image
loading. Timing records keep both passes separate.

- [Model revisions and file sizes](benchmarks/embedding-2026-10-16/runtime-and-models.json)
- [Dataset hashes](benchmarks/embedding-2026-10-16/dataset.json)
- [Per-query grades and scores](benchmarks/embedding-2026-10-16/scores.json)
- [Ranked photos](benchmarks/embedding-2026-10-16/retrievals.json)
- [Visual review](benchmarks/embedding-2026-10-16/review.html)
- [Run instructions](../index/benchmarks/README.md)

The visual review loads photos from the public gallery. The saved contact sheets
work offline. The Sol grades are model judgements, not human reference labels.

## Earlier tests in this repository

| Record | Task and sample | Recorded result | Relation to this test |
| --- | --- | --- | --- |
| [3 April caption test](gemma-captioner-evaluation.md) | Generate captions for five photos | Full Gemma 4 E2B won four of five comparisons with Janus. Its image time was about 15.5 s. | This tested a caption model. EmbeddingGemma 2 is a different model and task. Do not compare these times as a speed gain. |
| [17–18 July caption test](caption-backend-bakeoff.md) | Generate captions and tags for 11 photos | Local Gemma 4 Q4, Q5 and Q8 each passed 9/11 tag cases. Q4 took about 1.55 s per image on a resident process. | The lower-bit model kept the measured tag quality. This supports testing quantisation, but does not prove that embedding ranks stay the same. |
| [5 September search test](site-refinements-2026-09.md#cold-search) | Compare SigLIP v1 query exports on 12 queries | Q8 kept 7–10 of the Q4 top-ten results. It changed two first results. The query set took about 2.1 s with Q8 and 1.2 s with Q4. Q4f16 failed to load. | This is the closest older test. The new test uses 24 queries, adds photo relevance grades, and tests different model exports. Compare the trend, not the raw elapsed time. |
| [Cloud layout test](explore-cloud.md#umap-layout) | Project 1,518 SigLIP2 vectors to three dimensions | UMAP kept 40.4% of the ten nearest neighbours. PCA kept 13.3%. | These are layout scores. They do not measure search relevance or the quality of a new embedding model. |

The July report replaces the April caption recommendation. The indexer now
uses Gemma 4; Janus is no longer a production option.

The July test also found wrong reference labels. A water monitor lizard had been
labelled as a duck or turtle. A frame contained both lanterns and wind chimes.
This test does not use generated captions as the relevance answer key. Sol sees
the photos. It must leave an uncertain species or object uncertain. The grades
still need human review before they can serve as reference labels.

The old image set and this archive are not identical. Three old source images match archive files byte for byte (SHA-256).
They show the snowy trail, the dam, and the water monitor lizard.
The dam photo has a renamed cover file.
This test does not claim a new score on all five old cases.


## Model sources

- [Google model card](https://huggingface.co/google/embeddinggemma-2)
- [ONNX exports](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX)
- [Unsloth GGUF exports](https://huggingface.co/unsloth/embeddinggemma-2-GGUF)
- [Unsloth precision guidance](https://unsloth.ai/docs/models/embeddinggemma-2)
