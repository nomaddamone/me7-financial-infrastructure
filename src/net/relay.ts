import type { GaslessPricing, GaslessRequest } from '../core/gasless.ts';
import { GASLESS } from './endpoints.ts';

/** Why the relay did not take an operation; the codes are the relay's own (see server/relay-core.ts). */
export class RelayError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`relay: ${code}`);
    this.code = code;
  }
}

async function ask(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${GASLESS.path}${path}`, { ...init, signal: controller.signal });
    return (await res.json()) as unknown;
  } catch {
    throw new RelayError('down');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today's prices, if me7's relay is up and has gas to pay with; null if it is
 * not. The fixed parts of the fee are the ones this page was built with: the
 * relay only reports its gas expense, and an absurd figure is not believed.
 */
export async function fetchRelayPricing(): Promise<GaslessPricing | null> {
  try {
    const info = (await ask('/info')) as { ok?: unknown; ready?: unknown; chain?: unknown; perCall?: unknown } | null;
    if (info?.ok !== true || info.ready !== true || info.chain !== 'base') return null;
    if (typeof info.perCall !== 'string' || !/^[0-9]{1,12}$/.test(info.perCall)) return null;
    const perCall = BigInt(info.perCall);
    if (perCall * 2n > GASLESS.maxGasPart) return null;
    return { base: GASLESS.base, free: GASLESS.free, extra: GASLESS.extra, perCall };
  } catch {
    return null;
  }
}

/** Hand the signed permissions to the relay. Returns the hash of the transaction it sent. */
export async function relaySend(request: GaslessRequest): Promise<string> {
  const body = JSON.stringify(request, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
  const answer = (await ask('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { ok?: unknown; hash?: unknown; error?: unknown } | null;
  if (answer?.ok === true && typeof answer.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(answer.hash)) return answer.hash;
  throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
}
