import { formatUnits } from '../net/balances.ts';
import type { UsdPrices } from '../net/send.ts';
import type { AssetDef } from './assets.ts';

/**
 * A trade is a swap looked at as a position: what was paid, what was bought,
 * and what the bought coin would fetch if swapped back. Nothing else stands
 * behind it; the coins simply sit in the pocket. The record is kept on this
 * device only (it is not secret: every swap is on the public chain, but only
 * here is it known which of them the owner counts as a trade).
 */
export interface Trade {
  /** The swap's transaction hash. */
  id: string;
  /** Unix seconds. */
  time: number;
  net: string;
  fromId: string;
  toId: string;
  /** Paid, in the paid coin's base units. */
  amountIn: string;
  /** Bought, in the bought coin's base units. */
  amountOut: string;
  /** Set once the bought coin was swapped back. */
  closed?: { time: number; tx: string; amountBack: string };
}

const key = (owner: string) => `me7.trades.${owner.toLowerCase()}`;
const digits = (v: unknown): v is string => typeof v === 'string' && /^\d{1,78}$/.test(v);

function valid(raw: unknown): raw is Trade {
  const t = raw as Trade | null;
  if (!t || typeof t.id !== 'string' || !Number.isSafeInteger(t.time) || typeof t.net !== 'string') return false;
  if (typeof t.fromId !== 'string' || typeof t.toId !== 'string' || !digits(t.amountIn) || !digits(t.amountOut)) return false;
  if (t.closed === undefined) return true;
  return Number.isSafeInteger(t.closed.time) && typeof t.closed.tx === 'string' && digits(t.closed.amountBack);
}

export function loadTrades(owner: string): Trade[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? '[]');
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

export function saveTrades(owner: string, trades: readonly Trade[]): void {
  try {
    localStorage.setItem(key(owner), JSON.stringify(trades));
  } catch {
    /* private mode: the trades are forgotten when the tab closes */
  }
}

const amount = (units: string, a: AssetDef) => Number(formatUnits(BigInt(units), a.decimals, a.decimals));

/**
 * What an open trade's bought coin is worth now, measured in the coin that was
 * paid, at current market prices. Fees and price slip of an actual swap back
 * are not counted, so the real result of closing is a little lower.
 */
export function tradeWorth(trade: Trade, from: AssetDef, to: AssetDef, prices: UsdPrices): number {
  return (amount(trade.amountOut, to) * prices[to.price]) / prices[from.price];
}

/**
 * Return of a trade in percent: for an open one, what it would bring if closed
 * at current prices; for a closed one, what it actually brought. Null when
 * there are no prices to value an open trade with.
 */
export function tradeReturn(trade: Trade, from: AssetDef, to: AssetDef, prices: UsdPrices | null): number | null {
  const paid = amount(trade.amountIn, from);
  if (!(paid > 0)) return null;
  if (trade.closed) return (amount(trade.closed.amountBack, from) / paid - 1) * 100;
  if (!prices) return null;
  return (tradeWorth(trade, from, to, prices) / paid - 1) * 100;
}

/** The price at which the trade was entered: how much of the paid coin one unit of the bought coin cost. */
export function entryPrice(trade: Trade, from: AssetDef, to: AssetDef): number {
  const bought = amount(trade.amountOut, to);
  return bought > 0 ? amount(trade.amountIn, from) / bought : 0;
}
