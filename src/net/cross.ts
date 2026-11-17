import { crossQuoteRequest, crossSwapRequest, readCrossDelivered, readCrossQuote, readCrossStatus, readCrossSwapQuote, type CrossLimits, type CrossOrder, type CrossQuote, type CrossState, type SwapOrder, type SwapQuote } from '../core/cross.ts';

async function ask(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the crossing service about an order. `dry` only asks the price; otherwise the service makes
 * an address to pay to. Throws when the service does not answer, or answers something other than
 * this very order at a sane price.
 */
export async function fetchCrossQuote(api: string, order: CrossOrder, dry: boolean, limits: CrossLimits): Promise<CrossQuote> {
  const answer = await ask(`${api}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(crossQuoteRequest(order, dry)) });
  return readCrossQuote(answer, order, dry, limits);
}

/** Tell the service which transaction carries the deposit, so it need not find it by itself. Its failure changes nothing. */
export async function tellCrossDeposit(api: string, depositAddress: string, txHash: string): Promise<void> {
  await ask(`${api}/deposit/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => undefined);
}

/** Where the crossing paid to this address stands. Null when the service does not say. */
export async function fetchCrossState(api: string, depositAddress: string): Promise<CrossState | null> {
  try {
    return readCrossStatus(await ask(`${api}/status?depositAddress=${depositAddress}`));
  } catch {
    return null;
  }
}

/**
 * Ask the service about a swap between networks. When it declines (too small a sum, a pair it does
 * not serve just now), its own words are raised, so the user reads why.
 */
export async function fetchCrossSwapQuote(api: string, order: SwapOrder, dry: boolean, floor: bigint): Promise<SwapQuote> {
  const answer = await ask(`${api}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(crossSwapRequest(order, dry)) });
  const said = (answer as { quote?: unknown; message?: unknown } | null) ?? {};
  if (!said.quote && typeof said.message === 'string') throw new Error(said.message.slice(0, 140));
  return readCrossSwapQuote(answer, order, dry, floor);
}

/** Where a swap stands, and what was delivered once it is done. */
export async function fetchCrossProgress(api: string, depositAddress: string): Promise<{ state: CrossState | null; delivered: bigint | null }> {
  try {
    const answer = await ask(`${api}/status?depositAddress=${depositAddress}`);
    return { state: readCrossStatus(answer), delivered: readCrossDelivered(answer) };
  } catch {
    return { state: null, delivered: null };
  }
}
