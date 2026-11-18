import { rotationOwners } from './addresses.ts';
import { formatUnits } from '../net/balances.ts';
import { NET } from '../net/endpoints.ts';
import {
  balanceSeries,
  fetchBitcoinChanges,
  fetchErc20ChangesAll,
  fetchEvmCoinChanges,
  fetchChangesFromNodes,
  fetchPriceHistory,
  fetchTrc20Changes,
  fetchTronChanges,
  type Change,
  type Period,
  type PriceHistory,
} from '../net/history.ts';
import { ASSETS, type AssetDef } from './assets.ts';
import type { Wallet } from './wallet.ts';

export interface HistoryPoint {
  /** Unix seconds. */
  time: number;
  /** Value in US dollars. */
  value: number;
}

export interface History extends PriceHistory {
  /** Balance changes of each asset within the period, by asset id. */
  changes: Record<string, Change[]>;
  /** True when some asset's past could not be fetched; that asset is drawn at today's balance. */
  partial: boolean;
}

/**
 * The tokens on Ethereum are read in one pass for all of them (see fetchErc20ChangesAll), and the answer is shared
 * by every token's curve for a minute. A longer period than the one already read is read anew.
 */
const ETH_TOKENS = ASSETS.flatMap((a) => (a.kind === 'erc20' && a.chain !== 'base' && a.contract ? [a.contract] : []));
const ethTokenCache = new Map<string, { at: number; since: number; all: Promise<Record<string, Change[]>> }>();
function ethTokenChanges(a: AssetDef, wallet: Wallet, since: number): Promise<Change[]> {
  let hit = ethTokenCache.get(wallet.evm);
  if (!hit || hit.since > since || Date.now() - hit.at > 60_000) {
    const all = fetchErc20ChangesAll(NET.evm.history, wallet.evm, ETH_TOKENS, since);
    hit = { at: Date.now(), since, all };
    ethTokenCache.set(wallet.evm, hit);
    all.catch(() => ethTokenCache.delete(wallet.evm));
  }
  return hit.all.then((byToken) => (byToken[(a.contract ?? '').toLowerCase()] ?? []).filter((c) => c.time >= since));
}

function changesOf(a: AssetDef, wallet: Wallet, since: number): Promise<Change[]> {
  switch (a.kind) {
    case 'eth':
      return fetchEvmCoinChanges(NET.evm.history, wallet.evm, since);
    case 'erc20':
      return ethTokenChanges(a, wallet, since);
    case 'btc':
      return fetchBitcoinChanges(NET.btc.esplora, wallet.btc, since);
    case 'trx':
      return fetchTronChanges(NET.tron.history, wallet.tron, since);
    case 'trc20':
      return fetchTrc20Changes(NET.tron.history, wallet.tron, a.contract ?? '', since);
  }
}

/**
 * Addresses this wallet has paid to, kept in this browser: what a look-alike address is told
 * from (see src/core/lookalike.ts). Filled from the history as it loads and from each transfer sent.
 */
const PAID_MAX = 200;
const paidKey = (wallet: Wallet) => `me7.paid.${wallet.evm.toLowerCase()}`;
export function paidAddresses(wallet: Wallet): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(paidKey(wallet)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(0, PAID_MAX) : [];
  } catch {
    return [];
  }
}
export function rememberPaid(wallet: Wallet, addresses: readonly string[]): void {
  const fresh = addresses.filter((a) => a && a.length <= 120);
  if (fresh.length === 0) return;
  try {
    const next = [...new Set([...fresh, ...paidAddresses(wallet)])].slice(0, PAID_MAX);
    localStorage.setItem(paidKey(wallet), JSON.stringify(next));
  } catch {
    /* no storage: the check then knows only the contacts */
  }
}

/** Recently loaded histories, so flipping between periods doesn't hit the sources again. */
const CACHE_SECONDS = 60;
const cache = new Map<string, { at: number; history: Promise<History> }>();

/**
 * TronGrid refuses keyless clients that ask more than about once a second. So
 * Tron history is fetched once, for a whole year, reused for every period for
 * five minutes, and its two requests are spaced apart.
 */
const TRON_CACHE_SECONDS = 300;
const TRON_GAP_MS = 1300;
const YEAR_SECONDS = 31536000;
const tronCache = new Map<string, { at: number; changes: Promise<Change[]> }>();
let tronQueue: Promise<unknown> = Promise.resolve();

function tronChanges(a: AssetDef, wallet: Wallet, now: number): Promise<Change[]> {
  const key = `${a.id}:${wallet.tron}`;
  const hit = tronCache.get(key);
  if (hit && now - hit.at < TRON_CACHE_SECONDS) return hit.changes;
  const changes = tronQueue.then(() => changesOf(a, wallet, now - YEAR_SECONDS));
  tronQueue = changes.catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve, TRON_GAP_MS)));
  tronCache.set(key, { at: now, changes });
  changes.catch(() => tronCache.delete(key));
  return changes;
}

/**
 * Base's explorer cannot be relied on (it has no coin history for some addresses
 * and misses incoming tokens), so the past of every Base asset is read from the
 * nodes, in one pass for all of them. The first pass over a year takes a quarter
 * of a minute, so what it finds is kept on the device (it is public chain data)
 * and later passes only read the blocks that came after.
 */
const BASE_ASSETS = ASSETS.filter((a) => a.chain === 'base');
const BASE_RECHECK_SECONDS = 60;
const baseCache = new Map<string, { at: number; changes: Promise<Record<string, Change[]>> }>();
// The "2" marks entries that carry their block; what an earlier version kept is read afresh.
const baseKey = (owner: string) => `me7.history2.base.${owner.toLowerCase()}`;

interface StoredBase {
  block: number;
  assets: Record<string, Change[]>;
}
function loadStoredBase(owner: string): StoredBase | null {
  try {
    const raw = JSON.parse(localStorage.getItem(baseKey(owner)) ?? 'null') as { block?: unknown; assets?: Record<string, unknown> } | null;
    if (!raw || !Number.isSafeInteger(raw.block) || typeof raw.assets !== 'object' || raw.assets === null) return null;
    const assets: Record<string, Change[]> = {};
    for (const [id, list] of Object.entries(raw.assets)) {
      if (!Array.isArray(list)) return null;
      assets[id] = (list as unknown[]).map((item) => {
        const [time, delta, block] = item as [unknown, unknown, unknown];
        if (!Number.isSafeInteger(time) || typeof delta !== 'string' || !/^-?\d+$/.test(delta)) throw new Error('bad entry');
        return { time: time as number, delta: BigInt(delta), ...(Number.isSafeInteger(block) ? { block: block as number } : {}) };
      });
    }
    return { block: raw.block as number, assets };
  } catch {
    return null;
  }
}
function saveStoredBase(owner: string, stored: StoredBase): void {
  try {
    const assets = Object.fromEntries(Object.entries(stored.assets).map(([id, list]) => [id, list.map((c) => [c.time, c.delta.toString(), ...(c.block === undefined ? [] : [c.block])])]));
    localStorage.setItem(baseKey(owner), JSON.stringify({ block: stored.block, assets }));
  } catch {
    /* private mode: the next visit reads the year again */
  }
}

async function readBase(wallet: Wallet, now: number): Promise<Record<string, Change[]>> {
  const base = NET.base;
  if (!base) return {};
  const stored = loadStoredBase(wallet.evm);
  try {
    localStorage.removeItem(`me7.history.base.${wallet.evm.toLowerCase()}`);
  } catch {
    /* nothing to clean up */
  }
  // What is kept is only usable if it covers every asset shown today.
  const known = stored && BASE_ASSETS.every((a) => stored.assets[a.id]) ? stored : null;
  // USDC is spread over the wallet's receiving addresses; its history is the history of their sum.
  const owners = await rotationOwners(wallet);
  const readers = BASE_ASSETS.map((x) =>
    x.kind !== 'erc20' ? { coin: wallet.evm } : x.contract === base.usdc && owners.length > 1 ? { token: x.contract, owners } : { token: x.contract ?? '', owner: wallet.evm },
  );
  const fresh = await fetchChangesFromNodes(base.rpc, readers, now - YEAR_SECONDS, base.blockSeconds, wallet.evm, known?.block);
  const assets: Record<string, Change[]> = {};
  BASE_ASSETS.forEach((a, i) => {
    assets[a.id] = [...(fresh.changes[i] ?? []), ...(known?.assets[a.id] ?? [])].filter((c) => c.time >= now - YEAR_SECONDS);
  });
  saveStoredBase(wallet.evm, { block: fresh.block, assets });
  return assets;
}

function baseChanges(a: AssetDef, wallet: Wallet, now: number): Promise<Change[]> {
  let hit = baseCache.get(wallet.evm);
  if (!hit || now - hit.at >= BASE_RECHECK_SECONDS) {
    const changes = readBase(wallet, now);
    hit = { at: now, changes };
    baseCache.set(wallet.evm, hit);
    changes.catch(() => baseCache.delete(wallet.evm));
  }
  return hit.changes.then((all) => all[a.id] ?? []);
}

async function load(wallet: Wallet, period: Period, now: number): Promise<History> {
  const since = now - period.seconds;
  const tasks = ASSETS.map((a) =>
    a.kind === 'trx' || a.kind === 'trc20'
      ? tronChanges(a, wallet, now)
      : a.chain === 'base'
        ? baseChanges(a, wallet, now)
        : changesOf(a, wallet, since),
  );
  const [prices, results] = await Promise.all([fetchPriceHistory(period, now), Promise.allSettled(tasks)]);
  const changes: Record<string, Change[]> = {};
  let partial = false;
  results.forEach((r, i) => {
    const a = ASSETS[i];
    if (!a) return;
    changes[a.id] = r.status === 'fulfilled' ? r.value : [];
    if (r.status === 'rejected') partial = true;
  });
  rememberPaid(wallet, Object.values(changes).flatMap((list) => list.flatMap((c) => (c.delta < 0n && c.peer ? [c.peer] : []))));
  return { ...prices, changes, partial };
}

/** Everything needed to draw the curves for a period: prices over time and each asset's balance changes. */
export function loadHistory(wallet: Wallet, period: Period, now: number): Promise<History> {
  const key = `${wallet.evm}:${period.id}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_SECONDS) return hit.history;
  const history = load(wallet, period, now);
  cache.set(key, { at: now, history });
  // A failed or incomplete load is not worth keeping: the next look should try again.
  history.then(
    (h) => {
      if (h.partial) cache.delete(key);
    },
    () => cache.delete(key),
  );
  return history;
}

/**
 * The account's total value at each moment of the period: what it held then,
 * at what that cost then. The last point is the present.
 */
export function portfolioSeries(
  history: History,
  balances: Readonly<Record<string, bigint | null | undefined>>,
  now: number,
  totalNow: number,
): HistoryPoint[] {
  const values = new Array<number>(history.times.length).fill(0);
  for (const a of ASSETS) {
    const current = balances[a.id];
    if (current === null || current === undefined) continue;
    const held = balanceSeries(current, history.changes[a.id] ?? [], history.times);
    const prices = history.prices[a.price];
    held.forEach((units, i) => {
      if (units > 0n) values[i] = (values[i] ?? 0) + Number(formatUnits(units, a.decimals, a.decimals)) * (prices[i] ?? 0);
    });
  }
  const points = history.times.map((time, i) => ({ time, value: values[i] ?? 0 })).filter((p) => p.time < now);
  points.push({ time: now, value: totalNow });
  return points;
}

/**
 * For the quarantine check: the blocks in which USDC arrived on the wallet's Base addresses within
 * the last year, and the USDT that arrived on its main Tron address with who sent it. Both come
 * from the same reading that draws the curves, so the check asks the sources nothing twice.
 */
export async function usdcArrivalBlocks(wallet: Wallet, now: number): Promise<number[]> {
  const usdc = BASE_ASSETS.find((a) => a.contract === NET.base?.usdc);
  if (!usdc) return [];
  const changes = await baseChanges(usdc, wallet, now);
  return [...new Set(changes.flatMap((c) => (c.delta > 0n && c.block !== undefined ? [c.block] : [])))];
}
export async function usdtTronArrivals(wallet: Wallet, now: number): Promise<Change[]> {
  const usdt = ASSETS.find((a) => a.kind === 'trc20' && a.contract === NET.tron.usdt);
  if (!usdt) return [];
  return (await tronChanges(usdt, wallet, now)).filter((c) => c.delta > 0n && !!c.peer);
}
