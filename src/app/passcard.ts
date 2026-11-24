import { NET } from '../net/endpoints.ts';
import { loadRotation } from './addresses.ts';
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
 * The pocket's addresses a card may be opened for: the main one first, then the changing ones that were used and
 * the next two. The one-time addresses of stealth payments are never among them: those are not shown to anyone.
 */
export async function passAddresses(wallet: Wallet): Promise<string[]> {
  const r = await loadRotation(wallet);
  const plain = r.holdings.filter((h) => h.index < STEALTH_INDEX).slice(0, r.fresh.index + 2);
  return [...new Set([wallet.evm, ...plain.map((h) => h.address)].map((a) => a.toLowerCase()))].slice(0, PASS_ADDRESSES);
}
