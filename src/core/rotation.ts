import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { gaslessFee, GASLESS_MAX_TRANSFERS, type Authorization, type GaslessPricing } from './gasless.ts';

/**
 * Many addresses, one balance.
 *
 * USDC on Base is received on a new address each time the previous one has
 * been paid to, so that one payer sees only their own payment and not the
 * whole balance. All the addresses come from the same seed (the next index on
 * the usual path), and the pocket shows their sum.
 *
 * Paying from them works like a purse of coins: if one address holds enough,
 * the payment goes from it; if not, the fewest addresses that together hold
 * enough are emptied onto a fresh address of the same wallet, and the payment
 * goes from there. All of it is one operation through the relay.
 */
export interface Holding {
  /** The address's number on the seed's path; 0 is the wallet's main address. */
  index: number;
  address: string;
  balance: bigint;
  /** Whether this address has already sent through the relay (see firstSpendNonce). */
  spent: boolean;
}

/**
 * The number every address uses for its first transfer through the relay.
 * An address that received money and was later emptied has a zero balance and
 * no transactions of its own (the relay sent them), so nothing else on the
 * chain would tell it apart from an address never used. USDC remembers which
 * numbers an address has used, so asking it about this one answers "has this
 * address ever sent?", and a wallet restored from its seed can find its place.
 */
export function firstSpendNonce(address: string): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(`me7 first spend ${address.toLowerCase()}`)))}`;
}

/** An address counts as used once it holds money or has ever sent any. */
export const isUsed = (h: Holding): boolean => h.balance > 0n || h.spent;

/** The address to show for receiving: the first one, after the main address, that has never been used. */
export function receiveIndex(holdings: readonly Holding[]): number {
  const used = new Set(holdings.filter(isUsed).map((h) => h.index));
  for (let i = 1; ; i++) if (!used.has(i)) return i;
}

export interface Payout {
  to: string;
  value: bigint;
}

export interface PaymentPlan {
  /** What is taken from which address. One entry: the payment goes straight from it. */
  sources: { holding: Holding; value: bigint }[];
  /** The fresh address the money is gathered on, when it comes from several. */
  via: { index: number; address: string } | null;
  payouts: Payout[];
  fee: bigint;
  /** How many transfers the relay will carry, not counting the fee. */
  transfers: number;
}

export type PlanProblem = 'no-funds' | 'too-many';

/** The most addresses one operation may draw from; the rest of the room is for payouts. */
export const MAX_SOURCES = 25;

const distinct = (payouts: readonly Payout[]) => new Set(payouts.map((p) => p.to.toLowerCase())).size;
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

/**
 * Decide where the money for these payouts comes from.
 *
 * One address that holds enough is preferred, and of those the one with the
 * least on it: the recipient then learns of a small balance, not a big one.
 * Otherwise the largest addresses are taken until they cover the payouts and
 * the fee, which keeps the operation as small as it can be; the last of them
 * gives only what is still missing, so nothing is left behind on the fresh address.
 */
export function planPayment(holdings: readonly Holding[], payouts: readonly Payout[], pricing: GaslessPricing, fresh: { index: number; address: string }): PaymentPlan | PlanProblem {
  if (payouts.length === 0 || payouts.some((p) => p.value <= 0n)) return 'no-funds';
  const paid = sum(payouts.map((p) => p.value));
  const recipients = distinct(payouts);
  const funded = holdings.filter((h) => h.balance > 0n).sort((a, b) => (a.balance < b.balance ? 1 : a.balance > b.balance ? -1 : a.index - b.index));

  const directFee = gaslessFee(pricing, payouts.length, recipients);
  const enough = funded.filter((h) => h.balance >= paid + directFee);
  const single = enough[enough.length - 1];
  if (single) {
    if (payouts.length > GASLESS_MAX_TRANSFERS) return 'too-many';
    return { sources: [{ holding: single, value: paid + directFee }], via: null, payouts: [...payouts], fee: directFee, transfers: payouts.length };
  }
  for (let k = 2; k <= funded.length; k++) {
    const fee = gaslessFee(pricing, k + payouts.length, recipients);
    const chosen = funded.slice(0, k);
    const need = paid + fee;
    const held = sum(chosen.map((h) => h.balance));
    if (held < need) continue;
    if (k > MAX_SOURCES || k + payouts.length > GASLESS_MAX_TRANSFERS) return 'too-many';
    const last = chosen[k - 1] as Holding;
    const sources = chosen.map((holding) => ({ holding, value: holding === last ? need - (held - last.balance) : holding.balance }));
    return { sources, via: fresh, payouts: [...payouts], fee, transfers: k + payouts.length };
  }
  return 'no-funds';
}

/** Send everything to one recipient: every address is emptied, and the recipient gets the total less the fee. */
export function planSendAll(holdings: readonly Holding[], to: string, pricing: GaslessPricing, fresh: { index: number; address: string }): PaymentPlan | PlanProblem {
  const funded = holdings.filter((h) => h.balance > 0n).sort((a, b) => (a.balance < b.balance ? 1 : a.balance > b.balance ? -1 : a.index - b.index));
  if (funded.length === 0) return 'no-funds';
  if (funded.length > MAX_SOURCES) return 'too-many';
  const total = sum(funded.map((h) => h.balance));
  const single = funded.length === 1;
  const transfers = single ? 1 : funded.length + 1;
  const fee = gaslessFee(pricing, transfers, 1);
  if (total <= fee) return 'no-funds';
  return {
    sources: funded.map((holding) => ({ holding, value: holding.balance })),
    via: single ? null : fresh,
    payouts: [{ to, value: total - fee }],
    fee,
    transfers,
  };
}

/**
 * Bring everything onto the wallet's main address, which the swap, the P2P
 * withdrawal and trading work from. The main address pays the fee out of what arrives.
 */
export function planCollect(holdings: readonly Holding[], pricing: GaslessPricing): PaymentPlan | PlanProblem {
  const main = holdings.find((h) => h.index === 0);
  const others = holdings.filter((h) => h.index !== 0 && h.balance > 0n).sort((a, b) => (a.balance < b.balance ? 1 : a.balance > b.balance ? -1 : a.index - b.index));
  if (!main || others.length === 0) return 'no-funds';
  if (others.length > MAX_SOURCES) return 'too-many';
  const fee = gaslessFee(pricing, others.length, 0);
  if (sum(others.map((h) => h.balance)) + main.balance <= fee) return 'no-funds';
  return { sources: others.map((holding) => ({ holding, value: holding.balance })), via: { index: 0, address: main.address }, payouts: [], fee, transfers: others.length };
}

/** A permission still to be signed, and which of the wallet's addresses must sign it. */
export type Unsigned = Authorization & { index: number };

/**
 * Turn a plan into the permissions to sign, in the order the relay must carry
 * them out: the gathering, then the payouts, then the fee. `random` gives a
 * fresh 32-byte number as 0x-hex each time it is called.
 */
export function planAuthorizations(
  plan: PaymentPlan,
  options: { feeReceiver: string; now: bigint; lifetime: bigint; random: () => string },
): { transfers: Unsigned[]; fee: Unsigned } {
  const window = { validAfter: 0n, validBefore: options.now + options.lifetime };
  // Each address marks its first transfer through the relay; after that its numbers are random.
  const marked = new Set<string>();
  const nonceFor = (address: string, alreadySpent: boolean) => {
    const key = address.toLowerCase();
    if (alreadySpent || marked.has(key)) return options.random();
    marked.add(key);
    return firstSpendNonce(address);
  };
  const transfers: Unsigned[] = [];
  const payer = plan.via ?? (plan.sources[0] as { holding: Holding }).holding;
  const payerSpent = plan.via ? plan.via.index === 0 : (payer as Holding).spent;
  if (plan.via) {
    for (const { holding, value } of plan.sources) {
      transfers.push({ index: holding.index, from: holding.address, to: plan.via.address, value, ...window, nonce: nonceFor(holding.address, holding.spent || holding.index === 0) });
    }
  }
  for (const payout of plan.payouts) {
    transfers.push({ index: payer.index, from: payer.address, to: payout.to, value: payout.value, ...window, nonce: nonceFor(payer.address, payerSpent) });
  }
  const fee: Unsigned = { index: payer.index, from: payer.address, to: options.feeReceiver, value: plan.fee, ...window, nonce: nonceFor(payer.address, payerSpent) };
  return { transfers, fee };
}
