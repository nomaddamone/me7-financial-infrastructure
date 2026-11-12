export interface FallbackResult<T> {
  value: T;
  endpoint: string;
}

export class AllEndpointsFailed extends Error {
  readonly failures: { endpoint: string; reason: string }[];
  constructor(failures: { endpoint: string; reason: string }[]) {
    super(`All ${failures.length} endpoints failed`);
    this.name = 'AllEndpointsFailed';
    this.failures = failures;
  }
}

/**
 * Try endpoints in order until one answers. A node that is down, rate-limited,
 * slow, or returns something malformed is skipped — `call` must throw for those.
 */
export async function withFallback<T>(
  endpoints: readonly string[],
  call: (endpoint: string, signal: AbortSignal) => Promise<T>,
  timeoutMs = 8000,
): Promise<FallbackResult<T>> {
  if (endpoints.length === 0) throw new AllEndpointsFailed([]);
  const failures: { endpoint: string; reason: string }[] = [];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return { value: await call(endpoint, controller.signal), endpoint };
    } catch (e) {
      const reason = controller.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
      failures.push({ endpoint, reason });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AllEndpointsFailed(failures);
}
