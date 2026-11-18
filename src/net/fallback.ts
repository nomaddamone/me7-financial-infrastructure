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
 * Endpoints that failed a moment ago, and until when they are tried last. A free node that says
 * "too many requests" says it to every request for a while; asking it first each time only
 * loses half a second per request. It is not struck off: when the others fail too, it is asked again.
 */
const cooling = new Map<string, number>();
const COOL_MS = 30_000;
/** Forget which endpoints failed (for tests, which reuse the same names). */
export const forgetFailures = (): void => cooling.clear();

/**
 * Try endpoints in order until one answers. A node that is down, rate-limited,
 * slow, or returns something malformed is skipped — `call` must throw for those.
 * Endpoints that have just failed are tried after the others.
 */
export async function withFallback<T>(
  endpoints: readonly string[],
  call: (endpoint: string, signal: AbortSignal) => Promise<T>,
  timeoutMs = 8000,
): Promise<FallbackResult<T>> {
  if (endpoints.length === 0) throw new AllEndpointsFailed([]);
  const failures: { endpoint: string; reason: string }[] = [];
  const now = Date.now();
  const cool = (e: string) => (cooling.get(e) ?? 0) > now;
  // The order given is kept within each group: those in good standing first, those that just failed after.
  const order = [...endpoints.filter((e) => !cool(e)), ...endpoints.filter(cool)];
  for (const endpoint of order) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const value = await call(endpoint, controller.signal);
      cooling.delete(endpoint);
      return { value, endpoint };
    } catch (e) {
      cooling.set(endpoint, Date.now() + COOL_MS);
      const reason = controller.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
      failures.push({ endpoint, reason });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AllEndpointsFailed(failures);
}
