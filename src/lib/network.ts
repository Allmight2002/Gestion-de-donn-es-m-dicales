export const DEFAULT_READ_TIMEOUT_MS = 30_000;

export class NetworkReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La lecture reseau a depasse ${Math.ceil(timeoutMs / 1000)} secondes`);
    this.name = 'NetworkReadTimeoutError';
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return null;
}

/**
 * Borne uniquement les lectures HTTP courtes. Les mutations, RPC, imports,
 * exports Edge et uploads (POST/PUT/PATCH/DELETE) gardent leur cycle de vie
 * propre afin qu'une operation longue ne soit pas interrompue apres commit.
 */
export function createReadTimeoutFetch(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    if ((method !== 'GET' && method !== 'HEAD') || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return fetchImpl(input, init);
    }

    const controller = new AbortController();
    const upstream = requestSignal(input, init);
    let timedOut = false;
    const forwardAbort = () => controller.abort(upstream?.reason);
    if (upstream?.aborted) forwardAbort();
    else upstream?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new NetworkReadTimeoutError(timeoutMs));
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new NetworkReadTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', forwardAbort);
    }
  }) as typeof fetch;
}
