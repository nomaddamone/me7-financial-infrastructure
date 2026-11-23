import { isValidEvmAddress, toChecksumAddress } from './evm.ts';
import { isValidTronAddress } from './tron.ts';
import { isValidBitcoinAddress } from './tx-bitcoin.ts';

/**
 * A request for payment that travels as a link.
 *
 * The owner of a wallet asks for an amount of USDC on Base, on an address of their own. The link carries the
 * request whole, after the '#', where no server sees it: the address, the amount, a few words about what it is
 * for. Whoever opens it pays with USDC on Base straight to the address, or with another coin on another
 * network through the crossing service (NEAR Intents), which delivers exactly the amount asked.
 *
 * A link can be rewritten by whoever passes it on, like any address sent in a message. So the page that opens
 * it shows the address's eight-digit code, to compare with the one the asker reads out.
 */
export interface PayAsk {
  /** The address on Base the USDC must arrive on. */
  to: string;
  /** How much, in USDC's units (six decimals). */
  amount: bigint;
  /** What it is for, in the asker's words. Shown as plain text. */
  note: string;
  /** The asker's own addresses on Tron and on Ethereum: where a crossing that fails returns the payer's coin, when the payer names no address. */
  refundTron?: string;
  refundEth?: string;
  /**
   * Until when the request stands, Unix seconds; absent: it has no end. The page that opens the link holds to it. The
   * address itself has no end: money sent to it later, by hand, still reaches its owner.
   */
  until?: number;
}

/** No less than a dollar, no more than a million: outside that it is a slip of the hand or not a payment. */
export const PAY_MIN = 1_000_000n;
export const PAY_MAX = 1_000_000_000_000n;
const NOTE_MAX = 80;
const PREFIX = '#pay=';

const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{8,1200}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A note as it may be shown: no line breaks or control characters, no more than a line. */
/** Line breaks and control characters, by their numbers: none of them belongs in a line shown to a payer. */
const unseen = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
export const cleanNote = (note: string): string =>
  [...[...note].map((c) => (unseen(c.codePointAt(0) ?? 0) ? ' ' : c)).join('').replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('');

/** The part of a link after the page's own address: '#pay=…'. */
export function payAskHash(ask: PayAsk): string {
  const body = {
    v: 1,
    t: ask.to,
    a: ask.amount.toString(),
    ...(cleanNote(ask.note) ? { n: cleanNote(ask.note) } : {}),
    ...(ask.refundTron ? { rt: ask.refundTron } : {}),
    ...(ask.refundEth ? { re: ask.refundEth } : {}),
    ...(ask.until ? { x: ask.until } : {}),
  };
  return `${PREFIX}${toBase64Url(new TextEncoder().encode(JSON.stringify(body)))}`;
}

/** Read a request out of a link's '#…' part. Null for anything that is not a well-formed request. */
export function readPayAskHash(hash: string): PayAsk | null {
  if (!hash.startsWith(PREFIX)) return null;
  const bytes = fromBase64Url(hash.slice(PREFIX.length));
  if (!bytes) return null;
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (raw.v !== 1 || typeof raw.t !== 'string' || !isValidEvmAddress(raw.t) || typeof raw.a !== 'string' || !/^[1-9][0-9]{0,14}$/.test(raw.a)) return null;
  const amount = BigInt(raw.a);
  if (amount < PAY_MIN || amount > PAY_MAX) return null;
  if (raw.n !== undefined && typeof raw.n !== 'string') return null;
  if (raw.rt !== undefined && (typeof raw.rt !== 'string' || !isValidTronAddress(raw.rt))) return null;
  if (raw.re !== undefined && (typeof raw.re !== 'string' || !isValidEvmAddress(raw.re))) return null;
  if (raw.x !== undefined && (typeof raw.x !== 'number' || !Number.isSafeInteger(raw.x) || raw.x < 1_600_000_000 || raw.x > 4_102_444_800)) return null;
  return {
    to: toChecksumAddress(raw.t),
    amount,
    note: cleanNote(typeof raw.n === 'string' ? raw.n : ''),
    ...(typeof raw.rt === 'string' ? { refundTron: raw.rt } : {}),
    ...(typeof raw.re === 'string' ? { refundEth: toChecksumAddress(raw.re) } : {}),
    ...(typeof raw.x === 'number' ? { until: raw.x } : {}),
  };
}

/** What a payer may pay with, other than USDC on Base itself. */
export interface PayOrigin {
  id: string;
  ticker: string;
  net: string;
  /** The kind of address the coin's network uses. */
  chain: 'evm' | 'tron' | 'btc';
  /** The crossing service's name for the coin. */
  asset: string;
  decimals: number;
  /** A dollar coin: what the service asks is held against the amount itself. Otherwise against an outside price. */
  dollars: boolean;
  price?: 'eth' | 'btc';
  /** The service takes nothing smaller from this network, in USDC's units. */
  least?: bigint;
  /** Which of the asker's own addresses a failed crossing returns to, when the payer names none. Absent: the payer must name one. */
  refund?: 'tron' | 'eth';
}

export const PAY_DESTINATION = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
export const PAY_ORIGINS: readonly PayOrigin[] = [
  { id: 'usdt-tron', ticker: 'USDT', net: 'Tron', chain: 'tron', asset: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', decimals: 6, dollars: true, least: 101_000_000n, refund: 'tron' },
  { id: 'usdt-eth', ticker: 'USDT', net: 'Ethereum', chain: 'evm', asset: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', decimals: 6, dollars: true, refund: 'eth' },
  { id: 'usdc-eth', ticker: 'USDC', net: 'Ethereum', chain: 'evm', asset: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', decimals: 6, dollars: true, refund: 'eth' },
  { id: 'eth', ticker: 'ETH', net: 'Ethereum', chain: 'evm', asset: 'nep141:eth.omft.near', decimals: 18, dollars: false, price: 'eth' },
  { id: 'eth-base', ticker: 'ETH', net: 'Base', chain: 'evm', asset: 'nep141:base.omft.near', decimals: 18, dollars: false, price: 'eth' },
  { id: 'btc', ticker: 'BTC', net: 'Bitcoin', chain: 'btc', asset: 'nep141:btc.omft.near', decimals: 8, dollars: false, price: 'btc' },
];

/** Whether an address is one of the coin's network. */
export function validOn(origin: PayOrigin, address: string): boolean {
  return origin.chain === 'tron' ? isValidTronAddress(address) : origin.chain === 'btc' ? isValidBitcoinAddress(address, 'mainnet') : isValidEvmAddress(address);
}

/** Where a failed crossing returns the payer's coin: the address the payer named, or else the asker's own on that network. Null when there is neither. */
export function refundFor(ask: PayAsk, origin: PayOrigin, named: string): string | null {
  const own = named.trim();
  if (own) return validOn(origin, own) ? own : null;
  const fallback = origin.refund === 'tron' ? ask.refundTron : origin.refund === 'eth' ? ask.refundEth : undefined;
  return fallback && validOn(origin, fallback) ? fallback : null;
}

/** The order as the crossing service's door takes it: exactly the amount asked must arrive. `dry` asks for the price only. */
export function payQuoteRequest(ask: PayAsk, origin: PayOrigin, refundTo: string, deadline: number, slippageBps: number, dry: boolean): Record<string, unknown> {
  return {
    dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: slippageBps,
    originAsset: origin.asset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: PAY_DESTINATION,
    amount: ask.amount.toString(),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: ask.to,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(deadline).toISOString(),
  };
}

export interface PayQuote {
  /** The most of the payer's coin the service may take, and the least it expects to use; what it does not need goes to the refund address. */
  amountIn: bigint;
  leastIn: bigint;
  /** Where to send it. Null in a quote asked only to see the price. */
  deposit: string | null;
  seconds: number;
}

const digits = (value: unknown): bigint | null => (typeof value === 'string' && /^[0-9]{1,40}$/.test(value) ? BigInt(value) : null);

/**
 * Read the service's answer to an order. Throws unless it answers exactly this order, delivers exactly the amount
 * asked, and wants no more for it than is sane: for a dollar coin two percent and two dollars over the amount;
 * for another coin five percent and two dollars over its worth at `usd`, a price from elsewhere (absent: refused).
 * A real order must also name an address of the coin's own network, with no memo.
 */
export function readPayQuote(answer: unknown, ask: PayAsk, origin: PayOrigin, refundTo: string, dry: boolean, usd?: number): PayQuote {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as { quote?: Record<string, unknown>; quoteRequest?: Record<string, unknown> };
  const q = a.quote;
  const r = a.quoteRequest;
  if (!q || !r) throw new Error('no quote');
  const same =
    r.swapType === 'EXACT_OUTPUT' &&
    r.originAsset === origin.asset &&
    r.destinationAsset === PAY_DESTINATION &&
    r.recipient === ask.to &&
    r.recipientType === 'DESTINATION_CHAIN' &&
    r.refundTo === refundTo &&
    r.refundType === 'ORIGIN_CHAIN' &&
    r.depositType === 'ORIGIN_CHAIN' &&
    r.amount === ask.amount.toString();
  if (!same) throw new Error('the answer is to another order');
  const amountIn = digits(q.amountIn);
  if (amountIn === null || amountIn <= 0n) throw new Error('malformed quote');
  if (digits(q.amountOut) !== ask.amount || digits(q.minAmountOut) !== ask.amount) throw new Error('not the amount ordered');
  if (origin.dollars) {
    const scaled = origin.decimals >= 6 ? amountIn / 10n ** BigInt(origin.decimals - 6) : amountIn * 10n ** BigInt(6 - origin.decimals);
    if (scaled > ask.amount + ask.amount / 50n + 2_000_000n) throw new Error('too dear');
  } else {
    if (usd === undefined || !Number.isFinite(usd) || usd <= 0) throw new Error('no price');
    const worth = (Number(amountIn) / 10 ** origin.decimals) * usd;
    if (worth > (Number(ask.amount) / 1e6) * 1.05 + 2) throw new Error('too dear');
  }
  const named = digits(q.minAmountIn);
  const leastIn = named !== null && named > 0n && named <= amountIn ? named : amountIn;
  const seconds = typeof q.timeEstimate === 'number' && q.timeEstimate > 0 && q.timeEstimate < 86_400 ? Math.round(q.timeEstimate) : 120;
  if (dry) return { amountIn, leastIn, deposit: null, seconds };
  const deposit = q.depositAddress;
  if (typeof deposit !== 'string' || q.depositMemo || !validOn(origin, deposit)) throw new Error('no deposit address');
  const lower = deposit.toLowerCase();
  if (lower === refundTo.toLowerCase() || lower === ask.to.toLowerCase()) throw new Error('no deposit address');
  return { amountIn, leastIn, deposit, seconds };
}
