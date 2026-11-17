import { crossAssetName, swapFloor, type SwapOrder, type SwapQuote } from '../core/cross.ts';
import { buildEthGasPair } from '../core/ethgas.ts';
import { planFromPockets } from '../core/rotation.ts';
import { signEvmTransaction } from '../core/tx-evm.ts';
import { erc20TransferData } from '../core/erc20.ts';
import { fetchEvmBalance, formatUnits } from '../net/balances.ts';
import { fetchCrossProgress, fetchCrossSwapQuote, tellCrossDeposit } from '../net/cross.ts';
import { CROSS, ETH_GASLESS, NET, SWAP_FEE } from '../net/endpoints.ts';
import { fetchEthGasTerms, fetchRelayPricing, relayEthSend } from '../net/relay.ts';
import { fetchErc20Balance, fetchEvmFees, type UsdPrices } from '../net/send.ts';
import { loadRotation } from './addresses.ts';
import { ASSETS, BASE_L1_RESERVE, evmOf, type AssetDef } from './assets.ts';
import { sendEvmCall } from './evm-call.ts';
import { announcePlan, sendPlan } from './home.tsx';
import { withEvmKey, type Wallet } from './wallet.ts';

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

/**
 * How what is given leaves the wallet. USDC on Base, and USDT and USDC on Ethereum, always go through
 * me7's own service on that network: it pays the gas, and its fee, taken in the coin given, is what me7
 * earns on the swap. Any other coin leaves the main address by an ordinary transfer the wallet pays the gas for.
 */
export type BridgeWay = 'base' | 'eth' | 'own';
export function bridgeWay(wallet: Wallet, from: AssetDef): BridgeWay {
  const keyed = wallet.seed instanceof Uint8Array && wallet.seed.length === 64;
  if (keyed && NET.base && from.contract === NET.base.usdc) return 'base';
  if (keyed && NET.mode === 'mainnet' && from.kind === 'erc20' && from.chain !== 'base' && !!from.contract && from.contract.toLowerCase() in ETH_GASLESS.tokens) return 'eth';
  return 'own';
}

export interface BridgePlan {
  from: AssetDef;
  to: AssetDef;
  amountIn: bigint;
  quote: SwapQuote;
  way: BridgeWay;
  /** me7's fee for carrying the deposit, in the units of the coin given; nought when the wallet pays the gas itself. */
  fee: bigint;
  /** The most the network will take for sending the deposit, in wei; nought when me7's service pays it. */
  gas: bigint;
}

/** An address that stands in for the service's, which is not known until the swap is ordered: only its place in a plan matters. */
const STAND_IN = '0x000000000000000000000000000000000000dEaD';

/** Where a refund returns to. USDC on Base goes back to the address shown for receiving, as any payment to the wallet would; the rest to the main address. */
async function refundAddress(wallet: Wallet, way: BridgeWay): Promise<string> {
  return way === 'base' ? (await loadRotation(wallet)).receive.address : wallet.evm;
}

const order = (wallet: Wallet, from: AssetDef, to: AssetDef, amountIn: bigint, deadline: number, refundTo: string): SwapOrder => ({
  origin: bridgeName(from) ?? '',
  destination: bridgeName(to) ?? '',
  recipient: ownAddress(wallet, to),
  refundTo,
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

/** The price of a swap, asked without binding anyone. `units` null means all that can be given. Throws 'no-funds', 'no-gas', 'no-relay' or 'needs-mix', me7's service's refusal, or the crossing service's own words. */
export async function planBridge(wallet: Wallet, from: AssetDef, to: AssetDef, units: bigint | null, prices: UsdPrices): Promise<BridgePlan> {
  const way = bridgeWay(wallet, from);
  const priced = async (amountIn: bigint, fee: bigint): Promise<BridgePlan> => ({
    from,
    to,
    amountIn,
    way,
    fee,
    gas: 0n,
    quote: await fetchCrossSwapQuote(CROSS.api, order(wallet, from, to, amountIn, Date.now() + CROSS.lifetime, await refundAddress(wallet, way)), true, floorFor(from, to, amountIn, prices)),
  });
  if (way === 'base') {
    // USDC on Base: from whichever of the wallet's addresses hold it, one pocket at a time, through me7's service.
    const [rotation, pricing] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
    if (!pricing) throw new Error('no-relay');
    const planned = planFromPockets(rotation.spendable, units === null ? { all: STAND_IN } : [{ to: STAND_IN, value: units }], pricing, rotation.fresh, { prefer: 'plain', choice: 'auto', mix: false });
    if (typeof planned === 'string') throw new Error(planned === 'needs-mix' ? 'needs-mix' : planned === 'too-many' ? 'too-many' : 'no-funds');
    return priced(planned.plan.payouts.reduce((sum, p) => sum + p.value, 0n), planned.plan.fee);
  }
  if (way === 'eth') {
    const token = from.contract ?? '';
    const held = await fetchErc20Balance(NET.evm.rpc, token, wallet.evm);
    if (held <= 0n) throw new Error('no-funds');
    const terms = await fetchEthGasTerms(wallet.evm, token, STAND_IN, units ?? held);
    // The real terms are asked again once the service's address is known, and may differ by a little: room is left for that.
    const amountIn = units ?? held - terms.fee - terms.fee / 10n;
    if (amountIn <= 0n || amountIn + terms.fee > held) throw new Error('no-funds');
    return priced(amountIn, terms.fee);
  }
  const chain = evmOf(from);
  const native = from.kind === 'eth';
  const [coin, fees] = await Promise.all([fetchEvmBalance(chain.rpc, wallet.evm).then((r) => r.value), fetchEvmFees(chain.rpc)]);
  const held = native ? coin : await fetchErc20Balance(chain.rpc, from.contract ?? '', wallet.evm);
  const gas = (native ? COIN_GAS : TRANSFER_GAS) * fees.maxFeePerGas + (from.chain === 'base' ? BASE_L1_RESERVE : 0n);
  const amountIn = units ?? (native ? held - gas : held);
  if (amountIn <= 0n || amountIn > held) throw new Error('no-funds');
  if (gas > (native ? coin - amountIn : coin)) throw new Error('no-gas');
  const quote = await fetchCrossSwapQuote(CROSS.api, order(wallet, from, to, amountIn, Date.now() + CROSS.lifetime, wallet.evm), true, floorFor(from, to, amountIn, prices));
  return { from, to, amountIn, quote, way, fee: 0n, gas };
}

/** What an amount would buy on another network, for the form to show while it is typed. Binds nobody and checks no balance. */
export async function estimateBridge(wallet: Wallet, from: AssetDef, to: AssetDef, amountIn: bigint): Promise<bigint> {
  return (await fetchCrossSwapQuote(CROSS.api, order(wallet, from, to, amountIn, Date.now() + CROSS.lifetime, wallet.evm), true, 0n)).amountOut;
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
function forget(wallet: Wallet, id: string): void {
  try {
    localStorage.setItem(storeKey(wallet), JSON.stringify(loadBridgings(wallet).filter((b) => b.id !== id)));
  } catch {
    /* it stays as a swap that was never sent, which is not shown */
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
  const real = await fetchCrossSwapQuote(CROSS.api, order(wallet, plan.from, plan.to, plan.amountIn, deadline, await refundAddress(wallet, plan.way)), false, floorFor(plan.from, plan.to, plan.amountIn, prices));
  // What was shown is what is done: a price that moved by more than a third of a percent is asked about again.
  if (real.minOut < plan.quote.minOut - plan.quote.minOut / 300n || !real.depositAddress) throw new Error('moved');
  const record: Bridging = { id: `${Date.now()}-${real.depositAddress.slice(2, 10)}`, fromId: plan.from.id, toId: plan.to.id, amountIn: plan.amountIn.toString(), minOut: real.minOut.toString(), deposit: real.depositAddress, tx: '', started: Date.now(), deadline, stage: 'open', delivered: '' };
  // Nothing leaves before the swap is written down: without the note a closed tab could not be told where the money went.
  if (!save(wallet, record)) throw new Error('unsaved');
  let tx: string;
  try {
    tx = await sendDeposit(wallet, plan, real.depositAddress);
  } catch (err) {
    // Nothing left the wallet: the swap that was written down never began.
    forget(wallet, record.id);
    throw err;
  }
  const sent = { ...record, tx };
  save(wallet, sent);
  void tellCrossDeposit(CROSS.api, sent.deposit, sent.tx);
  return sent;
}

/** Send what is given to the crossing service's address, by the way that suits the coin. Returns the transaction's hash; throws if nothing was sent. */
async function sendDeposit(wallet: Wallet, plan: BridgePlan, deposit: string): Promise<string> {
  if (plan.way === 'base') {
    const [rotation, pricing] = await Promise.all([loadRotation(wallet, true), fetchRelayPricing()]);
    if (!pricing) throw new Error('no-relay');
    const planned = planFromPockets(rotation.spendable, [{ to: deposit, value: plan.amountIn }], pricing, rotation.fresh, { prefer: 'plain', choice: 'auto', mix: false });
    if (typeof planned === 'string') throw new Error(planned === 'needs-mix' ? 'needs-mix' : planned === 'too-many' ? 'too-many' : 'no-funds');
    // me7's fee is what was shown, or a hair less: a dearer one is asked about again.
    if (planned.plan.fee > plan.fee + plan.fee / 20n) throw new Error('moved');
    announcePlan(planned.plan);
    return sendPlan(wallet, planned.plan);
  }
  if (plan.way === 'eth') {
    const token = plan.from.contract ?? '';
    const terms = await fetchEthGasTerms(wallet.evm, token, deposit, plan.amountIn);
    if (terms.fee > plan.fee + plan.fee / 10n) throw new Error('moved');
    const pair = buildEthGasPair(NET.evm.chainId, token, deposit, plan.amountIn, terms);
    return withEvmKey(wallet, (key) => relayEthSend(signEvmTransaction(pair.fee, key).raw, signEvmTransaction(pair.main, key).raw));
  }
  const chain = evmOf(plan.from);
  const receipt = plan.from.kind === 'eth' ? await sendEvmCall(chain, wallet, deposit, new Uint8Array(0), plan.amountIn) : await sendEvmCall(chain, wallet, plan.from.contract ?? '', erc20TransferData(deposit, plan.amountIn));
  return receipt.hash;
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
