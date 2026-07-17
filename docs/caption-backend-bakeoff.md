# Caption backend bake-off — 17 July 2026

Twelve models captioning the same eleven photos. Five run locally on a 10GB RTX 3080;
seven are remote (Anthropic and OpenAI) and are **marked cloud throughout** — they are not a
like-for-like operational option and their numbers are not comparable on speed or memory
(see Caveats).

This document records the **findings**. The result sets it is derived from
(`index/.local-quality-*.json`, `index/.cloud-quality-raw.json`) and the fixture
(`index/.caption-quality-fixture-local.json`) are gitignored and regenerable — see
Reproducing. Nothing here depends on those files still existing.

## The headline

**The benchmark was structurally blind to its incumbent's biggest flaw.**
`evaluate_caption_quality_cases` searches `tags` and `alt_text` *joined*, so Janus scores
10/11 on the strength of its sentence while its tags are bare words lifted out of that same
sentence — `depicts`, `under`, `image`. Only ~6% of Janus tags are the multi-word phrases
the prompt demands, against ~90% for every other local model. Scored on tags alone it drops
to 7/11. `evaluate_tag_quality` was added to measure this; tags are what the FTS index
stores, so that is the number that matters.

## Results

| | model | tags+alt | tags only | tags/img | junk% | phrase% | s/img | peak VRAM | $/1k | all 1,495 |
|---|---|---|---|---|---|---|---|---|---|---|
| local | Janus-Pro-1B | 10/11 | **7/11** | 5.0 | 11% | 6% | 1.67 | 5.4 GB | free | free |
| local | Gemma 4 E4B · Q8_0 | 8/11 | **9/11** | 9.5 | 0% | 90% | 5.70 | 8.0 GB | free | free |
| local | Gemma 4 E4B · UD-Q5_K_XL | 9/11 | **9/11** | 10.0 | 0% | 89% | 5.20 | 7.2 GB | free | free |
| local | Gemma 4 E4B · UD-Q4_K_XL | 8/11 | **9/11** | 8.6 | 0% | 90% | 5.40 | 6.2 GB | free | free |
| local | Qwen3-VL-8B · UD-Q5_K_XL | 9/11 | **9/11** | 9.4 | 0% | 92% | 9.55 | 9.1 GB | free | free |
| **cloud** | Claude Haiku 4.5 | 10/11 | **10/11** | 5.0 | 0% | 67% | — | — | $1.92 | $2.87 |
| **cloud** | GPT-5.6 Luna | 10/11 | **10/11** | 7.3 | 0% | 94% | — | — | $2.30 | $3.44 |
| **cloud** | Claude Sonnet 5 | 11/11 | **11/11** | 10.0 | 0% | 98% | — | — | $4.22 | $6.31 |
| **cloud** | GPT-5.6 Terra | 9/11 | **9/11** | 7.1 | 0% | 92% | — | — | $5.67 | $8.48 |
| **cloud** | Claude Opus 4.8 | 11/11 | **11/11** | 10.0 | 0% | 99% | — | — | $10.85 | $16.22 |
| **cloud** | GPT-5.6 Sol | 10/11 | **10/11** | 6.2 | 0% | 94% | — | — | $11.25 | $16.82 |
| **cloud** | Claude Fable 5 | 11/11 | **11/11** | 9.2 | 0% | 91% | — | — | $20.96 | $31.34 |

Timings and VRAM are single-image measurements via `benchmark-classifier`, peak sampled at
0.3s against a 688 MiB idle baseline. Janus init is 8014 ms once; the GGUF backends report
~80 ms "init" because that is only the binary lookup — see Architecture below.

## Findings

### 1. Quantisation is quality-neutral; the Q8_0 default buys nothing

`Q8_0`, `UD-Q5_K_XL` and `UD-Q4_K_XL` score identically with identical failures. `UD-Q4_K_XL`
gives the same captions for **3 GB less VRAM**. Real free VRAM is ~9.07 GB (WSL2 overhead on
a 10240 MiB card), so `Q8_0` (8.19 GB) + `mmproj-BF16` (0.99 GB) = 9.18 GB genuinely cannot
fit and spills via `--gpu-layers auto`.

The docs' 9.9–10.4 s/image figure for `Q8_0` is stale; it now measures 5.70 s.

### 2. The GGUF speed gap is architecture, not the model — and ~70% of it is recoverable

`Gemma4GgufClassifier` spawns one `llama-mtmd-cli` subprocess **per image**, reloading 5–8 GB
of weights every time. Janus loads once (8 s) and batches four images per forward pass. The
~75 ms "init" the GGUF backends report is not a model load at all — it is `shutil.which()`
finding the binary. The real load happens inside every `predict()`.

Measured directly on `UD-Q4_K_XL`, one image, from llama.cpp's own log:

| | wall | where it goes |
|---|---|---|
| cold | 5.15 s | |
| warm (page cache) | 4.11 s | model load completes ~2.44 s in; image encode done at 2.87 s; generation ≈1.2 s |

**About 70% of per-image wall-clock is process startup and weight loading; only ~1.2 s is
inference.** Across the 1,495-photo library that is ~1,495 redundant model loads.

Running `llama-server` once and posting per image should therefore land Gemma `UD-Q4_K_XL`
near **~1.2 s/image — at or below Janus's 1.67 s** — while keeping its 9/11 tags, 91% phrase
rate and 0% junk. If that holds it removes the only real argument for keeping Janus, whose
deficit is tag *shape*.

**Prototyped and measured — it works, and it beats the incumbent.** `llama-server` was built
and driven directly over HTTP against the same prompt and frames:

| path | s/img | concept in tags |
|---|---|---|
| Gemma `UD-Q4_K_XL`, subprocess per image (current) | 5.40 | 9/11 |
| **Gemma `UD-Q4_K_XL`, persistent `llama-server`** | **1.39** | 9/11 |
| Janus-Pro-1B (incumbent) | 1.67 | 7/11 |

**3.9× faster than the current GGUF path, and faster than Janus**, with 5/5 valid JSON and ten
concrete tags per image. This removes the only argument for keeping Janus: its speed. Gemma
`UD-Q4_K_XL` on a persistent server is faster *and* has the better search payload (9/11 vs
7/11 in tags, 91% phrases vs 6%, 0% junk vs 11%), in 6.2 GB.

**One non-obvious gotcha, worth its own note.** Naively posting to `/v1/chat/completions`
returns an **empty `content`**: Gemma 4's chat template puts the server in thinking mode, the
whole token budget is spent in `reasoning_content`, and the response stops at
`finish_reason: "length"` having said nothing. `response_format: json_schema` does not prevent
it and a request-level `reasoning_budget: 0` is ignored. The switch that works is
`chat_template_kwargs: {"enable_thinking": false}` — which also accounts for most of the gain
(2.6 s → 1.39 s). The subprocess path never hit this because `--json-schema-file` grammar-
constrained the output from the first token.

**Still to do:** port `Gemma4GgufClassifier` from `subprocess.run` per image to start-once /
health-check / POST-per-image / tear-down-on-release, and re-run the full fixture to confirm
the 9/11 holds end to end through the real harness rather than a prototype script.

### 3. Inter-model disagreement is a usable confidence signal

Pooling tags per frame and separating consensus (≥4/5 local models) from singletons (exactly
one model):

- **Every non-animal frame has a solid consensus core** — `dam, reservoir, water`;
  `coffee, door, menu`; `bowl, chopsticks, ramen`.
- **Frame 3 has no consensus about the subject at all.** The only words ≥4 models share are
  `shallow` and `water`. Nothing about the animal.
- **Frame 5 has no consensus on `spider`** either.

Both agreement collapses are on frames where the models are in fact wrong. When the models
cannot agree on the subject, none of them know it. **This is the cheapest available triage
signal for which fixture cases need human re-review** — no ground truth required.

### 4. Singletons separate the models by kind, not just quality

- **Qwen's** uniques are *verifiable detail nobody else saw*: `fence`, `gravel`, `wooden`
  (frame 1); `tail`, `fur`, `long` (frame 4 — the tail is the diagnostic macaque feature);
  `bin`, `bucket`, `leaning` (frame 7); `perforated` (frame 11).
- **Gemma's** uniques skew *abstract and invented*: `wilderness`, `travel`, `family`, `cozy`,
  `abstract`, `moment`. On frame 3, `Q8_0` and `UD-Q5` hallucinated an entire fishing trip —
  `hunting`, `lure`, `submerged` / `angler's`, `tackle`.
- **Janus** contributes almost no singletons. It is too terse to add anything.

Ranking by tag usefulness is Qwen > Gemma > Janus — the exact inverse of the speed ranking.

### 5. Frame 3 is the discriminator, and only three models pass it

`test-simple/DSCF2485-2.jpg` is a **water monitor lizard** (photographer-confirmed).

| | model | said | |
|---|---|---|---|
| local | Janus-Pro-1B | "a small duck" | ✗ |
| local | Gemma `Q8_0` | "snake in water" | ✗ |
| local | Gemma `UD-Q5` | "otter" (+ an invented angler with tackle) | ✗ |
| local | Gemma `UD-Q4` | "snapping turtle" | ✗ |
| local | Qwen3-VL-8B | "alligator" | ✗ |
| cloud | Claude Haiku 4.5 | "seal", "coastal water", "rocky seabed" | ✗ |
| cloud | GPT-5.6 Luna | "swimming turtle" | ✗ |
| cloud | GPT-5.6 Terra | "swimming turtle" | ✗ |
| cloud | GPT-5.6 Sol | "swimming turtle" | ✗ |
| cloud | Claude Sonnet 5 | "swimming reptile", "long tail" | ✓ class |
| cloud | Claude Opus 4.8 | "swimming monitor lizard" | ✓ species |
| cloud | Claude Fable 5 | "monitor lizard" | ✓ species |

Nine of twelve fail, in seven different directions. **All three GPT-5.6 models say "turtle" —
the exact answer the retired fixture rewarded**, which is independent confirmation that the old
label was certifying the wrong answer rather than testing for the right one.

### 6. General captioning is saturated — only fine-grained ID discriminates

On 8 of 11 frames there is no local/cloud gap at all. Every model on both sides reads the
hand-painted sign ("coffee, tea, toast, fries, gelato"), so OCR is not the local weakness one
might expect. The gap is two frames, both species ID (the lizard and the macaque, where every
Gemma says "baboon").

Cloud is not uniformly better, either: **Haiku invented a geothermal field** — steam vents,
volcanic terrain — on the snowy landscape, where all five local models were duller and
entirely honest; and the sole fail on the signage frame is **GPT-5.6 Terra**, which reads the
sign and then omits it from its tags. "Cloud is better" reduces to "cloud is better at naming
species, and occasionally hallucinates scenery".

### 7. Two ground-truth errors were found in the fixture — one of them mine

- **Frame 3 was labelled `turtle / duck / waterfowl`.** Janus captions it "a small duck". The
  label was almost certainly written *from Janus's output* rather than from the photo, making
  the case circular: it could never fail the incumbent, and would have failed a model that
  correctly said "reptile". `UD-Q4` scored 5/5 on the old fixture by hallucinating
  "snapping turtle" — the *worse* answer scoring higher.
- **Frame 8 was labelled `lantern` by me, after looking at the photo.** Fable 5 and Sonnet 5
  read the hanging objects as glass furin wind chimes; a zoom confirmed furin. I then
  over-corrected the label to wind-chimes-only — also wrong: the photographer confirms the
  frame has **both** lanterns and wind chimes. A crop is not evidence about a whole frame.

The lesson is not "the author was careless". Single-reviewer ground truth is unreliable on
unfamiliar subject matter, and a benchmark that encodes a model's own error as truth is worse
than no benchmark — it actively certifies the failure. Cross-model disagreement (finding 3)
is what flagged both cases.

### 8. Caption backend is orthogonal to semantic search

`embedding_pipeline_version` keys only off the SigLIP model id and revision and never reads
the caption backend; `BaseCaptionClassifier` and `BaseImageEmbedder` are separate hierarchies
with separate stages. **Swapping the captioner never invalidates embeddings or touches
semantic search.** Changing the captioner requires no re-embed.

### 9. Junk tags are a latent bug, not a live one

Current Janus + the current prompt emit 11% literal junk tags (`depicts`, `under`, `image`).
The live DB is clean because it predates this prompt version, and the `tags` frequency table
that powers the facet panel is geocode-only (`Japan`, `Singapore`, …). But nothing filters
single junk words, so **a reindex today would push them into the FTS `images.tags` column.**

## Recommendation

**Keep Janus as the default for now.** It is 3× faster than anything else local, and its
deficit is tag *shape*, which may be fixable with a prompt change or a post-filter rather
than a model swap — try that before paying 3× the time.

If the tag deficit proves unfixable, **Gemma `UD-Q4_K_XL`** is the local candidate: same
quality as `Q8_0` for 3 GB less, 10/11 in tags, 91% phrases, 0% junk. Fix the per-image
subprocess reload first — it is most of the cost.

**Do not adopt Qwen3-VL-8B blind**: it peaks at 9981 of 10240 MiB (97% of the card) and would
OOM under the hybrid profile, which already loads three models.

**Cost is not the argument against cloud, and an earlier draft of this doc was wrong to imply
it was.** At 1,495 photos in the library, a full re-caption costs $2.87 (Haiku 4.5), $3.44
(GPT-5.6 Luna), $6.31 (Sonnet 5), $16.22 (Opus 4.8) or $31.34 (Fable 5) — one-off, with
incremental indexing in the cents. GPT-5.6 Luna scores 10/11 on tags for $3.44; Sonnet 5
scores 11/11 for $6.31. Both beat every local model.

The real arguments for staying local are that this is a **personal photo library** — captioning
it in the cloud means sending every private photo to a third-party API — and that the indexer
is an offline pipeline with no network dependency today. Those are the tradeoffs to weigh.
Cost is not one of them.

## Caveats — read before trusting any number here

- **Eleven frames.** Thin. Treat single-case differences as anecdote.
- **The cloud models were run through the Claude Code agent harness, not the Messages API**
  (no `ANTHROPIC_API_KEY` on this machine). Same models, same prompt, same photos — but
  wrapped in an agent with its own system prompt and tools. **Caption content is comparable;
  latency, memory and cost are not**, which is why those columns are blank. Re-run via the
  API for defensible operational numbers.
- **`parseSuccess` is not comparable across local backends.** The GGUF path gets
  `--json-schema-file` (llama.cpp grammar — malformed output is impossible); Janus gets a
  softer `JsonCompletionLogitsProcessor`; the Gemma 4 HF path constrains nothing at all. That
  metric measures the harness wiring, not the model.
- **Fable 5 was run without server-side `fallbacks`, deliberately.** A fallback would serve
  Opus's answer under Fable's name on a refusal and silently corrupt the comparison.
- **Six of eleven frames were reviewed by opening the image; the fixture ground truth is
  single-reviewer** and, as finding 7 shows, has been wrong twice.

## Reproducing

The fixture and result sets are gitignored (real albums are not in git). To regenerate:

```sh
cd index
# local models — needs llama.cpp at ~/.local/opt (never /tmp; a reboot wipes it)
uv run python index.py benchmark-caption-quality --backend janus \
  --fixture .caption-quality-fixture-local.json --output .local-quality-janus.json

G=~/.local/share/gguf/gemma-4-E4B-it
uv run python index.py benchmark-caption-quality --backend gemma4-gguf \
  --model-id "$G/gemma-4-E4B-it-UD-Q4_K_XL.gguf" --quantization "$G/mmproj-BF16.gguf" \
  --fixture .caption-quality-fixture-local.json --output .local-quality-gemma-UD-Q4_K_XL.json
```

For `gemma4-gguf`, pick the quant via the `--model-id` repo tag
(`unsloth/gemma-4-E4B-it-GGUF:UD-Q5_K_XL`) or point `--model-id` at a local `.gguf` and pass
the mmproj path as `--quantization`. See `index/README.md` for the llama.cpp build and the
`$LLAMA_MTMD_CLI` resolution order.

The committed fixture (`index/caption-quality-benchmark.json`) covers the five `test-simple`
frames only, since `albums/test-*` is the only album data in git.

A rendered view of these results is served at `/benchmark`
(`src/screens/benchmark/`), generated from `captionBenchmark.json`.
