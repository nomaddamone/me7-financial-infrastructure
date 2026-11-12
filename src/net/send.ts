import { decodeUint256, erc20BalanceOfData, type Utxo } from '../core/index.ts';
import { PRICE_CHANGE, PRICE_COINGECKO, PRICE_LLAMA } from './endpoints.ts';
import { withFallback } from './fallback.ts';

/** One JSON-RPC call against the first EVM node that gives a usable answer. */
export async function evmRpc(endpoints: readonly string[], method: string, params: unknown[]): Promise<unknown> {
  const { value } = await withFallback(endpoints, async (url, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: unknown } } | null;
    if (body?.error) throw new Error(typeof body.error.message === 'string' ? body.error.message.slice(0, 160) : 'RPC error');
    if (body?.result === undefined || body.result === null) throw new Error('Malformed response');
    return body.result;
  });
  return value;
}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('Malformed response');
  return BigInt(value);
}

/** Next transaction number for the account, counting transactions still waiting in the pool. */
export async function fetchEvmNonce(endpoints: readonly string[], address: string): Promise<bigint> {
  return quantity(await evmRpc(endpoints, 'eth_getTransactionCount', [address, 'pending']));
}

/** Balance of an ERC-20 token, in the token's base units. */
export async function fetchErc20Balance(endpoints: readonly string[], token: string, owner: string): Promise<bigint> {
  const result = await evmRpc(endpoints, 'eth_call', [{ to: token, data: erc20BalanceOfData(owner) }, 'latest']);
  if (typeof result !== 'string') throw new Error('Malformed response');
  return decodeUint256(result);
}

/**
 * Gas the transaction will need. A plain transfer to an ordinary address needs
 * 21000; a contract call (every token transfer is one) needs more, and guessing
 * too low would burn the fee on a failed transaction. When the node can't
 * estimate, `fallback` is used.
 */
export async function estimateEvmGas(
  endpoints: readonly string[],
  call: { from: string; to: string; value: bigint; data?: string },
  fallback = 21000n,
): Promise<bigint> {
  try {
    const params = { from: call.from, to: call.to, value: `0x${call.value.toString(16)}`, ...(call.data ? { data: call.data } : {}) };
    const gas = quantity(await evmRpc(endpoints, 'eth_estimateGas', [params]));
    if (gas <= 21000n) return 21000n;
    if (gas > 1_000_000n) throw new Error('Gas estimate out of range');
    return (gas * 12n) / 10n;
  } catch {
    return fallback;
  }
}

export interface EvmFees {
  /** Current base fee, wei per gas. */
  baseFee: bigint;
  maxPriorityFeePerGas: bigint;
  /** Cap that survives the base fee doubling before the transfer is included. */
  maxFeePerGas: bigint;
}

export async function fetchEvmFees(endpoints: readonly string[]): Promise<EvmFees> {
  const block = (await evmRpc(endpoints, 'eth_getBlockByNumber', ['latest', false])) as { baseFeePerGas?: unknown };
  const baseFee = quantity(block.baseFeePerGas);
  let tip = 1_500_000_000n;
  try {
    tip = quantity(await evmRpc(endpoints, 'eth_maxPriorityFeePerGas', []));
  } catch {
    /* not every node offers this method; 1.5 gwei is the customary default */
  }
  // A node must not be able to talk us into an absurd fee.
  const ceiling = 500_000_000_000n;
  if (baseFee > ceiling || tip > ceiling) throw new Error('Fee data out of range');
  return { baseFee, maxPriorityFeePerGas: tip, maxFeePerGas: baseFee * 2n + tip };
}

/**
 * Broadcast a signed transaction. Rejections ("insufficient funds", "nonce too low")
 * come back as an Error with the node's message. "already known" means an earlier
 * attempt got through, so it counts as success.
 */
export async function broadcastEvm(endpoints: readonly string[], raw: string, hash: string): Promise<string> {
  try {
    const result = await evmRpc(endpoints, 'eth_sendRawTransaction', [raw]);
    return typeof result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result) ? result : hash;
  } catch (e) {
    const reasons = (e as { failures?: { reason: string }[] }).failures?.map((f) => f.reason) ?? [];
    if (reasons.some((r) => /already known|already imported|known transaction/i.test(r))) return hash;
    throw new Error(reasons.find((r) => r !== 'timeout') ?? reasons[0] ?? 'Broadcast failed');
  }
}

export async function fetchBitcoinUtxos(endpoints: readonly string[], address: string): Promise<Utxo[]> {
  const { value } = await withFallback(endpoints, async (base, signal) => {
    const res = await fetch(`${base}/address/${address}/utxo`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list: unknown = await res.json();
    if (!Array.isArray(list)) throw new Error('Malformed response');
    return list.map((item: { txid?: unknown; vout?: unknown; value?: unknown }) => {
      const ok =
        typeof item.txid === 'string' && /^[0-9a-f]{64}$/.test(item.txid) &&
        Number.isSafeInteger(item.vout) && (item.vout as number) >= 0 &&
        Number.isSafeInteger(item.value) && (item.value as number) > 0;
      if (!ok) throw new Error('Malformed response');
      return { txid: item.txid as string, vout: item.vout as number, value: BigInt(item.value as number) };
    });
  });
  return value;
}

/**
 * Fee rate in satoshi per virtual byte for confirmation within about half an hour.
 * mempool.space has a ready answer; plain Esplora servers give per-target estimates instead.
 */
export async function fetchBitcoinFeeRate(endpoints: readonly string[]): Promise<number> {
  const { value } = await withFallback(endpoints, async (base, signal) => {
    let rate: unknown;
    const res = await fetch(`${base}/v1/fees/recommended`, { signal });
    if (res.ok) {
      rate = ((await res.json()) as { halfHourFee?: unknown } | null)?.halfHourFee;
    } else {
      const alt = await fetch(`${base}/fee-estimates`, { signal });
      if (!alt.ok) throw new Error(`HTTP ${alt.status}`);
      // Keyed by confirmation target in blocks; 3 blocks is about half an hour.
      const target = ((await alt.json()) as Record<string, unknown> | null)?.['3'];
      rate = typeof target === 'number' ? Math.max(1, Math.ceil(target)) : undefined;
    }
    if (typeof rate !== 'number' || !(rate >= 1) || rate > 2000) throw new Error('Fee data out of range');
    return rate;
  });
  return value;
}

export async function broadcastBitcoin(endpoints: readonly string[], hex: string): Promise<string> {
  try {
    const { value } = await withFallback(endpoints, async (base, signal) => {
      const res = await fetch(`${base}/tx`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: hex, signal });
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
      if (!/^[0-9a-f]{64}$/.test(text)) throw new Error('Malformed response');
      return text;
    });
    return value;
  } catch (e) {
    const reasons = (e as { failures?: { reason: string }[] }).failures?.map((f) => f.reason) ?? [];
    throw new Error(reasons.find((r) => r !== 'timeout') ?? reasons[0] ?? 'Broadcast failed');
  }
}

/** Assets we show a dollar value for, with their names at the two price sources. */
export const PRICE_IDS = {
  eth: 'ethereum',
  btc: 'bitcoin',
  usdt: 'tether',
  usdc: 'usd-coin',
  dai: 'dai',
  link: 'chainlink',
  trx: 'tron',
} as const;
export type PriceId = keyof typeof PRICE_IDS;
export type UsdPrices = Record<PriceId, number>;

const sane = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e8;

/** Current USD prices from a free source, with a second source as backup. */
export async function fetchUsdPrices(): Promise<UsdPrices> {
  const { value } = await withFallback([PRICE_LLAMA, PRICE_COINGECKO], async (url, signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown> | null;
    const llama = body?.coins as Record<string, { price?: unknown }> | undefined;
    const out = {} as UsdPrices;
    for (const [id, name] of Object.entries(PRICE_IDS) as [PriceId, string][]) {
      const price = llama ? llama[`coingecko:${name}`]?.price : (body?.[name] as { usd?: unknown } | undefined)?.usd;
      if (!sane(price)) throw new Error('Malformed response');
      out[id] = price;
    }
    return out;
  });
  return value;
}

/** How much each price moved over the last 24 hours, in percent. Assets the source does not know are left out. */
export async function fetchDayChanges(): Promise<Partial<Record<PriceId, number>>> {
  const names = Object.values(PRICE_IDS).map((name) => `coingecko:${name}`).join(',');
  const res = await fetch(`${PRICE_CHANGE}${names}?period=24h`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const coins = ((await res.json()) as { coins?: Record<string, unknown> } | null)?.coins;
  if (!coins || typeof coins !== 'object') throw new Error('Malformed response');
  const out: Partial<Record<PriceId, number>> = {};
  for (const [id, name] of Object.entries(PRICE_IDS) as [PriceId, string][]) {
    const change = coins[`coingecko:${name}`];
    if (typeof change === 'number' && Number.isFinite(change) && Math.abs(change) < 1000) out[id] = change;
  }
  return out;
}
