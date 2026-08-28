import { afterEach, describe, expect, test, vi } from 'vitest';
import { createReadTimeoutFetch, NetworkReadTimeoutError } from '../src/lib/network';

afterEach(() => {
  vi.useRealTimers();
});

describe('createReadTimeoutFetch', () => {
  test('interrompt une lecture GET bloquee avec AbortController', async () => {
    vi.useFakeTimers();
    const receivedSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal) receivedSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const timedFetch = createReadTimeoutFetch(fetchImpl, 2_000);

    const request = timedFetch('https://example.test/read');
    const rejection = expect(request).rejects.toBeInstanceOf(NetworkReadTimeoutError);
    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(receivedSignals[0]?.aborted).toBe(true);
  });

  test('ne pose aucun timeout sur une mutation ou une operation potentiellement longue', async () => {
    vi.useFakeTimers();
    let resolveRequest!: (response: Response) => void;
    let receivedSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveRequest = resolve; });
    }) as unknown as typeof fetch;
    const timedFetch = createReadTimeoutFetch(fetchImpl, 1_000);

    const request = timedFetch('https://example.test/rpc', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(receivedSignal).toBeUndefined();
    resolveRequest(new Response(null, { status: 204 }));
    await expect(request).resolves.toHaveProperty('status', 204);
  });

  test('propage l annulation explicite de l appelant sans la requalifier en timeout', async () => {
    const caller = new AbortController();
    const reason = new Error('navigation annulee');
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const timedFetch = createReadTimeoutFetch(fetchImpl, 30_000);

    const request = timedFetch('https://example.test/read', { signal: caller.signal });
    caller.abort(reason);

    await expect(request).rejects.toBe(reason);
  });
});
