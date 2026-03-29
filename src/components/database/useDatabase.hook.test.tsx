import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { act, renderHook, waitFor } from "@testing-library/react";
import { databaseLoaderInternals, useDatabase } from "./useDatabase";

jest.mock("@sqlite.org/sqlite-wasm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const fakeSqlite3 = {
  version: { libVersion: "mock" },
  wasm: { allocFromTypedArray: jest.fn().mockReturnValue(1) },
  oo1: {
    DB: jest.fn().mockImplementation(() => ({
      pointer: 1,
      checkRc: jest.fn(),
    })),
  },
  capi: {
    sqlite3_deserialize: jest.fn().mockReturnValue(0),
    SQLITE_DESERIALIZE_FREEONCLOSE: 1,
  },
};

const okFetchResponse = () => ({
  ok: true,
  status: 200,
  body: null,
  headers: { get: () => null },
  arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
});

const failFetchResponse = () => ({
  ok: false,
  status: 503,
  statusText: "Service Unavailable",
  body: null,
  headers: { get: () => null },
});

describe("useDatabase", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    databaseLoaderInternals.resetForTesting();
    (sqlite3InitModule as jest.Mock).mockResolvedValue(fakeSqlite3);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("exposes an error when database fails to load", async () => {
    global.fetch = jest.fn().mockResolvedValue(failFetchResponse()) as typeof fetch;

    const { result } = renderHook(() => useDatabase());

    await waitFor(() => {
      expect(result.current[3]).toBeInstanceOf(Error);
    });

    expect(result.current[0]).toBeNull();
    expect(result.current[3]?.message).toBe("Failed to initialise SQLite");
  });

  it("resets error and retries when retry is called", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(failFetchResponse())
      .mockResolvedValueOnce(okFetchResponse());
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useDatabase());

    await waitFor(() => {
      expect(result.current[3]).toBeInstanceOf(Error);
    });

    act(() => {
      result.current[4]();
    });

    await waitFor(() => {
      expect(result.current[0]).not.toBeNull();
    });

    expect(result.current[3]).toBeNull();
  });
});
