import { hexToBytes } from '@noble/hashes/utils.js';
import { isValidEvmAddress } from './evm.ts';

/**
 * The two ERC-20 calls a wallet needs. Tokens (USDT, USDC, ...) are contracts:
 * a balance is read by calling the contract, and a transfer is a transaction
 * sent to the contract with the recipient and amount packed into its data.
 */

const BALANCE_OF = '70a08231';
const TRANSFER = 'a9059cbb';
const MAX_UINT256 = (1n << 256n) - 1n;

function word(address: string): string {
  if (!isValidEvmAddress(address)) throw new Error('Invalid EVM address');
  return address.slice(2).toLowerCase().padStart(64, '0');
}

/** Call data for balanceOf(owner), as 0x-hex for eth_call. */
export function erc20BalanceOfData(owner: string): string {
  return `0x${BALANCE_OF}${word(owner)}`;
}

/** Transaction data for transfer(to, amount). */
export function erc20TransferData(to: string, amount: bigint): Uint8Array {
  if (amount < 0n || amount > MAX_UINT256) throw new RangeError('Amount out of range');
  return hexToBytes(`${TRANSFER}${word(to)}${amount.toString(16).padStart(64, '0')}`);
}

/** Decode a single uint256 returned by a contract call. */
export function decodeUint256(hex: string): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Malformed contract response');
  return BigInt(hex);
}
