import { erc20TransferData } from '../core/erc20.ts';
import { signEvmTransaction, type EvmTransaction } from '../core/tx-evm.ts';
import { fetchEvmBalance } from '../net/balances.ts';
import { NET } from '../net/endpoints.ts';
import { broadcastEvm, estimateEvmGas, fetchErc20Balance, fetchEvmFees, fetchEvmNonce } from '../net/send.ts';
import { forgetRotation, rotationOwners, withAddressKey } from './addresses.ts';
import { BASE_L1_RESERVE } from './assets.ts';
import type { Wallet } from './wallet.ts';

/**
 * Moving USDC out of one of the wallet's Base addresses by the owner's own means: an ordinary
 * transfer signed by that address and paid for with ETH that sits on it. me7's service has no
 * part in it. This is the way out of an address in quarantine (see src/core/quarantine.ts),
 * whose money the service does not carry.
 */
export interface SelfOut {
  /** USDC on the address, all of which is sent, and the ETH on it. */
  held: bigint;
  coin: bigint;
  /** What the network will take at most, and how much ETH the address should hold for the transfer to be safe to send. */
  fee: bigint;
  need: bigint;
  /** The transfer, ready to sign; null while the address holds too little ETH or no USDC. */
  tx: EvmTransaction | null;
}

const hexOf = (bytes: Uint8Array) => `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** Whether `to` is one of the wallet's own addresses: money moved there would only carry the quarantine's cause along, unseen. */
export async function isOwnAddress(wallet: Wallet, to: string): Promise<boolean> {
  return (await rotationOwners(wallet)).some((o) => o.toLowerCase() === to.toLowerCase());
}

export async function planSelfOut(from: string, to: string): Promise<SelfOut> {
  const base = NET.base;
  if (!base) throw new Error('no Base network');
  const [fees, nonce, coin, held] = await Promise.all([fetchEvmFees(base.rpc), fetchEvmNonce(base.rpc, from), fetchEvmBalance(base.rpc, from).then((r) => r.value), fetchErc20Balance(base.rpc, base.usdc, from)]);
  const data = erc20TransferData(to, held > 0n ? held : 1n);
  const gasLimit = await estimateEvmGas(base.rpc, { from, to: base.usdc, value: 0n, data: hexOf(data) }, 200_000n);
  const fee = gasLimit * fees.maxFeePerGas;
  // A quarter more than today's price is asked for: the ETH is sent ahead, and the price moves meanwhile.
  const need = ((fee + BASE_L1_RESERVE) * 5n) / 4n;
  const enough = held > 0n && coin >= fee + BASE_L1_RESERVE;
  return { held, coin, fee, need, tx: enough ? { chainId: base.chainId, nonce, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas, gasLimit, to: base.usdc, value: 0n, data } : null };
}

/** Sign the transfer with the address's own key and hand it to the network. Returns the transaction's hash. */
export async function sendSelfOut(wallet: Wallet, holding: { index: number; address: string }, tx: EvmTransaction): Promise<string> {
  const base = NET.base;
  if (!base) throw new Error('no Base network');
  const signed = await withAddressKey(wallet, holding, (key) => signEvmTransaction(tx, key));
  const hash = await broadcastEvm(base.rpc, signed.raw, signed.hash);
  forgetRotation(wallet);
  return hash;
}
