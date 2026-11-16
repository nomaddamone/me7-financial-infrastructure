import { deriveKey, tronAddressFromPrivateKey, tronPath, wipe } from '../core/index.ts';
import { buildTrc20Transfer, signTronTransaction, tronRef } from '../core/tron.ts';
import { NET, TRON_GASLESS } from '../net/endpoints.ts';
import { fetchTronQuote, relayTronSend } from '../net/relay.ts';
import { fetchTrc20Balance, fetchTronAccount, fetchTronBlock } from '../net/tron.ts';
import { withTronKey, type Wallet } from './wallet.ts';

/**
 * Crossings: payments of USDT on Tron made out of USDC on Base. Each one goes through a Tron
 * address of this wallet used that once (number 1 and up on the seed's Tron path; number 0 is
 * the wallet's main Tron address), so the one who is paid sees an address with no past.
 *
 * A crossing takes a minute or two and has two halves: the USDC leaves, then the USDT that
 * arrived is paid on. What is under way is written down in this browser before the first half
 * is sent, so a closed tab loses nothing: the wallet picks the crossing up where it stopped.
 * The list ties addresses to this account, so, like the list of stealth payments, it stays here.
 */
export interface Crossing {
  id: string;
  /** The number of the Tron address the USDT arrives on, and the address itself. */
  index: number;
  address: string;
  /** Who is paid in the end, and how much USDT, in its units. */
  to: string;
  amount: string;
  /** How much USDT was ordered onto the address: the payment and the fee of sending it on. */
  budget: string;
  /** The service's address the USDC went to, how much, and the transaction that carried it (empty until sent). */
  deposit: string;
  usdcIn: string;
  baseTx: string;
  /** Unix milliseconds: when it was started, and when the service must have delivered or refunded. */
  started: number;
  deadline: number;
  /** 'open' until the last payment is made; 'paid' and 'refunded' are final. */
  stage: 'open' | 'paid' | 'refunded';
  /** The id of the Tron transaction that paid the recipient. */
  payTx: string;
}

interface Store {
  /** The next Tron address number to try. */
  next: number;
  list: Crossing[];
}

const storeKey = (wallet: Wallet) => `me7.cross.${NET.mode}.${wallet.evm.toLowerCase()}`;
const hasSeed = (wallet: Wallet) => wallet.seed instanceof Uint8Array && wallet.seed.length === 64;
const isText = (v: unknown): v is string => typeof v === 'string';

function read(wallet: Wallet): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(wallet)) ?? 'null') as Partial<Store> | null;
    if (!raw || typeof raw.next !== 'number' || !Array.isArray(raw.list)) return { next: 1, list: [] };
    const list = raw.list.filter(
      (c): c is Crossing =>
        !!c && isText(c.id) && Number.isSafeInteger(c.index) && c.index >= 1 && isText(c.address) && isText(c.to) && /^[0-9]+$/.test(c.amount) && /^[0-9]+$/.test(c.budget) && isText(c.deposit) && isText(c.baseTx) && isText(c.payTx) && (c.stage === 'open' || c.stage === 'paid' || c.stage === 'refunded'),
    );
    return { next: Math.max(1, Math.floor(raw.next)), list };
  } catch {
    return { next: 1, list: [] };
  }
}

function write(wallet: Wallet, store: Store): boolean {
  try {
    localStorage.setItem(storeKey(wallet), JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Every crossing this browser knows of, oldest first. */
export const loadCrossings = (wallet: Wallet): Crossing[] => read(wallet).list;
/** Those still under way. */
export const openCrossings = (wallet: Wallet): Crossing[] => read(wallet).list.filter((c) => c.stage === 'open');

/** Write a crossing down, new or changed. False when the browser would not keep it: then nothing must be sent. */
export function saveCrossing(wallet: Wallet, crossing: Crossing): boolean {
  const store = read(wallet);
  const at = store.list.findIndex((c) => c.id === crossing.id);
  const list = at < 0 ? [...store.list, crossing] : store.list.map((c, i) => (i === at ? crossing : c));
  // The finished ones are kept, the last fifty of them: they are the only record of which address paid whom.
  return write(wallet, { next: Math.max(store.next, crossing.index + 1), list: list.slice(-50) });
}

/** Forget a crossing of which nothing was ever sent. Its address number is not handed out again all the same. */
export function dropCrossing(wallet: Wallet, id: string): void {
  const store = read(wallet);
  write(wallet, { ...store, list: store.list.filter((c) => c.id !== id) });
}

/** The wallet's Tron address number `index`. */
export function tronAddressAt(wallet: Wallet, index: number): string {
  const key = deriveKey(wallet.seed, tronPath(index));
  try {
    return tronAddressFromPrivateKey(key.privateKey);
  } finally {
    wipe(key.privateKey);
  }
}

/**
 * A Tron address of this wallet that nothing has ever touched: the next number this browser has
 * not used, checked against the chain, because another device (or this one before its storage
 * was cleared) may have used it. Throws for a session without the seed, or when the nodes are silent.
 */
export async function freshTronAddress(wallet: Wallet): Promise<{ index: number; address: string }> {
  if (!hasSeed(wallet)) throw new Error('no seed in this session');
  for (let index = read(wallet).next, tries = 0; tries < 30; index++, tries++) {
    const address = tronAddressAt(wallet, index);
    const [account, held] = await Promise.all([fetchTronAccount(NET.tron.nodes, address), fetchTrc20Balance(NET.tron.nodes, NET.tron.usdt, address)]);
    if (!account.exists && held === 0n) return { index, address };
  }
  throw new Error('no unused address found');
}

/** How much USDT sits on a crossing's address right now. */
export const crossingBalance = (crossing: Crossing): Promise<bigint> => fetchTrc20Balance(NET.tron.nodes, NET.tron.usdt, crossing.address);

export interface OnwardPayment {
  /** What the recipient gets and what the service takes, in USDT's units. */
  amount: bigint;
  fee: bigint;
  receiver: string;
  /** How much the address holds, and how much short of the full payment it is (zero when it is enough). */
  held: bigint;
  short: bigint;
}

/**
 * What paying a crossing on would take now that its USDT has arrived: the real fee, asked from
 * me7's service for the address as it stands. If the fee has grown past what was ordered, the
 * payment that can still be made is smaller by `short`, and the user decides.
 */
export async function planOnward(crossing: Crossing): Promise<OnwardPayment> {
  const held = await crossingBalance(crossing);
  const want = BigInt(crossing.amount);
  // The lower fee belongs to the payment a crossing was made for; money taken back from an address later pays the ordinary one.
  const quote = await fetchTronQuote(crossing.address, crossing.to, want < held ? want : held, false, crossing.deposit !== '');
  const can = held - quote.fee;
  const amount = can >= want ? want : can > 0n ? can : 0n;
  return { amount, fee: quote.fee, receiver: quote.receiver, held, short: want - amount };
}

/** Pay a crossing on: the payment and its fee are signed with the one-time address's key and handed to me7's service. Returns the payment's transaction id. */
export async function payOnward(wallet: Wallet, crossing: Crossing, pay: OnwardPayment): Promise<string> {
  if (pay.amount <= 0n || pay.amount + pay.fee > pay.held) throw new Error('not enough on the address');
  const block = await fetchTronBlock(NET.tron.nodes);
  const ref = { ...tronRef(block, Date.now()), expiration: block.timestamp + TRON_GASLESS.lifetime };
  const main = buildTrc20Transfer(crossing.address, NET.tron.usdt, crossing.to, pay.amount, ref, TRON_GASLESS.feeLimit);
  const fee = buildTrc20Transfer(crossing.address, NET.tron.usdt, pay.receiver, pay.fee, ref, TRON_GASLESS.feeLimit);
  return withTronKey(
    wallet,
    (key) => {
      // The number must be the number of this very address: a wrong one would sign for nothing.
      if (tronAddressFromPrivateKey(key) !== crossing.address) throw new Error('not the key of this address');
      return relayTronSend(signTronTransaction(main, key).signedHex, signTronTransaction(fee, key).signedHex, crossing.deposit || undefined);
    },
    crossing.index,
  );
}

/** One of the wallet's one-time Tron addresses: what it holds now, and the crossing it was made for, if this browser remembers it. */
export interface OneTime {
  index: number;
  address: string;
  held: bigint;
  crossing: Crossing | null;
}

/** How many untouched addresses in a row end the search. Numbers are handed out one after another, so gaps are small. */
const GAP = 3;
const MOST = 40;
const found = new Map<string, { at: number; run: Promise<OneTime[]> }>();

/**
 * Every one-time Tron address of this wallet that was ever used, newest first, with what it holds.
 * They are found from the seed and the chain, not from this browser's notes, so they show on any
 * device: the numbers are walked from 1 until a few in a row turn out untouched. A remainder stays
 * on such an address after a payment (the reserve for the fee), and the wallet must show it.
 */
export function oneTimeAddresses(wallet: Wallet, fresh = false): Promise<OneTime[]> {
  if (!hasSeed(wallet)) return Promise.resolve([]);
  const key = storeKey(wallet);
  const hit = found.get(key);
  if (hit && !fresh && Date.now() - hit.at < 60_000) return hit.run;
  const run = (async () => {
    const store = read(wallet);
    const noted = new Map(store.list.map((c) => [c.index, c]));
    const last = Math.max(0, ...noted.keys());
    const list: OneTime[] = [];
    // One at a time: the public nodes turn away a burst of questions.
    for (let index = 1, untouched = 0; index <= MOST && (index <= last || untouched < GAP); index++) {
      const address = tronAddressAt(wallet, index);
      const crossing = noted.get(index) ?? null;
      const held = await fetchTrc20Balance(NET.tron.nodes, NET.tron.usdt, address);
      const used = crossing !== null || held > 0n || (await fetchTronAccount(NET.tron.nodes, address)).exists;
      untouched = used ? 0 : untouched + 1;
      if (used) list.push({ index, address, held, crossing });
    }
    // A number found used on the chain is never handed out again, whatever this browser remembered.
    const top = Math.max(0, ...list.map((o) => o.index));
    if (top >= store.next) write(wallet, { ...read(wallet), next: top + 1 });
    return list.reverse();
  })();
  found.set(key, { at: Date.now(), run });
  run.catch(() => found.delete(key));
  return run;
}

/**
 * What remains on a one-time address, taken back to the wallet's main Tron address: the same two
 * signed transfers as any payment from it, at the service's ordinary fee.
 */
export function takeBack(wallet: Wallet, one: OneTime): Crossing {
  return { id: `back-${one.index}`, index: one.index, address: one.address, to: wallet.tron, amount: one.held.toString(), budget: one.held.toString(), deposit: '', usdcIn: '0', baseTx: '', started: Date.now(), deadline: Date.now(), stage: 'open', payTx: '' };
}
