import { NET } from '../net/endpoints.ts';

/**
 * The requests for payment this wallet has made (see src/core/payrequest.ts).
 *
 * Each request has an address of its own among the wallet's changing ones, so that a payment says which request it
 * answers. While a request is open its address is set aside: the wallet does not hand it out as the next fresh one.
 * The addresses are the seed's own, a few numbers ahead of the last used one, so a payment to any of them reaches
 * the wallet on any device.
 *
 * The list is kept in this browser and travels with the address book, encrypted, to the wallet's other devices
 * (see src/app/contacts.ts). So that a request removed on one device does not come back from another, removing
 * leaves a mark in its place; marks and old requests are cleared away a week after their time is up.
 */
export interface Asked {
  id: string;
  /** The address's number among the wallet's changing addresses, and the address itself. */
  index: number;
  address: string;
  amount: string;
  note: string;
  created: number;
  /** Until when the link stands, Unix seconds. Absent in a request made before links had an end. */
  until?: number;
  /** The link's '#…' part, kept so that the same link can be shown again. */
  hash: string;
  /** Removed by the user: kept only so that the removal reaches the other devices. */
  gone?: true;
}

/** No more open requests than this at once: their addresses must stay within the stretch the wallet looks at. */
export const ASKED_MOST = 12;
/** How long a request, or the mark of one removed, is kept after its time is up: a week, in milliseconds. */
const KEEP_MS = 7 * 86_400_000;
const KEPT_MOST = 60;

type Owner = { evm: string };
const key = (wallet: Owner) => `me7.asked.${NET.mode}.${wallet.evm.toLowerCase()}`;
const isText = (v: unknown): v is string => typeof v === 'string';
const endOf = (a: Asked): number => (a.until ? a.until * 1000 : a.created + 30 * 86_400_000);

/** The requests among what was read, in the shape this wallet keeps them; anything malformed is dropped. */
export function sanitizeAsked(raw: unknown, now: number = Date.now()): Asked[] {
  if (!Array.isArray(raw)) return [];
  return (raw as (Partial<Asked> | null)[]).flatMap((a) => {
    const ok = !!a && isText(a.id) && a.id.length <= 60 && Number.isSafeInteger(a.index) && (a.index as number) > 0 && isText(a.address) && /^0x[0-9a-fA-F]{40}$/.test(a.address) && isText(a.amount) && /^[0-9]{1,15}$/.test(a.amount) && isText(a.note) && a.note.length <= 160 && typeof a.created === 'number' && isText(a.hash) && /^#pay=[A-Za-z0-9_-]{8,1200}$/.test(a.hash);
    if (!ok || (a.until !== undefined && !Number.isSafeInteger(a.until))) return [];
    const one: Asked = { id: a.id as string, index: a.index as number, address: a.address as string, amount: a.amount as string, note: a.note as string, created: a.created as number, hash: a.hash as string, ...(a.until !== undefined ? { until: a.until } : {}), ...(a.gone === true ? { gone: true as const } : {}) };
    return endOf(one) + KEEP_MS > now ? [one] : [];
  });
}

/** Everything kept, the marks of removed requests among it. */
export function loadAskedAll(wallet: Owner): Asked[] {
  try {
    return sanitizeAsked(JSON.parse(localStorage.getItem(key(wallet)) ?? '[]'));
  } catch {
    return [];
  }
}
/** The requests as the user sees them. */
export const loadAsked = (wallet: Owner): Asked[] => loadAskedAll(wallet).filter((a) => !a.gone);

export function replaceAsked(wallet: Owner, list: readonly Asked[]): boolean {
  try {
    localStorage.setItem(key(wallet), JSON.stringify(list.slice(-KEPT_MOST)));
    return true;
  } catch {
    return false;
  }
}

export const saveAsked = (wallet: Owner, one: Asked): boolean => replaceAsked(wallet, [...loadAskedAll(wallet).filter((a) => a.id !== one.id), one]);
/** Remove a request: it leaves the list, and a mark stays for the other devices. */
export const dropAsked = (wallet: Owner, id: string): void => void replaceAsked(wallet, loadAskedAll(wallet).map((a) => (a.id === id ? { ...a, gone: true as const } : a)));

/** Two devices' lists as one: every request appears once, and one removed on either is removed. */
export function mergeAsked(theirs: readonly Asked[], mine: readonly Asked[]): Asked[] {
  const byId = new Map<string, Asked>();
  for (const a of [...theirs, ...mine]) {
    const had = byId.get(a.id);
    byId.set(a.id, had?.gone || a.gone ? { ...(had ?? a), ...a, gone: true } : a);
  }
  return [...byId.values()].sort((a, b) => a.created - b.created);
}

/** The numbers of the addresses set aside for open requests. */
export const askedIndices = (wallet: Owner): Set<number> => new Set(loadAsked(wallet).map((a) => a.index));
