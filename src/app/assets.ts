import { NET } from '../net/endpoints.ts';
import type { PriceId } from '../net/send.ts';

/** Something the pocket can hold. Networks and contract addresses come from the active network config. */
export interface AssetDef {
  /** Unique key. The same coin on two networks (USDT) appears twice with different ids. */
  id: string;
  /** What the user sees: "usdt". */
  ticker: string;
  net: string;
  kind: 'eth' | 'erc20' | 'btc' | 'trx' | 'trc20';
  decimals: number;
  /** Decimal places shown in the interface. */
  shown: number;
  /** Which price to value it at. */
  price: PriceId;
  /** Token contract address, for the token kinds. */
  contract?: string;
  /** Set for coins on Base; without it the 'eth' and 'erc20' kinds live on the main EVM network. */
  chain?: 'base';
}

const evm = NET.evm.name;
const tron = NET.tron.name;

/**
 * Every coin the wallet shows. Base comes first, and USDC first of all: it is the network and the coin
 * the project is built around (payments without gas, P2P withdrawal, swaps), so it leads every list.
 */
export const ASSETS: readonly AssetDef[] = [
  ...(NET.base
    ? ([
        { id: 'usdc-base', ticker: 'usdc', net: NET.base.name, kind: 'erc20', decimals: 6, shown: 2, price: 'usdc', contract: NET.base.usdc, chain: 'base' },
        { id: 'eth-base', ticker: 'eth', net: NET.base.name, kind: 'eth', decimals: 18, shown: 6, price: 'eth', chain: 'base' },
        { id: 'cbbtc-base', ticker: 'cbbtc', net: NET.base.name, kind: 'erc20', decimals: 8, shown: 6, price: 'btc', contract: NET.base.cbbtc, chain: 'base' },
      ] satisfies AssetDef[])
    : []),
  { id: 'eth', ticker: 'eth', net: evm, kind: 'eth', decimals: 18, shown: 6, price: 'eth' },
  { id: 'btc', ticker: 'btc', net: NET.btc.name, kind: 'btc', decimals: 8, shown: 8, price: 'btc' },
  { id: 'trx', ticker: 'trx', net: tron, kind: 'trx', decimals: 6, shown: 4, price: 'trx' },
  { id: 'usdt-tron', ticker: 'usdt', net: tron, kind: 'trc20', decimals: 6, shown: 2, price: 'usdt', contract: NET.tron.usdt },
  { id: 'usdt', ticker: 'usdt', net: evm, kind: 'erc20', decimals: 6, shown: 2, price: 'usdt', contract: NET.evm.tokens.usdt },
  { id: 'usdc', ticker: 'usdc', net: evm, kind: 'erc20', decimals: 6, shown: 2, price: 'usdc', contract: NET.evm.tokens.usdc },
  { id: 'dai', ticker: 'dai', net: evm, kind: 'erc20', decimals: 18, shown: 2, price: 'dai', contract: NET.evm.tokens.dai },
  { id: 'link', ticker: 'link', net: evm, kind: 'erc20', decimals: 18, shown: 4, price: 'link', contract: NET.evm.tokens.link },
  // Wrapped bitcoin is priced as bitcoin, but it is a token: it cannot be sent to a Bitcoin address.
  ...(NET.evm.tokens.wbtc
    ? ([{ id: 'wbtc', ticker: 'wbtc', net: evm, kind: 'erc20', decimals: 8, shown: 6, price: 'btc', contract: NET.evm.tokens.wbtc }] satisfies AssetDef[])
    : []),
  ...(NET.evm.tokens.cbbtc
    ? ([{ id: 'cbbtc', ticker: 'cbbtc', net: evm, kind: 'erc20', decimals: 8, shown: 6, price: 'btc', contract: NET.evm.tokens.cbbtc }] satisfies AssetDef[])
    : []),
];

export const asset = (id: string): AssetDef => {
  const found = ASSETS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown asset ${id}`);
  return found;
};

/** The coin that pays the network fee for an asset: its network's own coin. */
export const feeAssetOf = (a: AssetDef): AssetDef =>
  a.kind === 'btc' ? a : a.kind === 'trx' || a.kind === 'trc20' ? asset('trx') : asset(a.chain === 'base' ? 'eth-base' : 'eth');

/** The EVM network an 'eth' or 'erc20' asset lives on. */
export function evmOf(a: AssetDef): { name: string; chainId: bigint; rpc: readonly string[]; explorerTx: (hash: string) => string; swap?: string } {
  if (a.chain === 'base' && NET.base) return NET.base;
  return NET.evm;
}

/**
 * Base charges, on top of gas, a small fee for publishing the transaction on Ethereum.
 * It is taken from the balance and is not part of the gas estimate, so this much ETH is
 * kept back when sending. A plain transfer costs a small fraction of it.
 */
export const BASE_L1_RESERVE = 20_000_000_000_000n; // 0.00002 ETH
