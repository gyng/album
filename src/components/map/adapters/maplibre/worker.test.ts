const mockSetWorkerUrl = jest.fn();

jest.mock("./engine", () => ({
  gl: {
    setWorkerUrl: (url: string) => {
      mockSetWorkerUrl(url);
    },
  },
}));

describe("installVendoredWorker", () => {
  beforeEach(() => {
    jest.resetModules();
    mockSetWorkerUrl.mockReset();
  });

  it("points MapLibre at the vendored worker once", async () => {
    const { installVendoredWorker } = await import("./worker");

    installVendoredWorker();
    installVendoredWorker();

    expect(mockSetWorkerUrl).toHaveBeenCalledTimes(1);
    expect(mockSetWorkerUrl).toHaveBeenCalledWith("/vendor/maplibre-gl-worker.mjs");
  });

  it("retries after a failure rather than pretending the worker is installed", async () => {
    // A throw used to leave the idempotency flag set, so every map built after
    // the first fell back to the empty-worker path with nothing to show for it.
    mockSetWorkerUrl.mockImplementationOnce(() => {
      throw new Error("setWorkerUrl is not a function");
    });
    const { installVendoredWorker } = await import("./worker");

    expect(() => {
      installVendoredWorker();
    }).toThrow();
    installVendoredWorker();

    expect(mockSetWorkerUrl).toHaveBeenCalledTimes(2);
  });
});
