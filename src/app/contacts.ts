import { openSync, sealSync, syncKeys, wipeSyncKeys } from '../core/sync.ts';
import { pullSync, pushSync } from '../net/sync.ts';
import { loadAskedAll, mergeAsked, replaceAsked, sanitizeAsked, type Asked } from './requests.ts';

/**
 * The address book: named addresses the user pays often. Each contact is an
 * address for one coin on one network; for USDC on Base it may be a stealth
 * code instead, from which a new address is made at every payment. It is kept in this browser and, so that
 * it follows the user to another device, encrypted on me7's store under keys
 * that come from the seed (see src/core/sync.ts). It is not part of the key file.
 *
 * The wallet's requests for payment (src/app/requests.ts) travel in the same sealed list, each marked as one:
 * a device that knows nothing of them reads past them, since they have no name and no coin.
 */
export interface Contact {
  id: string;
  name: string;
  address: string;
  /** The asset's id (see assets.ts): it names both the coin and the network. */
  asset: string;
}

export const CONTACT_NAME_MAX = 40;
/** Room for the longest thing kept as an address: a stealth code, 142 characters. */
export const CONTACT_ADDRESS_MAX = 160;
const key = (owner: string) => `me7.contacts.${owner.toLowerCase()}`;

/** Contacts as stored; anything malformed is dropped rather than shown. */
function sanitize(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const c = item as Partial<Contact> | null;
    const ok = c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.address === 'string' && typeof c.asset === 'string';
    if (!ok || !c.name || c.name.length > CONTACT_NAME_MAX || (c.address ?? '').length > CONTACT_ADDRESS_MAX) return [];
    return [{ id: c.id, name: c.name, address: c.address, asset: c.asset } as Contact];
  });
}

export function loadContacts(owner: string): Contact[] {
  try {
    return sanitize(JSON.parse(localStorage.getItem(key(owner)) ?? '[]'));
  } catch {
    return [];
  }
}

export function saveContacts(owner: string, contacts: readonly Contact[]): boolean {
  try {
    localStorage.setItem(key(owner), JSON.stringify(contacts));
    return true;
  } catch {
    return false;
  }
}

/** A new list with the contact added; the same address for the same coin is kept once, under the new name. */
export function withContact(contacts: readonly Contact[], contact: Omit<Contact, 'id'>, id: string): Contact[] {
  const name = contact.name.trim().slice(0, CONTACT_NAME_MAX);
  const address = contact.address.trim();
  const rest = contacts.filter((c) => !(c.asset === contact.asset && c.address.toLowerCase() === address.toLowerCase()));
  return [...rest, { id, name, address, asset: contact.asset }];
}

const isAsked = (item: unknown): boolean => typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'asked';

/** What this browser knows about the copy on the server: the version it last matched, and whether it has changed since. */
interface SyncState {
  version: number;
  dirty: boolean;
}
const stateKey = (owner: string) => `me7.contacts.sync.${owner.toLowerCase()}`;
function loadState(owner: string): SyncState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(stateKey(owner)) ?? 'null') as Partial<SyncState> | null;
    return raw && Number.isSafeInteger(raw.version) && typeof raw.dirty === 'boolean' ? { version: raw.version as number, dirty: raw.dirty } : null;
  } catch {
    return null;
  }
}
function saveState(owner: string, state: SyncState): void {
  try {
    localStorage.setItem(stateKey(owner), JSON.stringify(state));
  } catch {
    /* private mode: the next sign-in starts from the server's copy */
  }
}

/** Note that the list was changed here and has yet to reach the server. */
export function markContactsChanged(owner: string): void {
  saveState(owner, { version: loadState(owner)?.version ?? 0, dirty: true });
}

/** Two lists as one: an address for a coin appears once, and where both have it, `mine` decides the name. */
export function mergeContacts(theirs: readonly Contact[], mine: readonly Contact[]): Contact[] {
  const byPlace = new Map<string, Contact>();
  for (const c of [...theirs, ...mine]) byPlace.set(`${c.asset}:${c.address.toLowerCase()}`, c);
  return [...byPlace.values()];
}

/**
 * Bring this browser's list and the server's copy into line.
 *
 * A newer copy on the server replaces the local list, unless the local one has
 * changes of its own; then the two are merged and stored as the next version.
 * Local changes with nothing newer on the server are simply stored. A wallet
 * without its seed in memory (there is none in a Ledger session) keeps its list local.
 */
export async function syncContacts(wallet: { evm: string; seed?: Uint8Array }): Promise<'synced' | 'offline' | 'local'> {
  if (!(wallet.seed instanceof Uint8Array) || wallet.seed.length !== 64) return 'local';
  const owner = wallet.evm;
  const keys = syncKeys(wallet.seed);
  try {
    // A second pass happens only when another device stored a version between the read and the write.
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await pullSync(keys);
      const local = loadContacts(owner);
      // A list made before syncing existed has never been stored: it counts as changed.
      const state = loadState(owner) ?? { version: 0, dirty: local.length > 0 || loadAskedAll(wallet).length > 0 };
      let list = local;
      let asked: Asked[] = loadAskedAll(wallet);
      let changed = state.dirty;
      if (remote.blob && remote.version > state.version) {
        const raw: unknown = JSON.parse(new TextDecoder().decode(await openSync(keys, remote.version, remote.blob)));
        const theirs = sanitize(raw);
        const theirAsked = sanitizeAsked(Array.isArray(raw) ? raw.filter(isAsked) : []);
        list = state.dirty ? mergeContacts(theirs, local) : theirs;
        // Requests are never replaced whole: one made here a moment ago must not vanish because another device spoke first.
        asked = mergeAsked(theirAsked, asked);
        changed = (state.dirty && JSON.stringify(list) !== JSON.stringify(theirs)) || JSON.stringify(asked) !== JSON.stringify(theirAsked);
        saveContacts(owner, list);
        replaceAsked(wallet, asked);
      }
      if (!changed) {
        saveState(owner, { version: Math.max(remote.version, state.version), dirty: false });
        return 'synced';
      }
      const version = Math.max(remote.version, state.version) + 1;
      const stored = await pushSync(keys, version, await sealSync(keys, version, new TextEncoder().encode(JSON.stringify([...list, ...asked.map((a) => ({ ...a, kind: 'asked' }))]))));
      if (stored === 'stored') {
        saveState(owner, { version, dirty: false });
        return 'synced';
      }
      saveState(owner, { version: state.version, dirty: true });
    }
    return 'offline';
  } catch {
    return 'offline';
  } finally {
    wipeSyncKeys(keys);
  }
}
