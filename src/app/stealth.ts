import { STEALTH_INDEX } from '../core/rotation.ts';
import { matchAnnouncement, stealthKeys, stealthPrivateKey } from '../core/stealth.ts';
import { NET } from '../net/endpoints.ts';
import { fetchHeadBlock, scanStealth, type StealthFind } from '../net/stealth.ts';
import type { Wallet } from './wallet.ts';

/**
 * The wallet's stealth payments: which addresses were found to be its own, and how far along
 * the chain it has looked. Kept in this browser, like the contacts: the list ties addresses to
 * this account, so it is nobody else's to see. Losing it loses nothing: the chain is read again.
 *
 * A stealth address takes its place among the wallet's USDC addresses under a number of its
 * own (STEALTH_INDEX and up), so the two kinds are never confused.
 */
export { STEALTH_INDEX };

/** The block from which notes can concern this wallet: nobody could have paid by a code before the wallet showed one. */
const BIRTH = { mainnet: 58_000_000, testnet: 0 } as const;
/** On the test network the chain is not walked from its beginning: only what is recent is of use there. */
const TESTNET_REACH = 150_000;
/** The chain is looked at again no more often than this. */
const EVERY_MS = 30_000;

interface Store {
  /** The last block already read. */
  scannedTo: number;
  finds: StealthFind[];
}

const storeKey = (wallet: Wallet) => `me7.stealth.${NET.mode}.${wallet.evm.toLowerCase()}`;
const hasSeed = (wallet: Wallet) => wallet.seed instanceof Uint8Array && wallet.seed.length === 64;

function read(wallet: Wallet): Store | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storeKey(wallet)) ?? 'null');
    const s = raw as Partial<Store> | null;
    if (!s || typeof s.scannedTo !== 'number' || !Array.isArray(s.finds)) return null;
    const finds = s.finds.filter(
      (f): f is StealthFind => !!f && typeof f.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(f.address) && typeof f.ephemeralPubKey === 'string' && /^0x[0-9a-f]{66}$/.test(f.ephemeralPubKey) && typeof f.block === 'number',
    );
    return { scannedTo: s.scannedTo, finds };
  } catch {
    return null;
  }
}

function write(wallet: Wallet, store: Store): void {
  try {
    localStorage.setItem(storeKey(wallet), JSON.stringify(store));
  } catch {
    /* no storage: the chain is simply read again next time */
  }
}

/** The stealth payments found so far, oldest first. Their places in this list are their numbers above STEALTH_INDEX. */
export function stealthFinds(wallet: Wallet): StealthFind[] {
  return read(wallet)?.finds ?? [];
}

const last = new Map<string, { at: number; run: Promise<StealthFind[]> }>();

/**
 * Read the notes left since the last look and add this wallet's to the list. A wallet opened
 * without its seed (a Ledger session) has no stealth keys and finds nothing. If the nodes do
 * not answer, the list stays as it was and the place is kept, so no block is ever skipped.
 */
export function syncStealth(wallet: Wallet, onProgress?: (done: number, total: number) => void): Promise<StealthFind[]> {
  const base = NET.base;
  if (!base || !hasSeed(wallet)) return Promise.resolve([]);
  const key = storeKey(wallet);
  const hit = last.get(key);
  if (hit && Date.now() - hit.at < EVERY_MS) return hit.run;
  const run = (async () => {
    const head = await fetchHeadBlock(base.rpc);
    const store = read(wallet) ?? { scannedTo: (NET.mode === 'mainnet' ? BIRTH.mainnet : Math.max(BIRTH.testnet, head - TESTNET_REACH)) - 1, finds: [] };
    if (head <= store.scannedTo) return store.finds;
    const keys = stealthKeys(wallet.seed);
    const found = await scanStealth(base.rpc, keys, store.scannedTo + 1, head, onProgress);
    const known = new Set(store.finds.map((f) => f.address.toLowerCase()));
    // The same address announced twice is one address: it is listed once.
    const fresh = found.filter((f) => !known.has(f.address.toLowerCase()) && known.add(f.address.toLowerCase()));
    const next = { scannedTo: head, finds: [...store.finds, ...fresh] };
    write(wallet, next);
    return next.finds;
  })();
  last.set(key, { at: Date.now(), run });
  run.catch(() => last.delete(key));
  return run;
}

/**
 * The private key of one of the wallet's stealth addresses, by its number. Worked out from the
 * note's key afresh each time, and checked by the caller against the address it must sign for.
 */
export function stealthKeyAt(wallet: Wallet, index: number): Uint8Array {
  const find = stealthFinds(wallet)[index - STEALTH_INDEX];
  if (!find || !hasSeed(wallet)) throw new Error('not a stealth address of this wallet');
  const keys = stealthKeys(wallet.seed);
  const ephemeral = Uint8Array.from(find.ephemeralPubKey.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
  const match = matchAnnouncement(keys, ephemeral);
  if (!match || match.address.toLowerCase() !== find.address.toLowerCase()) throw new Error('not a stealth address of this wallet');
  return stealthPrivateKey(keys.spend, match.tweak);
}
