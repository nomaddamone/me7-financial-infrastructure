import type { GaslessPricing, GaslessRequest, SignedAuthorization } from '../core/gasless.ts';
import { readEthGasTerms, type EthGasTerms } from '../core/ethgas.ts';
import { CROSS, ETH_GASLESS, GASLESS, TRON_GASLESS } from './endpoints.ts';

/** Why the relay did not take an operation; the codes are the relay's own (see server/relay-core.ts). */
export class RelayError extends Error {
  readonly code: string;
  /** For 'held': the address the service found in quarantine. */
  readonly address: string;
  constructor(code: string, address = '') {
    super(`relay: ${code}`);
    this.code = code;
    this.address = address;
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

/**
 * Tell me7's service which addresses a payment is about to be made from, so that its look at them for quarantine
 * (see src/core/quarantine.ts) is done by the time the payment comes. They are the addresses the payment itself
 * will name a moment later. Nothing comes back, and a failure here changes nothing.
 */
export function relayLook(addresses: readonly string[]): void {
  if (addresses.length === 0) return;
  void ask('/look', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: 'base', addresses }) }).catch(() => undefined);
}

/** Hand the signed permissions to the relay. Returns the hash of the transaction it sent. */
export async function relaySend(request: GaslessRequest): Promise<string> {
  const body = JSON.stringify(request, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
  const answer = (await ask('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body })) as { ok?: unknown; hash?: unknown; error?: unknown; address?: unknown } | null;
  if (answer?.ok === true && typeof answer.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(answer.hash)) return answer.hash;
  throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down', typeof answer?.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(answer.address) ? answer.address : '');
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
export async function fetchTronQuote(from: string, to: string, amount: bigint, ahead = false, cross = false): Promise<{ fee: bigint; receiver: string }> {
  // `ahead`: the sender is an address the money has not reached yet, so the answer is an estimate.
  const answer = (await askTron(`/quote?from=${from}&to=${to}&amount=${amount}${ahead ? '&ahead=1' : ''}${cross ? '&cross=1' : ''}`)) as { ok?: unknown; fee?: unknown; receiver?: unknown; error?: unknown } | null;
  if (answer?.ok !== true) throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
  if (typeof answer.fee !== 'string' || !/^[0-9]{1,12}$/.test(answer.fee) || typeof answer.receiver !== 'string') throw new RelayError('down');
  const fee = BigInt(answer.fee);
  // A fee below the service's own part, or an absurd one, is not believed; nor is a fee address other than the one this page was built with.
  // `cross`: money that came through a crossing from Base is paid on for the service's lower part.
  if (fee < (cross ? CROSS.tronService : TRON_GASLESS.service) || fee > TRON_GASLESS.maxFee || answer.receiver !== TRON_GASLESS.receiver) throw new RelayError('down');
  return { fee, receiver: answer.receiver };
}

/** Hand the two signed transfers to the service. Returns the id of the payment's transaction. */
export async function relayTronSend(main: string, fee: string, cross?: string): Promise<string> {
  // `cross` names the crossing the money came by (its deposit address), for the service to check before it takes the lower fee.
  const answer = (await askTron('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main, fee, ...(cross ? { cross } : {}) }) })) as { ok?: unknown; hash?: unknown; error?: unknown } | null;
  if (answer?.ok === true && typeof answer.hash === 'string' && /^[0-9a-f]{64}$/.test(answer.hash)) return answer.hash;
  throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
}

/**
 * USDT and USDC on Ethereum without ETH (see src/core/ethgas.ts): the terms me7's service gives for a pair of
 * transfers, read strictly, and the pair handed over. The pair is answered at once and carried to the network
 * afterwards, so what comes back is the payment's hash, not yet its inclusion.
 */
export async function fetchEthGasTerms(from: string, token: string, to: string, amount: bigint, ahead = false): Promise<EthGasTerms> {
  // `ahead`: the terms are for an address the token has not reached yet, so they are an estimate from above.
  const query = new URLSearchParams({ from, token, to, amount: amount.toString(), ...(ahead ? { ahead: '1' } : {}) });
  const answer = (await ask(`/eth/quote?${query}`)) as { ok?: unknown; error?: unknown } | null;
  if (answer?.ok !== true) throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
  try {
    return readEthGasTerms(answer, { service: ETH_GASLESS.service, maxFee: ETH_GASLESS.maxFee, receiver: GASLESS.receiver, maxGasPrice: ETH_GASLESS.maxGasPrice, maxGas: ETH_GASLESS.maxGas });
  } catch {
    throw new RelayError('down');
  }
}

export async function relayEthSend(fee: string, main: string): Promise<string> {
  const answer = (await ask('/eth/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fee, main }) })) as { ok?: unknown; hash?: unknown; error?: unknown } | null;
  if (!(answer?.ok === true && typeof answer.hash === 'string' && /^0x[0-9a-f]{64}$/.test(answer.hash))) throw new RelayError(typeof answer?.error === 'string' ? answer.error : 'down');
  // The service offers the pair to the block builders, block after block, and gives up after a couple of minutes with
  // nothing spent. So the wallet waits to hear which it was: the pair is in the chain, or it never went.
  for (const until = Date.now() + ETH_GASLESS.waitMs; Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const said = (await ask(`/eth/status?hash=${answer.hash}`).catch(() => null)) as { state?: unknown } | null;
    if (said?.state === 'done') return answer.hash;
    if (said?.state === 'missed') throw new RelayError('missed');
  }
  // No word either way (the page slept, the service restarted): the hash is the thing to look up.
  return answer.hash;
}

/**
 * A risk report on an address (see AML in endpoints.ts): the question goes to me7's service with the payment for it,
 * or with the ticket of a payment already made. What comes back is the screening service's own answer.
 * A refusal carries the ticket when the payment went through and the report did not come.
 */
export class AmlError extends RelayError {
  readonly ticket: string;
  constructor(code: string, ticket = '', address = '') {
    super(code, address);
    this.ticket = ticket;
  }
}
export async function relayAml(chain: string, address: string, paid: { payment: GaslessRequest } | { ticket: string }): Promise<{ report: unknown; hash: string }> {
  const body = JSON.stringify({ chain, address, ...paid }, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
  const controller = new AbortController();
  // Longer than other requests: the payment must get into a block before the report is bought.
  const timer = setTimeout(() => controller.abort(), 90_000);
  let answer: { ok?: unknown; report?: unknown; hash?: unknown; error?: unknown; ticket?: unknown; address?: unknown } | null;
  try {
    answer = (await (await fetch(`${GASLESS.path}/aml`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller.signal })).json()) as typeof answer;
  } catch {
    throw new AmlError('down');
  } finally {
    clearTimeout(timer);
  }
  if (answer?.ok === true && typeof answer.hash === 'string') return { report: answer.report, hash: answer.hash };
  throw new AmlError(typeof answer?.error === 'string' ? answer.error : 'down', typeof answer?.ticket === 'string' ? answer.ticket : '', typeof answer?.address === 'string' ? answer.address : '');
}
