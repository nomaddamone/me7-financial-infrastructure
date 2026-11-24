import { GASLESS } from './endpoints.ts';

/**
 * The card in Apple Wallet, as the wallet asks me7's service for it. This is the one place where the wallet
 * tells the service addresses of its own, and it does so only when the user has asked for a card.
 */
export type PassFault = 'down' | 'limit' | 'unknown';
export class PassError extends Error {
  constructor(readonly fault: PassFault) {
    super(fault);
  }
}

export interface PassAsk {
  addresses: readonly string[];
  /** The address the card's code leads to, and the name it goes by, when it has one. */
  main: string;
  name?: string;
  lang: 'ru' | 'en';
  /** Minutes east of UTC, for the times printed on the card. */
  zone: number;
}

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let answer: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${GASLESS.path}/pass${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    answer = (await res.json()) as Record<string, unknown> | null;
  } catch {
    throw new PassError('down');
  } finally {
    clearTimeout(timer);
  }
  if (answer?.ok === true) return answer;
  throw new PassError(answer?.error === 'limit' || answer?.error === 'full' ? 'limit' : answer?.error === 'unknown' ? 'unknown' : 'down');
}

const secret = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32,64}$/.test(v);

/** Ask for a card. What comes back is kept by the wallet to manage the card (`serial`, `token`) and opens its download once (`ticket`). */
export async function makePass(ask: PassAsk): Promise<{ serial: string; token: string; ticket: string }> {
  const a = await call('/new', ask);
  if (!secret(a.serial) || !secret(a.token) || !secret(a.ticket)) throw new PassError('down');
  return { serial: a.serial, token: a.token, ticket: a.ticket };
}

/** How many devices hold the card; with `again`, a fresh way to download it. */
export async function lookPass(serial: string, token: string, again = false): Promise<{ phones: number; ticket: string }> {
  const a = await call('/look', { serial, token, again });
  if (typeof a.phones !== 'number' || (again && !secret(a.ticket))) throw new PassError('down');
  return { phones: a.phones, ticket: again ? (a.ticket as string) : '' };
}

export const updatePass = (serial: string, token: string, ask: PassAsk): Promise<unknown> => call('/update', { serial, token, ...ask });
export const removePass = (serial: string, token: string): Promise<unknown> => call('/remove', { serial, token });

/** Where the browser goes to be handed the card. The ticket in it opens the download once and for a few minutes only. */
export const passLink = (serial: string, ticket: string): string => `${GASLESS.path}/pass/get?s=${serial}&k=${ticket}`;
