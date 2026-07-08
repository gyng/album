import {
  ProgressHandler,
  sendEmbeddingWorkerRequest,
} from "./embeddingWorkerClient";

export const warmupTextEmbeddingModel = async (
  onProgress?: ProgressHandler,
): Promise<void> => {
  await sendEmbeddingWorkerRequest({ type: "warmup" }, onProgress);
};

export const encodeSearchText = async (
  text: string,
  onProgress?: ProgressHandler,
): Promise<number[]> => {
  const result = await sendEmbeddingWorkerRequest(
    { type: "encode", text },
    onProgress,
  );
  if (!result) {
    throw new Error("Text embedding worker returned no embedding.");
  }

  return result;
};
