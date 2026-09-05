/** Bound both response headers and gaps between body chunks, not just fetch(). */
export const fetchWithDeadline = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  idleMs = 15_000,
): Promise<Response> => {
  const controller = new AbortController();
  const abort = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) abort();
  const cleanup = () => init?.signal?.removeEventListener("abort", abort);
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Download timed out — check the connection and retry.");
        controller.abort(error);
        reject(error);
      }, idleMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  };
  let response: Response;
  try {
    response = await bounded(fetch(input, { ...init, signal: controller.signal }));
  } catch (error) {
    cleanup();
    throw error;
  }
  if (!response.ok || !response.body) {
    cleanup();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const { done, value } = await bounded(reader.read());
        if (done) {
          cleanup();
          stream.close();
        } else stream.enqueue(value);
      } catch (error) {
        cleanup();
        stream.error(error);
        void reader.cancel(error).catch(() => {});
      }
    },
    cancel(reason) {
      cleanup();
      controller.abort(reason);
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
