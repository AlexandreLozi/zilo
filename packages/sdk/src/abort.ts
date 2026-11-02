// Abort plumbing shared by detection runs, the credential lock and the auth client.
import { ZiloAbortError } from './errors.js';

/** Throws `ZiloAbortError` when `signal` is already aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new ZiloAbortError('aborted');
}

/**
 * Settles like `work`, except that it rejects with `ZiloAbortError` as soon as `signal` aborts.
 * `work` keeps running, but its late result or failure is consumed and ignored. The abort listener
 * is removed exactly once, whichever side settles first.
 */
export async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return work;
  if (signal.aborted) {
    work.catch(() => undefined);
    throw new ZiloAbortError('aborted');
  }
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new ZiloAbortError('aborted'));
    };
  });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
