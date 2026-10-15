/** Serve the browser-compatible graph while retaining the original model weights. */
const MODEL_PATH = "onnx-community/embeddinggemma-2-ONNX/";
const GRAPHS: Record<string, string> = {
  "model_q4.onnx": "/models/embeddinggemma-2/model-q4-wasm-v1.onnx",
  "vision_encoder_q4.onnx": "/models/embeddinggemma-2/vision-q4-wasm-v1.onnx",
};

export const createGemmaModelCache = (
  openCache: () => Promise<Pick<Cache, "match" | "put">>,
  fetchGraph: typeof fetch = fetch,
) => {
  let cache: ReturnType<typeof openCache> | null = null;
  const getCache = () => (cache ??= openCache());
  return {
    async match(request: string): Promise<Response | undefined> {
      const graph = GRAPHS[request.split("/").at(-1) ?? ""];
      if (request.includes(MODEL_PATH) && graph) {
        const response = await fetchGraph(graph);
        if (!response.ok) throw new Error("The search model graph could not load.");
        return response;
      }
      try {
        return await (await getCache()).match(request);
      } catch {
        return undefined;
      }
    },
    async put(request: string, response: Response): Promise<void> {
      try {
        await (await getCache()).put(request, response);
      } catch {
        // A full or unavailable cache must not prevent search.
      }
    },
  };
};
