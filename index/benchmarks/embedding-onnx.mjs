// Run with Node from the repository root. Uses the gallery's installed runtime.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { AutoConfig, AutoModel, AutoTokenizer, SiglipTextModel, env } from '../../src/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const work = path.join(root, '.cache/embedding-benchmark');
const queries = JSON.parse(fs.readFileSync(path.join(work, 'queries.json'), 'utf8'));
env.allowRemoteModels = false;
env.localModelPath = '';
const stats = {};
for (const [name, directory, dtype] of [['gemma-onnx-q4', 'onnx', 'q4'], ['gemma-onnx-q8', 'onnx', 'q8'], ['gemma-onnx-q4f16', 'onnx', 'q4f16'], ['siglip1-onnx-q4', 'siglip-onnx', 'q4']]) {
  let model;
  try {
    const modelPath = path.join(work, directory);
    const start = performance.now();
    const tokenizer = await AutoTokenizer.from_pretrained(modelPath, { local_files_only: true });
    const options = { dtype, device: 'cpu', local_files_only: true, session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } };
    if (directory === 'siglip-onnx') {
      model = await SiglipTextModel.from_pretrained(modelPath, options);
    } else {
      const config = await AutoConfig.from_pretrained(modelPath, { local_files_only: true });
      config.audio_config = config.vision_config = null;
      model = await AutoModel.from_pretrained(modelPath, { ...options, config });
    }
    const info = { dtype, device: 'native ONNX CPU, 4 threads', load_ms: performance.now() - start, query_ms: [] };
    const vectors = [];
    for (const query of queries) {
      const text = directory === 'siglip-onnx' ? query.text.toLowerCase() : `task: search result | query: ${query.text}`;
      const start = performance.now();
      const inputs = tokenizer(text, directory === 'siglip-onnx' ? { padding: 'max_length', truncation: true, max_length: 64 } : {});
      const output = await model(inputs);
      const tensor = output.sentence_embedding ?? output.pooler_output;
      if (!tensor) throw Error(`Missing embedding output: ${Object.keys(output)}`);
      const vector = Array.from(tensor.data, Number);
      const norm = Math.hypot(...vector);
      if (!Number.isFinite(norm) || !norm) throw Error('Invalid embedding');
      vectors.push(vector.map(value => value / norm));
      info.query_ms.push(performance.now() - start);
    }
    fs.writeFileSync(path.join(work, `${name}-queries.json`), JSON.stringify(vectors));
    stats[name] = info;
    console.log(name, 'complete', Math.round(info.load_ms), 'ms load');
  } catch (error) {
    stats[name] = { error: String(error) };
    console.error(name, error);
  } finally {
    await model?.dispose();
    fs.writeFileSync(path.join(work, 'onnx-stats.json'), JSON.stringify(stats, null, 2));
  }
}
