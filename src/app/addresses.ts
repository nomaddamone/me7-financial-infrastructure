import { HDKey } from '@scure/bip32';
import { evmAddressFromPrivateKey, wipe } from '../core/index.ts';
import { signAuthorization, type SignedAuthorization, type TokenDomain } from '../core/gasless.ts';
import { isUsed, receiveIndex, type Holding, type Unsigned } from '../core/rotation.ts';
import { NET } from '../net/endpoints.ts';
import { scanHoldings } from '../net/rotation.ts';
import { STEALTH_INDEX, stealthFinds, stealthKeyAt, syncStealth } from './stealth.ts';
import type { Wallet } from './wallet.ts';

/**
 * The wallet's USDC addresses on Base: the main one (number 0, the same address
 * every other coin uses) and the ones after it on the seed's path, handed out
 * one at a time for receiving. Only addresses are kept here; a key is derived
 * for the moment of signing and wiped.
 */
export interface Rotation {
  /** Every address looked at, the main one first. Most of the tail is unused. */
  holdings: Holding[];
  total: bigint;
  /** Where to receive next: the first address never used. */
  receive: { index: number; address: string };
  /** A further unused address, for gathering money on before a payment. */
  fresh: { index: number; address: string };
}

/** How many unused addresses in a row end the search. A new one is only handed out once the last was paid to, so gaps stay small. */
const GAP = 20;
const PARENT = "m/44'/60'/0'/0";

const derived = new Map<string, string[]>();

/** Addresses number 0..count-1 of this wallet. Derived once and remembered for the session. */
function addressesUpTo(wallet: Wallet, count: number): string[] {
  const known = derived.get(wallet.evm) ?? [wallet.evm];
  if (known.length < count) {
    // A wallet opened without its seed (there is none in such a session) has only its main address.
    if (!(wallet.seed instanceof Uint8Array) || wallet.seed.length !== 64) return known;
    const parent = HDKey.fromMasterSeed(wallet.seed).derive(PARENT);
    for (let i = known.length; i < count; i++) {
      const child = parent.deriveChild(i);
      if (!child.privateKey) throw new Error('derivation produced no key');
      known.push(evmAddressFromPrivateKey(child.privateKey));
      child.wipePrivateData();
    }
    parent.wipePrivateData();
    derived.set(wallet.evm, known);
  }
  return known.slice(0, count);
}

const scans = new Map<string, { at: number; result: Promise<Rotation> }>();

async function scan(wallet: Wallet): Promise<Rotation> {
  const base = NET.base;
  if (!base) throw new Error('no Base network');
  let holdings: Holding[] = [];
  for (let count = GAP + 1; ; ) {
    const addresses = addressesUpTo(wallet, count).map((address, index) => ({ index, address }));
    holdings = [...holdings, ...(await scanHoldings(base.rpc, base.usdc, addresses.slice(holdings.length)))];
    const lastUsed = holdings.reduce((last, h) => (h.index > 0 && isUsed(h) ? Math.max(last, h.index) : last), 0);
    // Enough is known once a full gap of unused addresses follows the last used one (or the wallet has no more).
    if (holdings.length > lastUsed + GAP || addresses.length < count) break;
    count = lastUsed + GAP + 1;
  }
  const at = (index: number) => ({ index, address: holdings[index]?.address ?? wallet.evm });
  const receive = Math.min(receiveIndex(holdings), holdings.length - 1);
  const used = new Set(holdings.filter(isUsed).map((h) => h.index));
  let fresh = receive + 1;
  while (used.has(fresh)) fresh++;
  const result = { receive: at(receive), fresh: at(Math.min(fresh, holdings.length - 1)) };
  // Money that came by the stealth code sits on addresses of its own. They join the list after the
  // rotating ones, so nothing above mistakes them for the seed's path. If the chain cannot be read
  // for new ones just now, those already known are still counted.
  const finds = await syncStealth(wallet).catch(() => stealthFinds(wallet));
  if (finds.length > 0) {
    holdings = [...holdings, ...(await scanHoldings(base.rpc, base.usdc, finds.map((f, i) => ({ index: STEALTH_INDEX + i, address: f.address }))))];
  }
  return { holdings, total: holdings.reduce((sum, h) => sum + h.balance, 0n), ...result };
}

/** The wallet's addresses and what they hold. Answers within the last 15 seconds are reused unless `fresh` is asked for. */
export function loadRotation(wallet: Wallet, fresh = false): Promise<Rotation> {
  const hit = scans.get(wallet.evm);
  if (hit && !fresh && Date.now() - hit.at < 15_000) return hit.result;
  const result = scan(wallet);
  scans.set(wallet.evm, { at: Date.now(), result });
  result.then(
    (r) => lastOwners.set(wallet.evm, [...r.holdings.filter((h) => h.index < STEALTH_INDEX).slice(0, r.fresh.index + 2), ...r.holdings.filter((h) => h.index >= STEALTH_INDEX)].map((h) => h.address)),
    () => scans.delete(wallet.evm),
  );
  return result;
}

const lastOwners = new Map<string, string[]>();
/**
 * The addresses whose USDC makes up the wallet's balance, for reading its
 * history: every used one and the next few, so a payment to the address shown
 * for receiving is seen the moment it arrives.
 */
export async function rotationOwners(wallet: Wallet): Promise<string[]> {
  try {
    await loadRotation(wallet);
  } catch {
    /* the nodes are unreachable: fall back to what is known */
  }
  return lastOwners.get(wallet.evm) ?? [wallet.evm];
}

/** Sign permissions, each with the key of the address it takes money from. Keys are derived for this call and wiped. */
export function signWithAddresses(wallet: Wallet, domain: TokenDomain, unsigned: readonly Unsigned[]): SignedAuthorization[] {
  const parent = HDKey.fromMasterSeed(wallet.seed).derive(PARENT);
  const keys = new Map<number, Uint8Array>();
  try {
    return unsigned.map(({ index, ...auth }) => {
      let key = keys.get(index);
      if (!key && index >= STEALTH_INDEX) {
        // A stealth address: its key is the spending key plus what the payer's note gives.
        key = stealthKeyAt(wallet, index);
        keys.set(index, key);
      }
      if (!key) {
        const child = parent.deriveChild(index);
        if (!child.privateKey) throw new Error('derivation produced no key');
        key = Uint8Array.from(child.privateKey);
        child.wipePrivateData();
        keys.set(index, key);
      }
      if (evmAddressFromPrivateKey(key).toLowerCase() !== auth.from.toLowerCase()) throw new Error('address does not belong to this wallet');
      return signAuthorization(domain, auth, key);
    });
  } finally {
    wipe(...keys.values());
    parent.wipePrivateData();
  }
}
