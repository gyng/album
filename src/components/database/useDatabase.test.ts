jest.mock("@sqlite.org/sqlite-wasm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { databaseLoaderInternals } from "./useDatabase";

describe("fetchWithProgress", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("loads the database even when content-length is unavailable", async () => {
    const response = {
      ok: true,
      body: {},
      headers: {
        get: jest.fn().mockReturnValue(null),
      },
      arrayBuffer: jest.fn(),
    } as any;
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as typeof fetch;
    const onProgress = jest.fn();

    const result = await databaseLoaderInternals.fetchWithProgress(
      "/search.sqlite",
      onProgress,
    );

    expect(fetchMock).toHaveBeenCalledWith("/search.sqlite");
    expect(onProgress).toHaveBeenCalledWith(0, { loaded: 0, total: 0 });
    expect(result).toBe(response);
  });
});