import { NET } from '../net/endpoints.ts';
import { PassError, updatePass, type PassAsk } from '../net/pass.ts';
import { loadRotation, type Rotation } from './addresses.ts';
import { askedIndices } from './requests.ts';
import { STEALTH_INDEX } from './stealth.ts';
import type { Wallet } from './wallet.ts';

/**
 * What this device remembers of the wallet's card in Apple Wallet: the card's number and secret, by which the
 * wallet manages it at me7's service, and which addresses were opened for it. Kept on this device only.
 */
export interface KeptPass {
  serial: string;
  token: string;
  /** Whether the card watches the main address alone or all of the pocket's addresses. */
  all: boolean;
  addresses: string[];
}

/** The most addresses a card may watch: the service's own limit. */
export const PASS_ADDRESSES = 20;

const key = (wallet: { evm: string }) => `me7.pass.${NET.mode}.${wallet.evm.toLowerCase()}`;

export function loadPass(wallet: { evm: string }): KeptPass | null {
  try {
    const p = JSON.parse(localStorage.getItem(key(wallet)) ?? 'null') as Partial<KeptPass> | null;
    if (!p || typeof p.serial !== 'string' || typeof p.token !== 'string' || !/^[0-9a-f]{32}$/.test(p.serial) || !/^[0-9a-f]{40,64}$/.test(p.token)) return null;
    const addresses = Array.isArray(p.addresses) ? p.addresses.filter((a): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) : [];
    return { serial: p.serial, token: p.token, all: p.all === true, addresses };
  } catch {
    return null;
  }
}
export function keepPass(wallet: { evm: string }, pass: KeptPass | null): boolean {
  try {
    if (pass) localStorage.setItem(key(wallet), JSON.stringify(pass));
    else localStorage.removeItem(key(wallet));
    return true;
  } catch {
    return false;
  }
}

/**
 * The pocket's addresses a card may be opened for. The service takes only so many, so they go in the order they
 * matter: the main one; the ones money is expected on (the one shown for receiving, those set aside for requests,
 * the next two); the ones that hold money; then the rest, newest first. The one-time addresses of stealth payments
 * are never among them: those are not shown to anyone.
 */
export function choosePassAddresses(main: string, r: Pick<Rotation, 'holdings' | 'receive' | 'fresh'>, aside: ReadonlySet<number>): string[] {
  const plain = r.holdings.filter((h) => h.index > 0 && h.index < STEALTH_INDEX && h.index <= r.fresh.index + 1);
  const rank = (h: { index: number; balance: bigint }) => (h.index >= r.receive.index || aside.has(h.index) ? 0 : h.balance > 0n ? 1 : 2);
  const ordered = [...plain].sort((a, b) => rank(a) - rank(b) || b.index - a.index);
  return [...new Set([main, ...ordered.map((h) => h.address)].map((a) => a.toLowerCase()))].slice(0, PASS_ADDRESSES);
}
export const passAddressesOf = (wallet: Wallet, r: Rotation): string[] => choosePassAddresses(wallet.evm, r, askedIndices(wallet));
export const passAddresses = async (wallet: Wallet): Promise<string[]> => passAddressesOf(wallet, await loadRotation(wallet));

/** What the wallet tells the service about a card: the addresses opened, the one its code leads to, and how it reads. */
export const passAsk = (wallet: Wallet, addresses: readonly string[], name: string | null, lang: 'ru' | 'en'): PassAsk => ({ addresses, main: wallet.evm, ...(name ? { name } : {}), lang, zone: -new Date().getTimezoneOffset() });

const telling = new Set<string>();
/**
 * A card that watches all of the pocket's addresses is told of the ones it does not know yet. Called whenever the
 * addresses are read, so a card keeps up while the wallet is in use, not only when its own screen is opened. A card
 * that watches the main address alone is left as it is. Returns the card as it is kept now.
 */
export async function refreshPass(wallet: Wallet, r: Rotation, name: string | null, lang: 'ru' | 'en'): Promise<KeptPass | null> {
  const kept = loadPass(wallet);
  if (!kept || !kept.all || telling.has(kept.serial)) return kept;
  const now = passAddressesOf(wallet, r);
  if (now.length === kept.addresses.length && now.every((a) => kept.addresses.includes(a))) return kept;
  telling.add(kept.serial);
  try {
    await updatePass(kept.serial, kept.token, passAsk(wallet, now, name, lang));
    const next = { ...kept, addresses: now };
    keepPass(wallet, next);
    return next;
  } catch (e) {
    // The service no longer keeps the card (it was removed from the phone): this device forgets it too.
    if (e instanceof PassError && e.fault === 'unknown') return (keepPass(wallet, null), null);
    throw e;
  } finally {
    telling.delete(kept.serial);
  }
}
