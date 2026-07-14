import { sendEmbeddingWorkerRequest } from "./embeddingWorkerClient";
import { encodeSearchImage } from "./imageEmbeddings";

jest.mock("./embeddingWorkerClient", () => ({
  sendEmbeddingWorkerRequest: jest.fn(),
}));

const sendRequest = jest.mocked(sendEmbeddingWorkerRequest);

describe("encodeSearchImage", () => {
  beforeEach(() => {
    sendRequest.mockReset();
  });

  it("delegates image encoding and forwards progress updates", async () => {
    const blob = new Blob(["image bytes"], { type: "image/jpeg" });
    const onProgress = jest.fn();
    sendRequest.mockResolvedValue([0.25, -0.5, 1]);

    await expect(encodeSearchImage(blob, onProgress)).resolves.toEqual([0.25, -0.5, 1]);
    expect(sendRequest).toHaveBeenCalledWith({ type: "encode-image", blob }, onProgress);
  });

  it("rejects an empty worker response instead of treating it as an embedding", async () => {
    sendRequest.mockResolvedValue(null);

    await expect(encodeSearchImage(new Blob())).rejects.toThrow(
      "Image embedding worker returned no embedding.",
    );
  });
});
