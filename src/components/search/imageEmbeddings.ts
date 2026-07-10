import { ProgressHandler, sendEmbeddingWorkerRequest } from "./embeddingWorkerClient";

export const encodeSearchImage = async (
  blob: Blob,
  onProgress?: ProgressHandler,
): Promise<number[]> => {
  const result = await sendEmbeddingWorkerRequest({ type: "encode-image", blob }, onProgress);
  if (!result) {
    throw new Error("Image embedding worker returned no embedding.");
  }

  return result;
};
