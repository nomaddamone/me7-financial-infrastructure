import { bytesToHex } from '@noble/hashes/utils.js';
import { erc20TransferData } from './erc20.ts';
import { toChecksumAddress } from './evm.ts';
import { readSignedEvmTransaction, type EvmTransaction } from './tx-evm.ts';

/**
 * A token on Ethereum without ETH. A token there moves only in a transaction of its owner's, and
 * a transaction is paid for in ETH. So the wallet signs two ordinary transfers, one of the fee to
 * me7 and one to the recipient, and hands them over unsent; me7's service puts on the owner's
 * address exactly the ETH the two will burn, and then sends them. Nothing can be changed on the
 * way: each transfer is signed whole, and the service can only deliver it or not.
 *
 * The fee goes first and the payment second (the network takes an address's transactions in the
 * order of their numbers), so the gas me7 lent cannot buy a payment that leaves the fee unpaid.
 */
export interface SignedTokenTransfer {
  from: string;
  to: string;
  /** The token's contract. */
  token: string;
  amount: bigint;
  chainId: bigint;
  nonce: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit: bigint;
  hash: string;
  /** The complete transaction, as it is broadcast. */
  raw: string;
}

/**
 * Read a signed token transfer back into its parts, strictly: a call of transfer(to, amount) on
 * the token and nothing else, carrying no ETH.
 */
export function readSignedTokenTransfer(raw: string): SignedTokenTransfer {
  const { tx, from, hash } = readSignedEvmTransaction(raw);
  const data = tx.data ? bytesToHex(tx.data) : '';
  if (tx.value !== 0n || !/^a9059cbb0{24}[0-9a-f]{40}[0-9a-f]{64}$/.test(data)) throw new Error('Not a token transfer');
  return {
    from,
    to: toChecksumAddress(`0x${data.slice(32, 72)}`),
    token: tx.to,
    amount: BigInt(`0x${data.slice(72)}`),
    chainId: tx.chainId,
    nonce: tx.nonce,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    gasLimit: tx.gasLimit,
    hash,
    raw: raw.toLowerCase(),
  };
}

/** What the service asks the two transfers to be made with, and what it charges. */
export interface EthGasTerms {
  /** The number of the owner's next transaction: the fee takes it, the payment the one after. */
  nonce: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Gas allowed to the payment and to the fee's transfer. */
  gasMain: bigint;
  gasFee: bigint;
  /** The fee, in the token's units, and where it goes. */
  fee: bigint;
  receiver: string;
}

export interface EthGasLimits {
  /** The fee is never below the service's own part, nor above this. */
  service: bigint;
  maxFee: bigint;
  receiver: string;
  /** No more than this is agreed to per unit of gas, and no more gas than this per transfer. */
  maxGasPrice: bigint;
  maxGas: bigint;
}

const digits = (value: unknown): bigint | null => (typeof value === 'string' && /^[0-9]{1,30}$/.test(value) ? BigInt(value) : null);

/** Read the service's terms as they arrive over the network. Throws on terms no honest service would give. */
export function readEthGasTerms(answer: unknown, limits: EthGasLimits): EthGasTerms {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>;
  const [nonce, maxFeePerGas, maxPriorityFeePerGas, gasMain, gasFee, fee] = [a.nonce, a.maxFeePerGas, a.maxPriorityFeePerGas, a.gasMain, a.gasFee, a.fee].map(digits);
  if (nonce === null || maxFeePerGas === null || maxPriorityFeePerGas === null || gasMain === null || gasFee === null || fee === null || nonce === undefined || maxFeePerGas === undefined || maxPriorityFeePerGas === undefined || gasMain === undefined || gasFee === undefined || fee === undefined) {
    throw new Error('malformed terms');
  }
  if (a.receiver !== limits.receiver) throw new Error('the fee goes elsewhere');
  if (fee < limits.service || fee > limits.maxFee) throw new Error('the fee is out of range');
  if (maxFeePerGas <= 0n || maxFeePerGas > limits.maxGasPrice || maxPriorityFeePerGas > maxFeePerGas) throw new Error('the gas price is out of range');
  for (const gas of [gasMain, gasFee]) if (gas < 21_000n || gas > limits.maxGas) throw new Error('the gas is out of range');
  return { nonce, maxFeePerGas, maxPriorityFeePerGas, gasMain, gasFee, fee, receiver: limits.receiver };
}

/** The two transfers, ready to sign: the fee with the owner's next number, the payment with the one after. */
export function buildEthGasPair(chainId: bigint, token: string, to: string, amount: bigint, terms: EthGasTerms): { fee: EvmTransaction; main: EvmTransaction } {
  const base = { chainId, maxPriorityFeePerGas: terms.maxPriorityFeePerGas, maxFeePerGas: terms.maxFeePerGas, to: token, value: 0n };
  return {
    fee: { ...base, nonce: terms.nonce, gasLimit: terms.gasFee, data: erc20TransferData(terms.receiver, terms.fee) },
    main: { ...base, nonce: terms.nonce + 1n, gasLimit: terms.gasMain, data: erc20TransferData(to, amount) },
  };
}

/** The most ETH the two transfers can burn: what the owner's address must hold before they are sent. */
export const ethGasNeed = (t: { maxFeePerGas: bigint; gasMain: bigint; gasFee: bigint }): bigint => (t.gasMain + t.gasFee) * t.maxFeePerGas;
