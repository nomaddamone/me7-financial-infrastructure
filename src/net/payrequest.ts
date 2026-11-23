import { payQuoteRequest, readPayQuote, type PayAsk, type PayOrigin, type PayQuote } from '../core/payrequest.ts';

/**
 * Ask the crossing service what paying a request with another coin takes. `dry` only asks the price; otherwise the
 * service makes an address to pay to, good until `deadline`. When the service declines (too small a sum, a pair it
 * does not serve just now), its own words are raised. `usd` is the coin's price from elsewhere, for a coin that is not a dollar.
 */
export async function fetchPayQuote(api: string, ask: PayAsk, origin: PayOrigin, refundTo: string, deadline: number, slippageBps: number, dry: boolean, usd?: number): Promise<PayQuote> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let answer: unknown;
  try {
    const res = await fetch(`${api}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payQuoteRequest(ask, origin, refundTo, deadline, slippageBps, dry)), signal: controller.signal });
    answer = (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
  const said = (answer as { quote?: unknown; message?: unknown } | null) ?? {};
  if (!said.quote && typeof said.message === 'string') throw new Error(said.message.slice(0, 140));
  return readPayQuote(answer, ask, origin, refundTo, dry, usd);
}
