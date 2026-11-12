import { hexToBytes } from '@noble/hashes/utils.js';
import { abiDecode, address, array, bytes, keccakText, tuple, uint, type AbiValue } from './abi.ts';

/**
 * Swapping one coin for another through KyberSwap, an exchange aggregator.
 *
 * The aggregator's server works out the route and hands back a ready
 * transaction for its router contract. A server must not be able to decide
 * where the money goes, so before signing the wallet reads that transaction
 * itself and checks every field that matters: which coins, how much goes in,
 * who receives the result, the least that must come back, and who is paid a
 * fee. The router refuses the trade on-chain if the receiver would get less
 * than that minimum, which is what makes checking these fields enough.
 */

/** KyberSwap's router (MetaAggregationRouterV2), the same address on every network it runs on. */
export const SWAP_ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
/** How the router's interface names a network's own coin (ETH), which has no contract. */
export const SWAP_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const descT = tuple(address, address, array(address), array(uint), array(address), array(uint), address, uint, uint, uint, bytes);
// swap((callTarget, approveTarget, targetData, desc, clientData))
const SWAP_SELECTOR = keccakText(
  'swap((address,address,bytes,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes))',
).slice(0, 10);
const swapArgs = [tuple(address, address, bytes, descT, bytes)];
// swapSimpleMode(caller, desc, executorData, clientData)
const SIMPLE_SELECTOR = keccakText(
  'swapSimpleMode(address,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes,bytes)',
).slice(0, 10);
const simpleArgs = [address, descT, bytes, bytes];

export interface SwapOrder {
  srcToken: string;
  dstToken: string;
  /** Who receives the result. */
  receiver: string;
  /** How much of the source coin goes in, in its base units. */
  amount: bigint;
  /** The least of the destination coin the receiver must get, or the trade is refused on-chain. */
  minReturn: bigint;
  feeReceivers: string[];
  feeAmounts: bigint[];
}

/** Read the order out of a transaction built for the router. Throws on anything it does not fully understand. */
export function decodeSwap(dataHex: string): SwapOrder {
  if (!/^0x([0-9a-fA-F]{2})+$/.test(dataHex) || dataHex.length < 10 + 64) throw new Error('Unreadable swap transaction');
  const selector = dataHex.slice(0, 10).toLowerCase();
  const body = hexToBytes(dataHex.slice(10));
  let desc: AbiValue;
  if (selector === SWAP_SELECTOR) desc = (abiDecode(swapArgs, body)[0] as AbiValue[])[3] as AbiValue;
  else if (selector === SIMPLE_SELECTOR) desc = abiDecode(simpleArgs, body)[1] as AbiValue;
  else throw new Error('Unknown swap method');
  const d = desc as AbiValue[];
  return {
    srcToken: d[0] as string,
    dstToken: d[1] as string,
    feeReceivers: d[4] as string[],
    feeAmounts: d[5] as bigint[],
    receiver: d[6] as string,
    amount: d[7] as bigint,
    minReturn: d[8] as bigint,
  };
}

export interface SwapExpectation {
  /** Router address the transaction is addressed to, as returned with it. */
  to: string;
  /** Coin value attached to the transaction. */
  value: bigint;
  srcToken: string;
  dstToken: string;
  receiver: string;
  amount: bigint;
  /** The least the user agreed to receive. */
  minReturn: bigint;
  /** The only address that may be paid a fee, if any. */
  feeReceiver: string | null;
  /** The largest fee agreed to, in hundredths of a percent. */
  feeBps: bigint;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Check a built swap against what the user was shown. Throws with the reason
 * on the first thing that does not match; returns the decoded order otherwise.
 */
export function checkSwap(dataHex: string, want: SwapExpectation): SwapOrder {
  if (!same(want.to, SWAP_ROUTER)) throw new Error('Swap is addressed to an unknown contract');
  const order = decodeSwap(dataHex);
  if (!same(order.srcToken, want.srcToken) || !same(order.dstToken, want.dstToken)) throw new Error('Swap is for other coins');
  if (!same(order.receiver, want.receiver)) throw new Error('Swap would pay someone else');
  if (order.amount !== want.amount) throw new Error('Swap spends a different amount');
  const expectedValue = same(want.srcToken, SWAP_NATIVE) ? want.amount : 0n;
  if (want.value !== expectedValue) throw new Error('Swap carries the wrong amount of coin');
  if (order.minReturn < want.minReturn) throw new Error('Swap guarantees less than was shown');
  if (order.feeReceivers.length !== order.feeAmounts.length) throw new Error('Unreadable swap fee');
  for (const receiver of order.feeReceivers) {
    if (!want.feeReceiver || !same(receiver, want.feeReceiver)) throw new Error('Swap pays a fee to an unknown address');
  }
  if (order.feeAmounts.reduce((sum, fee) => sum + fee, 0n) > want.feeBps) throw new Error('Swap takes a larger fee than was shown');
  return order;
}

const SWAPPED_TOPIC = keccakText('Swapped(address,address,address,address,uint256,uint256)');

/**
 * What a finished swap actually paid out, read from the router's own record in
 * the transaction's receipt: Swapped(sender, srcToken, dstToken, dstReceiver,
 * spentAmount, returnAmount). Null when the receipt holds no such record for
 * this receiver and coin.
 */
export function swapReturned(
  logs: readonly { address?: unknown; topics?: unknown; data?: unknown }[],
  want: { dstToken: string; receiver: string },
): bigint | null {
  for (const log of logs) {
    if (typeof log.address !== 'string' || !same(log.address, SWAP_ROUTER)) continue;
    if (!Array.isArray(log.topics) || log.topics[0] !== SWAPPED_TOPIC) continue;
    if (typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{384}$/.test(log.data)) continue;
    const [, , dst, receiver, , returned] = abiDecode([address, address, address, address, uint, uint], hexToBytes(log.data.slice(2)));
    if (same(dst as string, want.dstToken) && same(receiver as string, want.receiver)) return returned as bigint;
  }
  return null;
}
