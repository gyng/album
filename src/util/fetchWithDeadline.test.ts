import { fetchWithDeadline } from "./fetchWithDeadline";

describe("bounded downloads", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("rejects a request that never receives headers, even if fetch ignores abort", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise<Response>(() => {}));
    const pending = fetchWithDeadline("/search.sqlite", undefined, 100);
    const checked = expect(pending).rejects.toThrow(/timed out/i);
    await jest.advanceTimersByTimeAsync(101);
    await checked;
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("rejects a body that stalls after its headers and cancels the reader", async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    global.fetch = jest.fn(async () => new Response(new ReadableStream({ cancel })));
    const response = await fetchWithDeadline("/search.sqlite", undefined, 100);
    const checked = expect(response.arrayBuffer()).rejects.toThrow(/timed out/i);
    await jest.advanceTimersByTimeAsync(101);
    await checked;
    expect(cancel).toHaveBeenCalled();
  });

  it("preserves successful bytes and response metadata", async () => {
    global.fetch = jest.fn(async () => new Response("catalogue", { headers: { etag: "v2" } }));
    const response = await fetchWithDeadline("/search.sqlite");
    expect(await response.text()).toBe("catalogue");
    expect(response.headers.get("etag")).toBe("v2");
  });
});
