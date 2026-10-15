import { createGemmaModelCache } from "./gemmaModelCache";

it("replaces only the Gemma q4 graph and preserves cached weights", async () => {
  const graph = new Response("patched graph");
  const weights = new Response("original weights");
  const match = jest.fn().mockResolvedValue(weights);
  const put = jest.fn();
  const fetchGraph = jest.fn().mockResolvedValue(graph);
  const cache = createGemmaModelCache(async () => ({ match, put }), fetchGraph);
  const base = "https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/resolve/pinned/onnx/";
  expect(await cache.match(`${base}model_q4.onnx`)).toBe(graph);
  expect(await cache.match(`${base}model_q4.onnx_data`)).toBe(weights);
  expect(fetchGraph).toHaveBeenCalledTimes(1);
  expect(await cache.match(`${base}vision_encoder_q4.onnx`)).toBe(graph);
  expect(fetchGraph).toHaveBeenLastCalledWith("/models/embeddinggemma-2/vision-q4-wasm-v1.onnx");
  await cache.put(`${base}model_q4.onnx_data`, weights);
  expect(put).toHaveBeenCalledWith(`${base}model_q4.onnx_data`, weights);
});

it("works without browser storage and fails clearly when its graph is missing", async () => {
  const cache = createGemmaModelCache(
    async () => {
      throw new Error("Storage unavailable");
    },
    jest.fn().mockResolvedValue(new Response("missing", { status: 404 })),
  );
  expect(await cache.match("https://example.test/weights")).toBeUndefined();
  await expect(cache.put("weights", new Response())).resolves.toBeUndefined();
  await expect(
    cache.match("onnx-community/embeddinggemma-2-ONNX/resolve/pinned/onnx/model_q4.onnx"),
  ).rejects.toThrow("graph could not load");
});
