import { readSumBalance, sumBalanceCall } from './rotation.ts';
import { erc20BalanceOfData } from '../core/erc20.ts';
import { decodeTronAddress } from '../core/tron.ts';
import { PRICE_CHART } from './endpoints.ts';
import { withFallback } from './fallback.ts';
import { PRICE_IDS, type PriceId } from './send.ts';

/**
 * Balance history. There is no server keeping a record of the account, so the
 * past is rebuilt from public data: for each asset, the list of changes to the
 * address (from open explorers), walked backwards from today's balance, then
 * multiplied by what the asset cost at each moment.
 */

/** One change to a balance: its time (unix seconds) and the signed amount in base units. */
export interface Change {
  time: number;
  delta: bigint;
  /** The transaction behind the change, when the source names it. */
  tx?: string;
  /** The block of the change, when the transaction itself is not known yet (history read from nodes). */
  block?: number;
  /** The other side: who sent the money, or who it was sent to. */
  peer?: string;
}

const MAX_PAGES = 4;

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const one = <T,>(base: string, call: (base: string, signal: AbortSignal) => Promise<T>) =>
  withFallback([base], call, 12000).then((r) => r.value);
const seconds = (iso: unknown): number => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) throw new Error('Malformed response');
  return Math.floor(ms / 1000);
};
const integer = (value: unknown): bigint => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error('Malformed response');
};

/**
 * The balance at each of `times`, given the balance now and the changes since.
 * A change that happened after a moment is undone to get the balance at that moment.
 */
export function balanceSeries(current: bigint, changes: readonly Change[], times: readonly number[]): bigint[] {
  const sorted = [...changes].sort((a, b) => b.time - a.time);
  const order = times.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]);
  const out = new Array<bigint>(times.length).fill(current);
  let balance = current;
  let next = 0;
  for (const [time, index] of order) {
    while (next < sorted.length && (sorted[next]?.time ?? 0) > time) {
      balance -= sorted[next]?.delta ?? 0n;
      next++;
    }
    // History we could not fully fetch can push the rebuilt balance below zero; a balance is never negative.
    out[index] = balance < 0n ? 0n : balance;
  }
  return out;
}

/** Bitcoin: every transaction touching the address, from an Esplora server. */
export async function fetchBitcoinChanges(endpoints: readonly string[], address: string, since: number): Promise<Change[]> {
  const { value } = await withFallback(
    endpoints,
    async (base, signal) => {
      const out: Change[] = [];
      let path = `/address/${address}/txs`;
      for (let page = 0; page < MAX_PAGES; page++) {
        const list = await getJson(`${base}${path}`, signal);
        if (!Array.isArray(list)) throw new Error('Malformed response');
        let oldest = Infinity;
        let lastConfirmed = '';
        for (const tx of list as {
          txid?: unknown;
          status?: { confirmed?: unknown; block_time?: unknown };
          vin?: { prevout?: { scriptpubkey_address?: unknown; value?: unknown } | null }[];
          vout?: { scriptpubkey_address?: unknown; value?: unknown }[];
        }[]) {
          const time = typeof tx.status?.block_time === 'number' ? tx.status.block_time : Math.floor(Date.now() / 1000);
          let delta = 0n;
          for (const o of tx.vout ?? []) if (o.scriptpubkey_address === address) delta += integer(o.value);
          for (const i of tx.vin ?? []) if (i.prevout?.scriptpubkey_address === address) delta -= integer(i.prevout.value);
          if (delta !== 0n) out.push({ time, delta, ...(typeof tx.txid === 'string' ? { tx: tx.txid } : {}) });
          if (tx.status?.confirmed === true && typeof tx.txid === 'string') {
            lastConfirmed = tx.txid;
            oldest = Math.min(oldest, time);
          }
        }
        if (list.length < 25 || !lastConfirmed || oldest < since) break;
        path = `/address/${address}/txs/chain/${lastConfirmed}`;
      }
      return out;
    },
    12000,
  );
  return value;
}

interface BlockscoutPage {
  items?: unknown;
  next_page_params?: Record<string, unknown> | null;
}
async function blockscoutPages(base: string, path: string, since: number, visit: (item: Record<string, unknown>) => number, pages = MAX_PAGES, timeoutMs = 12000): Promise<void> {
  await withFallback([base], async (b, signal) => {
    let query = '';
    for (let page = 0; page < pages; page++) {
      const body = (await getJson(`${b}${path}${query ? (path.includes('?') ? '&' : '?') + query : ''}`, signal)) as BlockscoutPage | null;
      if (!body || !Array.isArray(body.items)) throw new Error('Malformed response');
      let oldest = Infinity;
      for (const item of body.items as Record<string, unknown>[]) oldest = Math.min(oldest, visit(item));
      if (!body.next_page_params || oldest < since) break;
      query = new URLSearchParams(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)])).toString();
    }
  }, timeoutMs);
}

/**
 * ETH on an EVM chain, from Blockscout. The exact per-block list is tried
 * first; that endpoint fails for some addresses, so daily balances are the backup.
 */
export async function fetchEvmCoinChanges(base: string, address: string, since: number): Promise<Change[]> {
  const out: Change[] = [];
  try {
    await blockscoutPages(base, `/api/v2/addresses/${address}/coin-balance-history`, since, (item) => {
      const time = seconds(item.block_timestamp);
      const tx = item.transaction_hash;
      out.push({ time, delta: integer(item.delta), ...(typeof tx === 'string' && tx ? { tx } : {}) });
      return time;
    });
    return out;
  } catch {
    out.length = 0;
  }
  const days = await one(base, (b, signal) => getJson(`${b}/api/v2/addresses/${address}/coin-balance-history-by-day`, signal));
  const items = (days as { items?: unknown } | null)?.items ?? days;
  if (!Array.isArray(items)) throw new Error('Malformed response');
  const points = (items as { date?: unknown; value?: unknown }[])
    .map((p) => ({ time: seconds(`${String(p.date)}T23:59:59Z`), balance: integer(p.value) }))
    .sort((a, b) => a.time - b.time);
  for (let i = 1; i < points.length; i++) {
    const delta = (points[i]?.balance ?? 0n) - (points[i - 1]?.balance ?? 0n);
    if (delta !== 0n) out.push({ time: points[i]?.time ?? 0, delta });
  }
  return out;
}

/** An ERC-20 token's transfers in and out of the address, from Blockscout. */
export async function fetchErc20Changes(base: string, address: string, token: string, since: number): Promise<Change[]> {
  const out: Change[] = [];
  const me = address.toLowerCase();
  await blockscoutPages(base, `/api/v2/addresses/${address}/token-transfers?type=ERC-20&token=${token}`, since, (item) => {
    const time = seconds(item.timestamp);
    const amount = integer((item.total as { value?: unknown } | undefined)?.value);
    const from = String((item.from as { hash?: unknown } | undefined)?.hash ?? '').toLowerCase();
    const to = String((item.to as { hash?: unknown } | undefined)?.hash ?? '').toLowerCase();
    const delta = (to === me ? amount : 0n) - (from === me ? amount : 0n);
    const tx = item.transaction_hash ?? item.tx_hash;
    const peer = delta > 0n ? from : to;
    if (delta !== 0n) out.push({ time, delta, ...(typeof tx === 'string' && tx ? { tx } : {}), ...(peer ? { peer } : {}) });
    return time;
  });
  return out;
}

/**
 * The transfers of several ERC-20 tokens in and out of the address, read in one pass, by token contract (lower case).
 *
 * Blockscout answers a question about one token slowly when the address has few transfers of it (half a minute
 * was measured), and a wallet shows half a dozen tokens. Asked for all the address's token transfers at once it
 * answers in a couple of seconds; the ones of other tokens (there are many worthless ones sent to everybody) are
 * dropped here. An address with very many of those is read only as far back as the pages allow.
 */
export async function fetchErc20ChangesAll(base: string, address: string, tokens: readonly string[], since: number): Promise<Record<string, Change[]>> {
  const out: Record<string, Change[]> = Object.fromEntries(tokens.map((t) => [t.toLowerCase(), [] as Change[]]));
  const me = address.toLowerCase();
  await blockscoutPages(
    base,
    `/api/v2/addresses/${address}/token-transfers?type=ERC-20`,
    since,
    (item) => {
      const time = seconds(item.timestamp);
      const list = out[String((item.token as { address_hash?: unknown; address?: unknown } | undefined)?.address_hash ?? (item.token as { address?: unknown } | undefined)?.address ?? '').toLowerCase()];
      if (!list) return time;
      const amount = integer((item.total as { value?: unknown } | undefined)?.value);
      const from = String((item.from as { hash?: unknown } | undefined)?.hash ?? '').toLowerCase();
      const to = String((item.to as { hash?: unknown } | undefined)?.hash ?? '').toLowerCase();
      const delta = (to === me ? amount : 0n) - (from === me ? amount : 0n);
      const tx = item.transaction_hash ?? item.tx_hash;
      const peer = delta > 0n ? from : to;
      if (delta !== 0n) list.push({ time, delta, ...(typeof tx === 'string' && tx ? { tx } : {}), ...(peer ? { peer } : {}) });
      return time;
    },
    10,
    40000,
  );
  return out;
}

interface TronPage {
  data?: unknown;
  meta?: { fingerprint?: unknown };
}
async function trongridPages(base: string, path: string, since: number, visit: (item: Record<string, unknown>) => void): Promise<void> {
  await one(base, async (b, signal) => {
    let fingerprint = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${b}${path}${sep}limit=200&only_confirmed=true&min_timestamp=${since * 1000}${fingerprint ? `&fingerprint=${fingerprint}` : ''}`;
      const body = (await getJson(url, signal)) as TronPage | null;
      if (!body || !Array.isArray(body.data)) throw new Error('Malformed response');
      for (const item of body.data as Record<string, unknown>[]) visit(item);
      if (typeof body.meta?.fingerprint !== 'string' || !body.meta.fingerprint) break;
      fingerprint = encodeURIComponent(body.meta.fingerprint);
    }
  });
}

/**
 * TRX, from TronGrid: plain transfers in and out, plus fees the address paid.
 * Rewards and transfers made from inside contracts are not listed there, so
 * for an account that uses those the rebuilt past is approximate.
 */
export async function fetchTronChanges(base: string, address: string, since: number): Promise<Change[]> {
  const me = Array.from(decodeTronAddress(address), (b) => b.toString(16).padStart(2, '0')).join('');
  const out: Change[] = [];
  await trongridPages(base, `/v1/accounts/${address}/transactions`, since, (tx) => {
    const time = Math.floor(Number(tx.block_timestamp) / 1000);
    if (!Number.isFinite(time)) throw new Error('Malformed response');
    const ret = (tx.ret as { contractRet?: unknown; fee?: unknown }[] | undefined)?.[0];
    const contract = (tx.raw_data as { contract?: { type?: unknown; parameter?: { value?: Record<string, unknown> } }[] } | undefined)?.contract?.[0];
    const value = contract?.parameter?.value ?? {};
    const mine = String(value.owner_address ?? '').toLowerCase() === me;
    let delta = 0n;
    if (mine && ret?.fee !== undefined) delta -= integer(ret.fee);
    if (contract?.type === 'TransferContract' && ret?.contractRet === 'SUCCESS') {
      const amount = integer(value.amount);
      if (mine) delta -= amount;
      if (String(value.to_address ?? '').toLowerCase() === me) delta += amount;
    }
    if (delta !== 0n) out.push({ time, delta, ...(typeof tx.txID === 'string' ? { tx: tx.txID } : {}) });
  });
  return out;
}

/** A TRC-20 token's transfers in and out of the address, from TronGrid. */
export async function fetchTrc20Changes(base: string, address: string, contract: string, since: number): Promise<Change[]> {
  const out: Change[] = [];
  await trongridPages(base, `/v1/accounts/${address}/transactions/trc20?contract_address=${contract}`, since, (item) => {
    const time = Math.floor(Number(item.block_timestamp) / 1000);
    if (!Number.isFinite(time)) throw new Error('Malformed response');
    const amount = integer(item.value);
    const delta = (item.to === address ? amount : 0n) - (item.from === address ? amount : 0n);
    const tx = item.transaction_id;
    const peer = delta > 0n ? item.from : item.to;
    if (delta !== 0n) {
      out.push({ time, delta, ...(typeof tx === 'string' ? { tx } : {}), ...(typeof peer === 'string' ? { peer } : {}) });
    }
  });
  return out;
}

export const PERIODS = [
  { id: 'day', seconds: 86400, span: 48, step: '30m' },
  { id: 'week', seconds: 604800, span: 56, step: '3h' },
  { id: 'month', seconds: 2592000, span: 60, step: '12h' },
  { id: 'year', seconds: 31536000, span: 61, step: '6d' },
] as const;
export type Period = (typeof PERIODS)[number];

export interface PriceHistory {
  /** Unix seconds, oldest first. */
  times: number[];
  prices: Record<PriceId, number[]>;
}

/** Prices of every asset across a period, on one shared time grid. */
export async function fetchPriceHistory(period: Period, now: number): Promise<PriceHistory> {
  const coins = Object.values(PRICE_IDS).map((name) => `coingecko:${name}`).join(',');
  const url = `${PRICE_CHART}${coins}?start=${now - period.seconds}&span=${period.span}&period=${period.step}`;
  const body = (await one(url, (u, signal) => getJson(u, signal))) as { coins?: Record<string, { prices?: unknown }> } | null;
  const series = {} as Record<PriceId, { timestamp: number; price: number }[]>;
  for (const [id, name] of Object.entries(PRICE_IDS) as [PriceId, string][]) {
    const list = body?.coins?.[`coingecko:${name}`]?.prices;
    if (!Array.isArray(list) || list.length < 2) throw new Error('Malformed response');
    series[id] = (list as { timestamp?: unknown; price?: unknown }[]).map((p) => {
      if (typeof p.timestamp !== 'number' || typeof p.price !== 'number' || !(p.price > 0)) throw new Error('Malformed response');
      return { timestamp: p.timestamp, price: p.price };
    });
  }
  const times = series.btc.map((p) => p.timestamp);
  const prices = {} as Record<PriceId, number[]>;
  for (const id of Object.keys(series) as PriceId[]) {
    // Sources don't always sample every coin at the same instants; take each coin's nearest sample.
    const list = series[id];
    let cursor = 0;
    prices[id] = times.map((t) => {
      while (cursor + 1 < list.length && Math.abs((list[cursor + 1]?.timestamp ?? 0) - t) <= Math.abs((list[cursor]?.timestamp ?? 0) - t)) cursor++;
      return list[cursor]?.price ?? 0;
    });
  }
  return { times, prices };
}

/**
 * Balances of the past read from the network's own nodes, for chains whose
 * explorer cannot be relied on (Base: for some addresses its explorer has no
 * coin history at all and misses incoming token transfers).
 *
 * The balance is asked at evenly spaced moments of the period; wherever two
 * neighbouring answers differ, the gap is halved again and again until the
 * exact block of each change is found. A change and its exact reverse inside
 * one gap cancel out and are not seen. Needs nodes that still hold old state.
 */
const NODE_SAMPLES = 24;
/** Free nodes count every call in a batch against a per-second limit (25 at the strictest that keeps old state). */
const NODE_BATCH = 10;
const NODE_CALL_GAP_MS = 45;
const NODE_MAX_SPLITS = 60;
/** About two days of two-second blocks. */
const NODE_SHORT_RANGE = 100_000;

type Hex = string;
async function nodeBatch(endpoints: readonly string[], calls: readonly { method: string; params: unknown[] }[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let at = 0; at < calls.length; at += NODE_BATCH) {
    const part = calls.slice(at, at + NODE_BATCH);
    const { value } = await withFallback(
      endpoints,
      async (url, signal) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(part.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!Array.isArray(body) || body.length !== part.length) throw new Error('Malformed response');
        const results = new Array<unknown>(part.length);
        for (const item of body as { id?: unknown; result?: unknown }[]) {
          // A node without old state answers some of the calls with an error: try the next node.
          if (typeof item.id !== 'number' || item.result === undefined || item.result === null) throw new Error('Incomplete response');
          results[item.id] = item.result;
        }
        if (results.includes(undefined)) throw new Error('Incomplete response');
        return results;
      },
      12000,
    );
    out.push(...value);
    await new Promise((resolve) => setTimeout(resolve, part.length * NODE_CALL_GAP_MS));
  }
  return out;
}
const hexQuantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('Malformed response');
  return BigInt(value);
};
const blockTag = (n: number): Hex => `0x${n.toString(16)}`;

/** How to ask a node for one balance at a block: the coin itself, or a token held by the address. */
export type BalanceReader = { coin: string } | { token: string; owner: string } | { token: string; owners: readonly string[] };
/** Internal: the number of transactions an address has sent, which grows in every block it acts in. */
type AnyReader = BalanceReader | { sent: string };

function balanceCall(reader: AnyReader, block: number): { method: string; params: unknown[] } {
  if ('sent' in reader) return { method: 'eth_getTransactionCount', params: [reader.sent, blockTag(block)] };
  if ('coin' in reader) return { method: 'eth_getBalance', params: [reader.coin, blockTag(block)] };
  // Several addresses of one wallet count as one balance: the node is asked for all of them in one call.
  if ('owners' in reader) return { method: 'eth_call', params: [sumBalanceCall(reader.token, reader.owners), blockTag(block)] };
  return { method: 'eth_call', params: [{ to: reader.token, data: erc20BalanceOfData(reader.owner) }, blockTag(block)] };
}
const readBalance = (reader: AnyReader, answer: unknown): bigint => ('owners' in reader ? readSumBalance(answer) : hexQuantity(answer));

/**
 * The changes of several balances over the period, one list per reader, newest
 * first. The readers share every request, so asking for a coin and a token
 * together costs little more than asking for one.
 *
 * Two opposite changes between two samples (money put somewhere and taken back)
 * leave the balance as it was and would go unseen. With `actor` given, the
 * blocks in which that address sent a transaction are found as well, and every
 * balance is compared just before and after each of them.
 */
export async function fetchChangesFromNodes(
  endpoints: readonly string[],
  balanceReaders: readonly BalanceReader[],
  since: number,
  blockSeconds: number,
  actor?: string,
  /** Continue from this block instead of from `since`: everything up to it is already known. */
  fromBlock?: number,
): Promise<{ changes: Change[][]; block: number }> {
  const readers: readonly AnyReader[] = actor ? [...balanceReaders, { sent: actor }] : balanceReaders;
  const actorIndex = actor ? balanceReaders.length : -1;
  const [head] = await nodeBatch(endpoints, [{ method: 'eth_getBlockByNumber', params: ['latest', false] }]);
  const latest = Number(hexQuantity((head as { number?: unknown }).number));
  const latestTime = Number(hexQuantity((head as { timestamp?: unknown }).timestamp));
  if (!Number.isSafeInteger(latest) || latest < 1) throw new Error('Malformed response');

  const first = Math.min(latest, fromBlock ?? Math.max(0, latest - Math.ceil(Math.max(0, latestTime - since) / blockSeconds)));
  // A short stretch is checked by its two ends alone; a long one is cut into pieces searched side by side.
  const pieces = latest - first > NODE_SHORT_RANGE ? NODE_SAMPLES : 1;
  const step = Math.max(1, Math.floor((latest - first) / pieces));
  const blocks: number[] = [];
  for (let b = first; b < latest; b += step) blocks.push(b);
  blocks.push(latest);
  const balancesAt = async (asks: readonly { reader: number; block: number }[]) =>
    (await nodeBatch(endpoints, asks.map((a) => balanceCall(readers[a.reader] as AnyReader, a.block)))).map((answer, i) => readBalance(readers[(asks[i] as { reader: number }).reader] as AnyReader, answer));
  const sampled = await balancesAt(readers.flatMap((_, reader) => blocks.map((block) => ({ reader, block }))));

  // Gaps whose two ends disagree hold at least one change; halve them until each is a single block.
  let open: { reader: number; lo: number; hi: number; balLo: bigint; balHi: bigint }[] = [];
  readers.forEach((_, reader) => {
    for (let i = 1; i < blocks.length; i++) {
      const balLo = sampled[reader * blocks.length + i - 1] as bigint;
      const balHi = sampled[reader * blocks.length + i] as bigint;
      if (balLo !== balHi) open.push({ reader, lo: blocks[i - 1] as number, hi: blocks[i] as number, balLo, balHi });
    }
  });
  const found: { reader: number; block: number; delta: bigint }[] = [];
  while (open.length > 0) {
    for (const g of open) if (g.hi - g.lo <= 1) found.push({ reader: g.reader, block: g.hi, delta: g.balHi - g.balLo });
    const wide = open.filter((g) => g.hi - g.lo > 1);
    if (wide.length === 0) break;
    if (wide.length > NODE_MAX_SPLITS) {
      // A very busy address: stop refining and report each remaining gap as one change at its end.
      for (const g of wide) found.push({ reader: g.reader, block: g.hi, delta: g.balHi - g.balLo });
      break;
    }
    const mids = wide.map((g) => g.lo + Math.floor((g.hi - g.lo) / 2));
    const balances = await balancesAt(wide.map((g, i) => ({ reader: g.reader, block: mids[i] as number })));
    open = [];
    wide.forEach((g, i) => {
      const mid = mids[i] as number;
      const bal = balances[i] as bigint;
      if (g.balLo !== bal) open.push({ reader: g.reader, lo: g.lo, hi: mid, balLo: g.balLo, balHi: bal });
      if (bal !== g.balHi) open.push({ reader: g.reader, lo: mid, hi: g.hi, balLo: bal, balHi: g.balHi });
    });
  }
  // Around each block where the actor sent something, look at every balance directly.
  const acted = [...new Set(found.filter((f) => f.reader === actorIndex).map((f) => f.block))];
  const seen = new Set(found.map((f) => `${f.reader}:${f.block}`));
  const asks = acted.length <= NODE_MAX_SPLITS
    ? acted.flatMap((block) => balanceReaders.map((_, reader) => ({ reader, block })).filter((a) => !seen.has(`${a.reader}:${a.block}`)))
    : [];
  if (asks.length > 0) {
    const pairs = await balancesAt(asks.flatMap((a) => [{ reader: a.reader, block: a.block - 1 }, a]));
    asks.forEach((a, i) => {
      const delta = (pairs[2 * i + 1] as bigint) - (pairs[2 * i] as bigint);
      if (delta !== 0n) found.push({ reader: a.reader, block: a.block, delta });
    });
  }
  const changes = found.filter((f) => f.reader !== actorIndex);
  const out: Change[][] = balanceReaders.map(() => []);
  if (changes.length === 0) return { changes: out, block: latest };

  // The real time of each change, from its block.
  const unique = [...new Set(changes.map((f) => f.block))];
  const heads = await nodeBatch(endpoints, unique.map((b) => ({ method: 'eth_getBlockByNumber', params: [blockTag(b), false] })));
  const timeOf = new Map(unique.map((b, i) => [b, Number(hexQuantity((heads[i] as { timestamp?: unknown }).timestamp))]));
  for (const f of changes) (out[f.reader] as Change[]).push({ time: timeOf.get(f.block) ?? 0, delta: f.delta, block: f.block });
  for (const list of out) list.sort((a, b) => b.time - a.time);
  return { changes: out, block: latest };
}

/** One coin's changes from the nodes. */
export async function fetchEvmCoinChangesFromNodes(
  endpoints: readonly string[],
  address: string,
  since: number,
  blockSeconds: number,
): Promise<Change[]> {
  const { changes } = await fetchChangesFromNodes(endpoints, [{ coin: address }], since, blockSeconds, address);
  return changes[0] ?? [];
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
const hash32 = (value: unknown): string | null => (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null);

/**
 * Find the transaction behind a change that is known only by its block: for a
 * token, the transfer to or from the owner in that block; for the coin, the
 * transaction the owner sent or received there. Money that arrived from inside
 * a contract leaves no such transaction, and nothing is returned for it.
 */
export async function findEvmTransaction(
  endpoints: readonly string[],
  /** `owners`: every address of the wallet, when its balance is spread over several. */
  op: { block: number; owner: string; owners?: readonly string[]; token?: string; incoming: boolean },
): Promise<{ tx: string; peer?: string } | null> {
  const tag = blockTag(op.block);
  if (op.token) {
    const own = new Set((op.owners ?? [op.owner]).map((o) => o.toLowerCase()));
    // One address is asked for by itself; several, as a list any of which may match.
    const mine = own.size === 1 ? topicOf(op.owners?.[0] ?? op.owner) : [...own].map(topicOf);
    const topics = op.incoming ? [TRANSFER_TOPIC, null, mine] : [TRANSFER_TOPIC, mine];
    const [logs] = await nodeBatch(endpoints, [{ method: 'eth_getLogs', params: [{ address: op.token, fromBlock: tag, toBlock: tag, topics }] }]);
    for (const log of (Array.isArray(logs) ? logs : []) as { transactionHash?: unknown; topics?: unknown }[]) {
      const tx = hash32(log.transactionHash);
      const other = Array.isArray(log.topics) ? hash32(log.topics[op.incoming ? 1 : 2]) : null;
      // Money moved between the wallet's own addresses is not the payment being looked for.
      if (other && own.size > 1 && own.has(`0x${other.slice(26).toLowerCase()}`)) continue;
      if (tx) return { tx, ...(other ? { peer: `0x${other.slice(26).toLowerCase()}` } : {}) };
    }
    return null;
  }
  const [block] = await nodeBatch(endpoints, [{ method: 'eth_getBlockByNumber', params: [tag, true] }]);
  const me = op.owner.toLowerCase();
  const list = (block as { transactions?: unknown }).transactions;
  for (const item of (Array.isArray(list) ? list : []) as { hash?: unknown; from?: unknown; to?: unknown }[]) {
    const tx = hash32(item.hash);
    const from = typeof item.from === 'string' ? item.from.toLowerCase() : '';
    const to = typeof item.to === 'string' ? item.to.toLowerCase() : '';
    if (!tx) continue;
    if (op.incoming && to === me) return { tx, ...(from ? { peer: from } : {}) };
    if (!op.incoming && from === me) return { tx, ...(to ? { peer: to } : {}) };
  }
  return null;
}
