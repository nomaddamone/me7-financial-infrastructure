import type { GaslessPricing, GaslessRequest, SignedAuthorization } from '../core/gasless.ts';
import { GASLESS, TRON_GASLESS } from './endpoints.ts';

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

/** What a name would cost today and whether it is free. Throws when the service cannot be asked. */
export async function fetchNameQuote(label: string): Promise<{ available: boolean; affordable: boolean; fee: bigint }> {
  const answer = (await ask(`/name?label=${encodeURIComponent(label)}`)) as { ok?: unknown; available?: unknown; affordable?: unknown; fee?: unknown; error?: unknown } | null;
  if (answer?.ok !== true) throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
  if (typeof answer.fee !== 'string' || !/^[0-9]{1,12}$/.test(answer.fee) || typeof answer.available !== 'boolean') throw new RelayError('down');
  const fee = BigInt(answer.fee);
  // A fee below the service's own part, or an absurd one, is not believed.
  if (fee < GASLESS.nameService || fee > GASLESS.nameMaxFee) throw new RelayError('down');
  return { available: answer.available, affordable: answer.affordable !== false, fee };
}

/** Ask the service to register the name to `owner`, paying with the signed fee. Returns the transaction's hash. */
export async function relayIssueName(label: string, owner: string, fee: SignedAuthorization): Promise<string> {
  const body = JSON.stringify({ chain: 'base', label, owner, fee }, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
  const answer = (await ask('/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { ok?: unknown; hash?: unknown; error?: unknown } | null;
  if (answer?.ok === true && typeof answer.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(answer.hash)) return answer.hash;
  throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
}

/** The same door, for the Tron side of the service. */
async function askTron(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  // Renting energy and waiting for two transfers to settle takes the service up to a minute and a half.
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${TRON_GASLESS.path}${path}`, { ...init, signal: controller.signal });
    return (await res.json()) as unknown;
  } catch {
    throw new RelayError('down');
  } finally {
    clearTimeout(timer);
  }
}

/** What sending this much USDT on Tron without TRX would cost, in USDT's units, and where the fee goes. Throws when it cannot be done. */
export async function fetchTronQuote(from: string, to: string, amount: bigint): Promise<{ fee: bigint; receiver: string }> {
  const answer = (await askTron(`/quote?from=${from}&to=${to}&amount=${amount}`)) as { ok?: unknown; fee?: unknown; receiver?: unknown; error?: unknown } | null;
  if (answer?.ok !== true) throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
  if (typeof answer.fee !== 'string' || !/^[0-9]{1,12}$/.test(answer.fee) || typeof answer.receiver !== 'string') throw new RelayError('down');
  const fee = BigInt(answer.fee);
  // A fee below the service's own part, or an absurd one, is not believed; nor is a fee address other than the one this page was built with.
  if (fee < TRON_GASLESS.service || fee > TRON_GASLESS.maxFee || answer.receiver !== TRON_GASLESS.receiver) throw new RelayError('down');
  return { fee, receiver: answer.receiver };
}

/** Hand the two signed transfers to the service. Returns the id of the payment's transaction. */
export async function relayTronSend(main: string, fee: string): Promise<string> {
  const answer = (await askTron('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main, fee }) })) as { ok?: unknown; hash?: unknown; error?: unknown } | null;
  if (answer?.ok === true && typeof answer.hash === 'string' && /^[0-9a-f]{64}$/.test(answer.hash)) return answer.hash;
  throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
}
