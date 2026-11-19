/**
 * Paying USDT on Tron out of USDC on Base, through a crossing service (NEAR Intents, its 1Click
 * door). The wallet asks for an exact amount of USDT to arrive on a Tron address of its own; the
 * service answers with how much USDC it wants and the address to send it to.
 *
 * The service cannot be checked the way a swap inside one network is: the delivery happens on
 * another chain, after the money has left. What can be checked is checked here, before anything
 * is signed: that the answer repeats the wallet's own order word for word (where the USDT goes,
 * where a refund goes, which coins, how much), and that the price asked is not absurd. After
 * that the wallet believes only what it reads from Tron itself.
 */
import { isValidTronAddress } from './tron.ts';

export interface CrossOrder {
  /** The service's names for the coin given and the coin wanted. */
  origin: string;
  destination: string;
  /** The Tron address of this wallet the USDT must arrive on. */
  recipient: string;
  /** The Base address of this wallet a refund must go to. */
  refundTo: string;
  /** Exactly how much must arrive, in the wanted coin's units. */
  amountOut: bigint;
  slippageBps: number;
  /** When the service must have delivered or refunded, Unix milliseconds. */
  deadline: number;
}

export interface CrossQuote {
  /** How much of the given coin the service wants, in its units. */
  amountIn: bigint;
  /**
   * The least of it the service expects to use. An exact order is priced with room for the price to move:
   * `amountIn` is the most it may take, and what it did not need it sends back to the refund address.
   * Equal to `amountIn` when the service names no lower figure.
   */
  leastIn: bigint;
  /** Where to send it. Absent in a quote asked only to see the price. */
  depositAddress: string | null;
  /** The service's own guess of how long the crossing takes, in seconds. */
  seconds: number;
}

export interface CrossLimits {
  maxOverBps: bigint;
  maxOverFlat: bigint;
}

/** The most the service may ask for delivering this much: both coins are dollars, so anything far above is refused. */
export function crossMaxIn(amountOut: bigint, limits: CrossLimits): bigint {
  return amountOut + (amountOut * limits.maxOverBps) / 10_000n + limits.maxOverFlat;
}

/** The order as the service's door takes it. `dry` asks for the price only: no address is made. */
export function crossQuoteRequest(order: CrossOrder, dry: boolean): Record<string, unknown> {
  return {
    dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: order.slippageBps,
    originAsset: order.origin,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: order.destination,
    amount: order.amountOut.toString(),
    refundTo: order.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: order.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(order.deadline).toISOString(),
  };
}

const digits = (value: unknown): bigint | null => (typeof value === 'string' && /^[0-9]{1,30}$/.test(value) ? BigInt(value) : null);

/**
 * Read the service's answer to an order. Throws unless it is the answer to exactly this order
 * and the price is within the limits; for a real (not dry) order it must also name the address
 * to pay to.
 */
export function readCrossQuote(answer: unknown, order: CrossOrder, dry: boolean, limits: CrossLimits): CrossQuote {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as { quote?: Record<string, unknown>; quoteRequest?: Record<string, unknown> };
  const q = a.quote;
  const r = a.quoteRequest;
  if (!q || !r) throw new Error('no quote');
  const same =
    r.swapType === 'EXACT_OUTPUT' &&
    r.originAsset === order.origin &&
    r.destinationAsset === order.destination &&
    r.recipient === order.recipient &&
    r.recipientType === 'DESTINATION_CHAIN' &&
    r.refundTo === order.refundTo &&
    r.refundType === 'ORIGIN_CHAIN' &&
    r.depositType === 'ORIGIN_CHAIN' &&
    r.amount === order.amountOut.toString();
  if (!same) throw new Error('the answer is to another order');
  const amountIn = digits(q.amountIn);
  const amountOut = digits(q.amountOut);
  const least = digits(q.minAmountOut);
  if (amountIn === null || amountOut === null || least === null || amountIn <= 0n) throw new Error('malformed quote');
  // An exact order: what arrives is what was asked for, and not a unit less.
  if (amountOut !== order.amountOut || least !== order.amountOut) throw new Error('not the amount ordered');
  if (amountIn > crossMaxIn(order.amountOut, limits)) throw new Error('too dear');
  const seconds = typeof q.timeEstimate === 'number' && q.timeEstimate > 0 && q.timeEstimate < 86_400 ? Math.round(q.timeEstimate) : 120;
  // Only shown, never paid by: a figure that makes no sense is read as no room at all.
  const named = digits(q.minAmountIn);
  const leastIn = named !== null && named > 0n && named <= amountIn ? named : amountIn;
  if (dry) return { amountIn, leastIn, depositAddress: null, seconds };
  // A memo would mean the money is told apart by more than its address: this wallet's transfer carries none.
  if (typeof q.depositAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress) || q.depositMemo) throw new Error('no deposit address');
  if (q.depositAddress.toLowerCase() === order.refundTo.toLowerCase()) throw new Error('no deposit address');
  return { amountIn, leastIn, depositAddress: q.depositAddress, seconds };
}

/** Where a crossing stands, as the service tells it. The wallet acts on 'refunded' and 'failed' only; arrival it reads from Tron itself. */
export type CrossState = 'waiting' | 'working' | 'done' | 'refunded' | 'failed';

export function readCrossStatus(answer: unknown): CrossState | null {
  const status = (typeof answer === 'object' && answer !== null ? (answer as { status?: unknown }).status : null) as unknown;
  switch (status) {
    case 'PENDING_DEPOSIT':
    case 'INCOMPLETE_DEPOSIT':
      return 'waiting';
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING':
      return 'working';
    case 'SUCCESS':
      return 'done';
    case 'REFUNDED':
      return 'refunded';
    case 'FAILED':
      return 'failed';
    default:
      return null;
  }
}

/**
 * What the service says about the order behind a deposit address: which coins, and the address the
 * result is delivered to. me7's own service asks this before it gives a crossing its lower fee, so
 * that the lower fee cannot be had for any other payment. Null when the answer names no such order.
 */
export function readCrossOrder(answer: unknown): { origin: string; destination: string; recipient: string } | null {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as { status?: unknown; quoteResponse?: { quoteRequest?: Record<string, unknown> } };
  const r = a.quoteResponse?.quoteRequest;
  if (readCrossStatus(a) === null || !r) return null;
  if (typeof r.originAsset !== 'string' || typeof r.destinationAsset !== 'string' || typeof r.recipient !== 'string') return null;
  if (r.depositType !== 'ORIGIN_CHAIN' || r.recipientType !== 'DESTINATION_CHAIN') return null;
  return { origin: r.originAsset, destination: r.destinationAsset, recipient: r.recipient };
}

const CENT = 10_000n;
/**
 * How much USDT to order onto the new address so that it can pay `amount` on and the fee of that
 * payment too. The fee is an estimate made ahead of the money; a twentieth is added, because the
 * service forgives only that much, and the sum is rounded up to a cent.
 */
export function crossBudget(amount: bigint, feeEstimate: bigint): bigint {
  const fee = feeEstimate + feeEstimate / 20n;
  return ((amount + fee + CENT - 1n) / CENT) * CENT;
}

/**
 * Swapping a coin on one network for a coin on another through the same crossing service: the
 * wallet gives an exact amount, and the service delivers what that buys to an address of the same
 * wallet on the other network. The same rule holds as for a payment: the answer must repeat the
 * order word for word, and what it promises must not fall below a floor the wallet worked out
 * for itself from prices it got elsewhere.
 */
export interface SwapOrder {
  origin: string;
  destination: string;
  /** The wallet's own address on the network the result arrives on, and the one on the network a refund returns to. */
  recipient: string;
  refundTo: string;
  /** Exactly how much is given, in the given coin's units. */
  amountIn: bigint;
  slippageBps: number;
  deadline: number;
  /** me7's own part, in hundredths of a percent of what is given, and the address it is credited to. Absent: none is asked. */
  fee?: { recipient: string; bps: number };
}

export interface SwapQuote {
  /** What the service expects to deliver, and the least it binds itself to, in the wanted coin's units. */
  amountOut: bigint;
  minOut: bigint;
  depositAddress: string | null;
  seconds: number;
}

/** The service's name for a coin: the network's own coin, or a token on an EVM network by its contract. */
export function crossAssetName(network: 'eth' | 'base' | 'tron' | 'btc', contract?: string): string {
  if (!contract) return `nep141:${network}.omft.near`;
  if (network === 'tron' || network === 'btc' || !/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error('no name for this coin');
  return `nep141:${network}-${contract.toLowerCase()}.omft.near`;
}

export function crossSwapRequest(order: SwapOrder, dry: boolean): Record<string, unknown> {
  return {
    dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: order.slippageBps,
    originAsset: order.origin,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: order.destination,
    amount: order.amountIn.toString(),
    refundTo: order.refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient: order.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(order.deadline).toISOString(),
    ...(order.fee && order.fee.bps > 0 ? { appFees: [{ recipient: order.fee.recipient, fee: order.fee.bps }] } : {}),
  };
}

/**
 * Read the answer to a swap order. Throws unless it answers exactly this order, takes exactly the
 * amount given, and binds itself to no less than `floor`. A real (not dry) order must name an
 * address to pay to, with no memo: an EVM address, or a Tron one when what is given is on Tron.
 */
export function readCrossSwapQuote(answer: unknown, order: SwapOrder, dry: boolean, floor: bigint): SwapQuote {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as { quote?: Record<string, unknown>; quoteRequest?: Record<string, unknown> };
  const q = a.quote;
  const r = a.quoteRequest;
  if (!q || !r) throw new Error('no quote');
  const same =
    r.swapType === 'EXACT_INPUT' &&
    r.originAsset === order.origin &&
    r.destinationAsset === order.destination &&
    r.recipient === order.recipient &&
    r.recipientType === 'DESTINATION_CHAIN' &&
    r.refundTo === order.refundTo &&
    r.refundType === 'ORIGIN_CHAIN' &&
    r.depositType === 'ORIGIN_CHAIN' &&
    r.amount === order.amountIn.toString();
  if (!same) throw new Error('the answer is to another order');
  const amountIn = digits(q.amountIn);
  const amountOut = digits(q.amountOut);
  const minOut = digits(q.minAmountOut);
  if (amountIn === null || amountOut === null || minOut === null) throw new Error('malformed quote');
  if (amountIn !== order.amountIn) throw new Error('not the amount given');
  if (minOut <= 0n || minOut > amountOut) throw new Error('malformed quote');
  if (minOut < floor) throw new Error('too dear');
  const seconds = typeof q.timeEstimate === 'number' && q.timeEstimate > 0 && q.timeEstimate < 86_400 ? Math.round(q.timeEstimate) : 120;
  if (dry) return { amountOut, minOut, depositAddress: null, seconds };
  if (typeof q.depositAddress !== 'string' || q.depositMemo) throw new Error('no deposit address');
  const onTron = order.origin.startsWith('nep141:tron');
  if (onTron ? !isValidTronAddress(q.depositAddress) : !/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress)) throw new Error('no deposit address');
  if (q.depositAddress.toLowerCase() === order.refundTo.toLowerCase() || q.depositAddress.toLowerCase() === order.recipient.toLowerCase()) throw new Error('no deposit address');
  return { amountOut, minOut, depositAddress: q.depositAddress, seconds };
}

/**
 * The least a swap may promise: what is given is worth `valueOut` of the wanted coin at prices the
 * wallet got elsewhere; a share of that may go on the price and the service's cut (`lossBps`), and a
 * fixed sum on the networks' own costs (`flat`, in the wanted coin's units). Below that it is refused.
 */
export function swapFloor(valueOut: bigint, lossBps: bigint, flat: bigint): bigint {
  const floor = valueOut - (valueOut * lossBps) / 10_000n - flat;
  return floor > 0n ? floor : 0n;
}

/** What the service says was delivered, once a swap is done: the amount, in the wanted coin's units. Null when it does not say. */
export function readCrossDelivered(answer: unknown): bigint | null {
  const details = (typeof answer === 'object' && answer !== null ? (answer as { swapDetails?: { amountOut?: unknown } }).swapDetails : undefined) ?? {};
  return digits(details.amountOut);
}
