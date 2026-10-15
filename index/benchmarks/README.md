# Embedding benchmark

See [the benchmark report](../../docs/embedding-benchmark.md) for the protocol,
results and limitations. Production databases are read-only inputs.

The standalone Python environment needs NumPy, Pillow, PyTorch with CUDA,
Transformers >=5.18, SentencePiece, Protobuf and Torchvision. Do not upgrade the
indexer's environment for this experiment. The run used an isolated environment
under `.cache/embedding-benchmark/venv`.

1. Download the pinned models listed in the report's model manifest into
   `.cache/embedding-benchmark/{google,onnx,siglip-onnx,unsloth}`. Keep the Hub
   repository file structure, including ONNX external data files. Google is the
   reference checkpoint; ONNX needs text model q4/q8/q4f16; SigLIP needs text q4;
   Unsloth needs UD-Q4_K_XL and Q8_0.
2. Run `python index/benchmarks/embedding_benchmark.py prepare`, then `baselines`
   and `gemma`. The image passes checkpoint every ten batches and can resume.
3. Install a standalone llama.cpp b11669 under
   `.cache/embedding-benchmark/llama/llama-b11669`, then run the Python `gguf`
   stage. It starts and terminates a loopback-only process for each model.
4. Run `node index/benchmarks/embedding-onnx.mjs` with `src/node_modules` installed.
5. Run `python index/benchmarks/embedding_report.py rank`. This creates shuffled,
   model-blind contact sheets and a candidate manifest. Keep retrieval model
   identities away from judges until all grades have been submitted.
6. Ask Sol to judge each query/candidate once, using the report's rubric. Save
   JSON files in the output directory as `sol-grades-<partition>.json`, with shape
   `{ "judge": "gpt-6.1-sol", "grades": { "T01": { "P0001": { "grade": 2,
   "reason": "visible reason" } } } }`. The same query/photo pair must not occur in two files.
7. Run `python index/benchmarks/embedding_report.py score`. It rejects missing,
   duplicate and out-of-range grades rather than quietly dropping judgements.

Run metric regression checks with:

```sh
python -m unittest discover -s index/benchmarks -p 'test_*.py'
```

Contact sheets and small result manifests belong in `docs/`; downloaded models,
large matrices, native logs and runtimes are ignored under `.cache/`.

The final report samples 12 of the 24 computed text queries and three image
references. It scores the top three results. The IDs are fixed in
`embedding_report.py`. Completed grades outside this sample are not used.
