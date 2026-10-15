// Run after preparing the isolated QA model directory with both adapted graphs.
// This checks the adapted text graph against saved benchmark outputs, and the
// adapted vision graph against the original pinned export on three image shapes.
import fs from "node:fs";
import path from "node:path";
import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  env,
} from "../../src/node_modules/@huggingface/transformers/dist/transformers.node.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const work = path.join(root, ".cache/embedding-benchmark");
const adapted = process.argv[2];
if (!adapted) throw Error("Pass the isolated model directory with adapted graphs");
env.allowRemoteModels = false;
env.localModelPath = "";
const options = {
  dtype: "q4",
  device: "cpu",
  local_files_only: true,
  session_options: { intraOpNumThreads: 4 },
};
const load = async (directory, vision) => {
  const config = await AutoConfig.from_pretrained(directory);
  config.audio_config = null;
  if (!vision) config.vision_config = null;
  return AutoModel.from_pretrained(directory, { ...options, config });
};
const queries = JSON.parse(fs.readFileSync(path.join(work, "queries.json")));
const reference = JSON.parse(fs.readFileSync(path.join(work, "gemma-onnx-q4-queries.json")));
const tokenizer = await AutoTokenizer.from_pretrained(adapted);
let model = await load(adapted, false);
let textError = 0;
for (let i = 0; i < queries.length; i++) {
  const output = await model(tokenizer(`task: search result | query: ${queries[i].text}`));
  const vector = Array.from(output.sentence_embedding.data);
  textError = Math.max(textError, ...vector.map((x, j) => Math.abs(x - reference[i][j])));
}
await model.dispose();
const processor = await AutoProcessor.from_pretrained(adapted);
const images = [
  [256, 256],
  [320, 180],
  [180, 320],
].map(([w, h]) => new RawImage(new Uint8ClampedArray(w * h * 3).fill(100), w, h, 3));
const vectors = [];
for (const directory of [path.join(work, "onnx"), adapted]) {
  model = await load(directory, true);
  const results = [];
  for (const image of images) {
    const output = await model(await processor(null, image));
    results.push(Array.from(output.sentence_embedding.data));
  }
  vectors.push(results);
  await model.dispose();
}
const visionError = Math.max(
  ...vectors[0].flatMap((v, i) => v.map((x, j) => Math.abs(x - vectors[1][i][j]))),
);
const result = {
  textQueries: queries.length,
  imageShapes: images.length,
  textMaxAbsoluteError: textError,
  visionMaxAbsoluteError: visionError,
  passed: textError < 1e-5 && visionError < 1e-5,
};
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(work, "browser-graph-parity.json"), JSON.stringify(result, null, 2));
if (!result.passed) process.exit(1);
