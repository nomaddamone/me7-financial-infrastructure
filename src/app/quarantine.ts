import { QUARANTINE_MIN, quarantineMarks, sendersToScreen, type Incoming, type Mark, type Taint } from '../core/quarantine.ts';
import { NET, SANCTIONS_ORACLE } from '../net/endpoints.ts';
import { fetchIncomingAt, screenSenders } from '../net/quarantine.ts';
import { fetchTrc20Frozen } from '../net/tron.ts';
import { forgetRotation, rotationOwners } from './addresses.ts';
import { usdcArrivalBlocks, usdtTronArrivals } from './portfolio.ts';
import { stealthFinds } from './stealth.ts';
import type { Wallet } from './wallet.ts';

/**
 * The wallet's quarantined addresses (see src/core/quarantine.ts for what that means and why).
 *
 * The check runs in the background after the wallet opens. It reads who paid to the wallet's
 * addresses and asks the lists about those senders; everything it asks goes to the same nodes the
 * wallet already reads, so no address is shown to anyone new. What it has learnt is kept in this
 * browser: the payments that arrived (public chain data), and the marks. Senders are asked about
 * again on every look, because a sender can be listed after it has paid.
 */
export type Chain = 'base' | 'tron';
export interface Quarantined extends Omit<Mark, 'amount' | 'why'> {
  chain: Chain;
  amount: string;
  /** 'service': me7's service refused the address as quarantined, and the wallet has not found the payment itself. */
  why: Taint | 'service';
}

interface Store {
  /** Base blocks already read for who paid in them. */
  blocks: number[];
  /** USDC that arrived from outside, newest last. */
  incoming: { to: string; from: string; amount: string; block: number; tx: string }[];
  marks: Quarantined[];
  /** What me7's service said: kept as it is, whatever the wallet's own look finds. */
  told?: Quarantined[];
}

const storeKey = (wallet: Wallet) => `me7.quarantine.${NET.mode}.${wallet.evm.toLowerCase()}`;
const EMPTY: Store = { blocks: [], incoming: [], marks: [] };
const isText = (v: unknown): v is string => typeof v === 'string';
const TAINTS: readonly string[] = ['sanctioned', 'frozen', 'scam', 'service'];

function read(wallet: Wallet): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(wallet)) ?? 'null') as Partial<Store> | null;
    if (!raw || !Array.isArray(raw.blocks) || !Array.isArray(raw.incoming) || !Array.isArray(raw.marks)) return EMPTY;
    const isMark = (m: Quarantined) => !!m && (m.chain === 'base' || m.chain === 'tron') && isText(m.address) && TAINTS.includes(m.why) && isText(m.from) && isText(m.amount) && /^[0-9]+$/.test(m.amount) && isText(m.tx);
    return {
      told: Array.isArray(raw.told) ? raw.told.filter(isMark) : [],
      blocks: raw.blocks.filter((b) => Number.isSafeInteger(b)),
      incoming: raw.incoming.filter((p) => !!p && isText(p.to) && isText(p.from) && isText(p.amount) && /^[0-9]+$/.test(p.amount) && Number.isSafeInteger(p.block) && isText(p.tx)),
      marks: raw.marks.filter(isMark),
    };
  } catch {
    return EMPTY;
  }
}

function write(wallet: Wallet, store: Store): void {
  try {
    localStorage.setItem(storeKey(wallet), JSON.stringify({ ...store, blocks: store.blocks.slice(-2000), incoming: store.incoming.slice(-2000) }));
  } catch {
    /* no storage: the chain is read again next time */
  }
}

/** The addresses in quarantine, as last found. Read at once, without the network. */
export function quarantined(wallet: Wallet): Quarantined[] {
  const store = read(wallet);
  const own = store.marks;
  // What the wallet found itself says more than the service's bare refusal.
  return [...own, ...(store.told ?? []).filter((m) => !own.some((o) => o.chain === m.chain && o.address === m.address))];
}

/** me7's service refused this address as quarantined: it is marked here too, so that the wallet stops paying from it. */
export function markTold(wallet: Wallet, chain: Chain, address: string): void {
  const store = read(wallet);
  const key = chain === 'base' ? address.toLowerCase() : address;
  if ((store.told ?? []).some((m) => m.chain === chain && m.address === key)) return;
  write(wallet, { ...store, told: [...(store.told ?? []), { chain, address: key, why: 'service', from: '', amount: '0', tx: '' }] });
  forgetRotation(wallet);
}
/** The mark on this address, if it is in quarantine. */
export function quarantineOf(wallet: Wallet, chain: Chain, address: string): Quarantined | null {
  const key = chain === 'base' ? address.toLowerCase() : address;
  return quarantined(wallet).find((m) => m.chain === chain && m.address === key) ?? null;
}

const stored = (chain: Chain, m: Mark): Quarantined => ({ ...m, chain, amount: m.amount.toString() });

async function baseMarks(wallet: Wallet, now: number, store: Store): Promise<{ blocks: number[]; incoming: Store['incoming']; marks: Quarantined[] }> {
  const base = NET.base;
  if (!base) return { blocks: store.blocks, incoming: store.incoming, marks: [] };
  const owners = (await rotationOwners(wallet)).map((o) => o.toLowerCase());
  // Where money arrived: the blocks the history found, and the blocks of the stealth payments.
  const known = new Set(store.blocks);
  const blocks = [...new Set([...(await usdcArrivalBlocks(wallet, now)), ...stealthFinds(wallet).map((f) => f.block)])].filter((b) => !known.has(b)).sort((a, b) => a - b);
  // At most this many at a time: the rest waits for the next look.
  const part = blocks.slice(0, 60);
  const fresh = await fetchIncomingAt(base.rpc, base.usdc, owners, part);
  const incoming = [...store.incoming, ...fresh.map((p) => ({ to: p.to, from: p.from, amount: p.amount.toString(), block: p.block ?? 0, tx: p.tx ?? '' }))];
  const all: Incoming[] = incoming.map((p) => ({ to: p.to, from: p.from, amount: BigInt(p.amount), block: p.block, tx: p.tx }));
  const senders = sendersToScreen(all);
  const flagged = senders.length > 0 ? await screenSenders(base.rpc, base.usdc, SANCTIONS_ORACLE, senders) : new Map<string, Taint>();
  return { blocks: [...store.blocks, ...part], incoming, marks: quarantineMarks(all, flagged).map((m) => stored('base', m)) };
}

/** USDT on the wallet's main Tron address: the issuer's own freeze list is asked about each sender worth asking about. */
const TRON_MOST_SENDERS = 20;
async function tronMarks(wallet: Wallet, now: number): Promise<Quarantined[]> {
  const arrivals = await usdtTronArrivals(wallet, now);
  const all: Incoming[] = arrivals.map((c) => ({ to: wallet.tron, from: c.peer ?? '', amount: c.delta, ...(c.tx ? { tx: c.tx } : {}) }));
  const flagged = new Map<string, Taint>();
  // One at a time: the public nodes turn away a burst.
  for (const sender of sendersToScreen(all, QUARANTINE_MIN).slice(0, TRON_MOST_SENDERS)) {
    if (await fetchTrc20Frozen(NET.tron.nodes, NET.tron.usdt, sender)) flagged.set(sender, 'frozen');
  }
  return quarantineMarks(all, flagged).map((m) => stored('tron', m));
}

const runs = new Map<string, { at: number; run: Promise<Quarantined[]> }>();
const EVERY_MS = 120_000;

/**
 * Look again at who paid to the wallet's addresses, and return the marks. A chain that cannot be
 * read just now keeps the marks it had: a mark is never dropped for want of an answer.
 */
export function syncQuarantine(wallet: Wallet, now: number = Math.floor(Date.now() / 1000)): Promise<Quarantined[]> {
  const key = storeKey(wallet);
  const hit = runs.get(key);
  if (hit && Date.now() - hit.at < EVERY_MS) return hit.run;
  const run = (async () => {
    const before = read(wallet);
    const [base, tron] = await Promise.allSettled([baseMarks(wallet, now, before), tronMarks(wallet, now)]);
    const kept = (chain: Chain) => before.marks.filter((m) => m.chain === chain);
    const marks = [...(base.status === 'fulfilled' ? base.value.marks : kept('base')), ...(tron.status === 'fulfilled' ? tron.value : kept('tron'))];
    write(wallet, { ...(before.told ? { told: before.told } : {}), blocks: base.status === 'fulfilled' ? base.value.blocks : before.blocks, incoming: base.status === 'fulfilled' ? base.value.incoming : before.incoming, marks });
    // The wallet stops paying from an address the moment it is marked, and starts again the moment the mark is gone.
    const was = before.marks.map((m) => `${m.chain}:${m.address}`).sort().join();
    if (marks.map((m) => `${m.chain}:${m.address}`).sort().join() !== was) forgetRotation(wallet);
    return marks;
  })();
  runs.set(key, { at: Date.now(), run });
  run.catch(() => runs.delete(key));
  return run;
}
