import { crossAssetName, swapFloor, type SwapOrder, type SwapQuote } from '../core/cross.ts';
import { erc20TransferData } from '../core/erc20.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { fetchCrossProgress, fetchCrossSwapQuote, tellCrossDeposit } from '../net/cross.ts';
import { CROSS, NET, SWAP_FEE } from '../net/endpoints.ts';
import { fetchErc20Balance, fetchEvmFees, type UsdPrices } from '../net/send.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, type AssetDef } from './assets.ts';
import { sendEvmCall } from './evm-call.ts';
import type { Wallet } from './wallet.ts';

/**
 * Swapping a coin for a coin on another network, through the crossing service (NEAR Intents).
 * What is given leaves the wallet's main address by an ordinary transfer the wallet pays the gas
 * for; what it buys arrives on the wallet's own address on the other network. In between the
 * money is in the service's hands: it is a third party, and this is said on the screen.
 *
 * A swap under way is written down in this browser before anything is sent, so that a closed tab
 * can be told how it ended.
 */
export interface Bridging {
  id: string;
  fromId: string;
  toId: string;
  amountIn: string;
  /** The least the service bound itself to deliver. */
  minOut: string;
  deposit: string;
  /** The transaction that carried the deposit; empty until it is sent. */
  tx: string;
  started: number;
  deadline: number;
  stage: 'open' | 'done' | 'refunded' | 'failed';
  /** What was delivered, once known. */
  delivered: string;
}

/** The service's name for one of the wallet's coins; null for a coin it does not carry. */
export function bridgeName(a: AssetDef): string | null {
  try {
    if (a.kind === 'btc') return crossAssetName('btc');
    if (a.kind === 'trx') return crossAssetName('tron');
    if (a.kind === 'trc20') return a.contract === NET.tron.usdt ? CROSS.destination : null;
    return crossAssetName(a.chain === 'base' ? 'base' : 'eth', a.kind === 'erc20' ? a.contract : undefined);
  } catch {
    return null;
  }
}

/** What a coin can be swapped for on other networks. Only on the main networks: the service has no test ones. */
export function bridgeTargets(from: AssetDef): AssetDef[] {
  if (NET.mode !== 'mainnet' || !bridgeName(from)) return [];
  return ASSETS.filter((a) => a.net !== from.net && bridgeName(a) !== null);
}

/** The wallet's own address on the network a coin lives on. */
export const ownAddress = (wallet: Wallet, a: AssetDef): string => (a.kind === 'btc' ? wallet.btc : a.kind === 'trx' || a.kind === 'trc20' ? wallet.tron : wallet.evm);

/** `units` of one coin, counted in another at outside prices. Rough on purpose: it only sets a floor. */
function worth(units: bigint, from: AssetDef, to: AssetDef, prices: UsdPrices): bigint {
  const usd = Number(formatUnits(units, from.decimals, from.decimals)) * prices[from.price];
  const out = usd / prices[to.price];
  if (!Number.isFinite(out) || out <= 0) throw new Error('no price');
  const fine = Math.min(to.decimals, 8);
  return BigInt(Math.floor(out * 10 ** fine)) * 10n ** BigInt(to.decimals - fine);
}

export interface BridgePlan {
  from: AssetDef;
  to: AssetDef;
  amountIn: bigint;
  quote: SwapQuote;
  /** The most the network will take for sending the deposit, in wei. */
  gas: bigint;
}

const order = (wallet: Wallet, from: AssetDef, to: AssetDef, amountIn: bigint, deadline: number): SwapOrder => ({
  origin: bridgeName(from) ?? '',
  destination: bridgeName(to) ?? '',
  recipient: ownAddress(wallet, to),
  refundTo: wallet.evm,
  amountIn,
  slippageBps: CROSS.slippageBps,
  deadline,
  ...(CROSS.swapFeeBps > 0 && SWAP_FEE.receiver ? { fee: { recipient: SWAP_FEE.receiver, bps: CROSS.swapFeeBps } } : {}),
});

const floorFor = (from: AssetDef, to: AssetDef, amountIn: bigint, prices: UsdPrices): bigint => {
  const usdc = ASSETS.find((a) => a.price === 'usdc');
  const flat = usdc ? worth(BigInt(CROSS.swapFlatUsd) * 10n ** BigInt(usdc.decimals), usdc, to, prices) : 0n;
  return swapFloor(worth(amountIn, from, to, prices), CROSS.swapLossBps, flat);
};

const TRANSFER_GAS = 100_000n;
const COIN_GAS = 21_000n;

/** The price of a swap, asked without binding anyone. `units` null means all that can be given. Throws 'no-funds' or 'no-gas', or the service's own words. */
export async function planBridge(wallet: Wallet, from: AssetDef, to: AssetDef, units: bigint | null, prices: UsdPrices): Promise<BridgePlan> {
  const chain = evmOf(from);
  const native = from.kind === 'eth';
  const [coin, fees] = await Promise.all([fetchEvmBalance(chain.rpc, wallet.evm).then((r) => r.value), fetchEvmFees(chain.rpc)]);
  const held = native ? coin : await fetchErc20Balance(chain.rpc, from.contract ?? '', wallet.evm);
  const gas = (native ? COIN_GAS : TRANSFER_GAS) * fees.maxFeePerGas + (from.chain === 'base' ? BASE_L1_RESERVE : 0n);
  const amountIn = units ?? (native ? held - gas : held);
  if (amountIn <= 0n || amountIn > held) throw new Error('no-funds');
  if (gas > (native ? coin - amountIn : coin)) throw new Error('no-gas');
  const quote = await fetchCrossSwapQuote(CROSS.api, order(wallet, from, to, amountIn, Date.now() + CROSS.lifetime), true, floorFor(from, to, amountIn, prices));
  return { from, to, amountIn, quote, gas };
}

/** What an amount would buy on another network, for the form to show while it is typed. Binds nobody and checks no balance. */
export async function estimateBridge(wallet: Wallet, from: AssetDef, to: AssetDef, amountIn: bigint): Promise<bigint> {
  return (await fetchCrossSwapQuote(CROSS.api, order(wallet, from, to, amountIn, Date.now() + CROSS.lifetime), true, 0n)).amountOut;
}

const storeKey = (wallet: Wallet) => `me7.bridge.${NET.mode}.${wallet.evm.toLowerCase()}`;
const isText = (v: unknown): v is string => typeof v === 'string';

export function loadBridgings(wallet: Wallet): Bridging[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storeKey(wallet)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return (raw as Bridging[]).filter((b) => !!b && isText(b.id) && isText(b.fromId) && isText(b.toId) && isText(b.amountIn) && isText(b.minOut) && isText(b.deposit) && isText(b.tx) && isText(b.delivered) && ['open', 'done', 'refunded', 'failed'].includes(b.stage));
  } catch {
    return [];
  }
}
function save(wallet: Wallet, one: Bridging): boolean {
  try {
    const list = loadBridgings(wallet);
    const at = list.findIndex((b) => b.id === one.id);
    localStorage.setItem(storeKey(wallet), JSON.stringify((at < 0 ? [...list, one] : list.map((b, i) => (i === at ? one : b))).slice(-30)));
    return true;
  } catch {
    return false;
  }
}
/** The swaps whose end is not known yet and whose deposit was sent. */
export const openBridgings = (wallet: Wallet): Bridging[] => loadBridgings(wallet).filter((b) => b.stage === 'open' && b.tx !== '');

/**
 * Do the swap that was shown: the binding price is asked (it may have moved a little, and not more),
 * the swap is written down, and the deposit is sent. Returns the record; from here `followBridge` tells how it ends.
 */
export async function startBridge(wallet: Wallet, plan: BridgePlan, prices: UsdPrices): Promise<Bridging> {
  const deadline = Date.now() + CROSS.lifetime;
  const real = await fetchCrossSwapQuote(CROSS.api, order(wallet, plan.from, plan.to, plan.amountIn, deadline), false, floorFor(plan.from, plan.to, plan.amountIn, prices));
  // What was shown is what is done: a price that moved by more than a third of a percent is asked about again.
  if (real.minOut < plan.quote.minOut - plan.quote.minOut / 300n || !real.depositAddress) throw new Error('moved');
  const record: Bridging = { id: `${Date.now()}-${real.depositAddress.slice(2, 10)}`, fromId: plan.from.id, toId: plan.to.id, amountIn: plan.amountIn.toString(), minOut: real.minOut.toString(), deposit: real.depositAddress, tx: '', started: Date.now(), deadline, stage: 'open', delivered: '' };
  // Nothing leaves before the swap is written down: without the note a closed tab could not be told where the money went.
  if (!save(wallet, record)) throw new Error('unsaved');
  const chain = evmOf(plan.from);
  const receipt = plan.from.kind === 'eth' ? await sendEvmCall(chain, wallet, real.depositAddress, new Uint8Array(0), plan.amountIn) : await sendEvmCall(chain, wallet, plan.from.contract ?? '', erc20TransferData(real.depositAddress, plan.amountIn));
  const sent = { ...record, tx: receipt.hash };
  save(wallet, sent);
  void tellCrossDeposit(CROSS.api, sent.deposit, sent.tx);
  return sent;
}

/** Ask how a swap stands, and write its end down when it has one. */
export async function followBridge(wallet: Wallet, one: Bridging): Promise<Bridging> {
  const { state, delivered } = await fetchCrossProgress(CROSS.api, one.deposit);
  const stage = state === 'done' ? 'done' : state === 'refunded' ? 'refunded' : state === 'failed' ? 'failed' : 'open';
  if (stage === 'open') return one;
  const next: Bridging = { ...one, stage, delivered: delivered?.toString() ?? '' };
  save(wallet, next);
  return next;
}
