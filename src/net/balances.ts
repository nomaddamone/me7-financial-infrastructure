import { isValidEvmAddress } from '../core/evm.ts';
import { withFallback, type FallbackResult } from './fallback.ts';

/** Native coin balance of an EVM account, in wei. */
export function fetchEvmBalance(
  endpoints: readonly string[],
  address: string,
): Promise<FallbackResult<bigint>> {
  if (!isValidEvmAddress(address)) throw new Error('Invalid EVM address');
  return withFallback(endpoints, async (url, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    const result = (body as { result?: unknown } | null)?.result;
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) {
      const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
      throw new Error(typeof message === 'string' ? message.slice(0, 120) : 'Malformed response');
    }
    return BigInt(result);
  });
}

export interface BitcoinBalance {
  /** Confirmed balance in satoshi. */
  confirmed: bigint;
  /** Net change from unconfirmed transactions, may be negative. */
  pending: bigint;
}

function sum(stats: unknown): bigint {
  const s = stats as { funded_txo_sum?: unknown; spent_txo_sum?: unknown } | null;
  const funded = s?.funded_txo_sum;
  const spent = s?.spent_txo_sum;
  if (
    typeof funded !== 'number' || typeof spent !== 'number' ||
    !Number.isSafeInteger(funded) || !Number.isSafeInteger(spent) ||
    funded < 0 || spent < 0
  ) {
    throw new Error('Malformed response');
  }
  return BigInt(funded) - BigInt(spent);
}

/** Balance of one Bitcoin address from an Esplora-compatible API. */
export function fetchBitcoinBalance(
  endpoints: readonly string[],
  address: string,
): Promise<FallbackResult<BitcoinBalance>> {
  if (!/^(bc|tb)1[02-9ac-hj-np-z]{11,71}$/.test(address)) throw new Error('Invalid Bitcoin address');
  return withFallback(endpoints, async (base, signal) => {
    const res = await fetch(`${base}/address/${address}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { chain_stats?: unknown; mempool_stats?: unknown } | null;
    const confirmed = sum(body?.chain_stats);
    if (confirmed < 0n) throw new Error('Malformed response');
    return { confirmed, pending: sum(body?.mempool_stats) };
  });
}

/** Render an integer amount of base units as a decimal string, without float math. */
export function formatUnits(value: bigint, decimals: number, maxFraction = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && text !== '0' ? `-${text}` : text;
}
