import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as btc from '@scure/btc-signer';
import type { BitcoinNetwork } from './hd.ts';

/** An unspent output of ours. */
export interface Utxo {
  txid: string;
  vout: number;
  /** Satoshi. */
  value: bigint;
}

export interface BitcoinSendPlan {
  inputs: Utxo[];
  /** What the recipient gets, in satoshi. */
  amount: bigint;
  fee: bigint;
  /** What comes back to us; 0 means no change output. */
  change: bigint;
  /** Estimated virtual size in bytes. */
  vsize: number;
}

export type BitcoinPlanError = 'insufficient-funds' | 'dust' | 'bad-input';
export class BitcoinSendError extends Error {
  readonly code: BitcoinPlanError;
  constructor(code: BitcoinPlanError) {
    super(code);
    this.name = 'BitcoinSendError';
    this.code = code;
  }
}

/** Outputs below the dust limit are refused by nodes as uneconomical. 546 is safe for every address type. */
const DUST = 546n;
/** Our own change goes to a native SegWit address, whose limit is lower. */
const CHANGE_DUST = 294n;
/** Native SegWit sizes in virtual bytes: fixed overhead, one of our inputs, one output. */
const OVERHEAD = 11;
const INPUT = 68;
const OUTPUT = 31;

const net = (network: BitcoinNetwork) => (network === 'mainnet' ? btc.NETWORK : btc.TEST_NETWORK);
const size = (inputs: number, outputs: number) => OVERHEAD + INPUT * inputs + OUTPUT * outputs;
const feeFor = (vsize: number, rate: number) => BigInt(Math.ceil(vsize * rate));

/** Smallest amount nodes will relay to this address; it depends on the address type. */
export function dustLimit(address: string, network: BitcoinNetwork): bigint {
  const type = btc.Address(net(network)).decode(address).type;
  return type === 'wpkh' ? 294n : type === 'tr' || type === 'wsh' ? 330n : DUST;
}

export function isValidBitcoinAddress(address: string, network: BitcoinNetwork): boolean {
  try {
    btc.Address(net(network)).decode(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Choose which coins to spend. Largest first, as few as needed. `amount` may be
 * 'max' to send everything. Change too small to be worth an output goes to the fee.
 * feeRate is in satoshi per virtual byte.
 */
export function planBitcoinSend(
  utxos: readonly Utxo[],
  amount: bigint | 'max',
  feeRate: number,
  dust: bigint = DUST,
): BitcoinSendPlan {
  if (!(feeRate > 0) || !Number.isFinite(feeRate)) throw new BitcoinSendError('bad-input');
  const coins = [...utxos].sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
  const sum = (list: readonly Utxo[]) => list.reduce((n, u) => n + u.value, 0n);

  if (amount === 'max') {
    if (coins.length === 0) throw new BitcoinSendError('insufficient-funds');
    const vsize = size(coins.length, 1);
    const fee = feeFor(vsize, feeRate);
    const send = sum(coins) - fee;
    if (send < dust) throw new BitcoinSendError(send <= 0n ? 'insufficient-funds' : 'dust');
    return { inputs: coins, amount: send, fee, change: 0n, vsize };
  }

  if (amount < dust) throw new BitcoinSendError(amount <= 0n ? 'bad-input' : 'dust');
  const inputs: Utxo[] = [];
  for (const coin of coins) {
    inputs.push(coin);
    const have = sum(inputs);
    const withChange = feeFor(size(inputs.length, 2), feeRate);
    if (have >= amount + withChange + CHANGE_DUST) {
      return { inputs, amount, fee: withChange, change: have - amount - withChange, vsize: size(inputs.length, 2) };
    }
    const noChange = feeFor(size(inputs.length, 1), feeRate);
    if (have >= amount + noChange) {
      // The leftover is too small for a change output; it becomes part of the fee.
      return { inputs, amount, fee: have - amount, change: 0n, vsize: size(inputs.length, 1) };
    }
  }
  throw new BitcoinSendError('insufficient-funds');
}

/** Build and sign the planned transaction. All inputs must belong to the given key's SegWit address. */
export function signBitcoinSend(
  plan: BitcoinSendPlan,
  to: string,
  changeAddress: string,
  privateKey: Uint8Array,
  network: BitcoinNetwork,
): { hex: string; txid: string } {
  const n = net(network);
  const script = btc.p2wpkh(secp256k1.getPublicKey(privateKey, true), n).script;
  const tx = new btc.Transaction();
  for (const input of plan.inputs) {
    // Sequence 0xfffffffd signals replace-by-fee, so a stuck transfer can be re-sent with a higher fee.
    tx.addInput({ txid: input.txid, index: input.vout, witnessUtxo: { script, amount: input.value }, sequence: 0xfffffffd });
  }
  tx.addOutputAddress(to, plan.amount, n);
  if (plan.change > 0n) tx.addOutputAddress(changeAddress, plan.change, n);
  tx.sign(privateKey);
  tx.finalize();
  if (tx.fee !== plan.fee) throw new Error('Signed fee differs from the planned fee');
  return { hex: tx.hex, txid: tx.id };
}
