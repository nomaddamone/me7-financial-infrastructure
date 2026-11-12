import { decodeUint256 } from '../core/erc20.ts';
import { erc20AllowanceData } from '../core/peer.ts';
import { SWAP_API, SWAP_FEE } from './endpoints.ts';
import { evmRpc } from './send.ts';

/** A route found by the aggregator. `summary` is handed back to it unchanged to build the transaction. */
export interface SwapRoute {
  summary: unknown;
  /** What the route is expected to return, in the destination coin's base units, after any fee. */
  amountOut: bigint;
  /** Gas the aggregator expects the swap to use. */
  gas: bigint;
}

const HEADERS = { 'x-client-id': 'me7' };
const digits = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) throw new Error('Malformed response');
  return BigInt(value);
};

interface Envelope {
  code?: unknown;
  message?: unknown;
  data?: Record<string, unknown> | null;
}
async function ask(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => null)) as Envelope | null;
  if (!res.ok || !body || body.code !== 0 || !body.data) {
    throw new Error(typeof body?.message === 'string' ? body.message.slice(0, 160) : `HTTP ${res.status}`);
  }
  return body.data;
}

/** Ask for the best route. The project's fee, when one is configured, is taken from what comes out. */
export async function fetchSwapRoute(
  network: string,
  swap: { tokenIn: string; tokenOut: string; amountIn: bigint },
): Promise<SwapRoute> {
  const query = new URLSearchParams({ tokenIn: swap.tokenIn, tokenOut: swap.tokenOut, amountIn: swap.amountIn.toString() });
  if (SWAP_FEE.receiver) {
    query.set('feeAmount', String(SWAP_FEE.bps));
    query.set('isInBps', 'true');
    query.set('chargeFeeBy', 'currency_out');
    query.set('feeReceiver', SWAP_FEE.receiver);
  }
  const data = await ask(`${SWAP_API}/${network}/api/v1/routes?${query}`, { headers: HEADERS });
  const summary = data.routeSummary as { amountOut?: unknown; gas?: unknown } | undefined;
  if (!summary || typeof summary !== 'object') throw new Error('Malformed response');
  const amountOut = digits(summary.amountOut);
  if (amountOut <= 0n) throw new Error('No route');
  return { summary, amountOut, gas: digits(summary.gas) };
}

export interface BuiltSwap {
  /** The contract the transaction is for. The caller checks it is the known router. */
  to: string;
  data: string;
  value: bigint;
}

/** Turn a route into a transaction that pays `sender` and tolerates the given price slip (in hundredths of a percent). */
export async function buildSwap(network: string, route: SwapRoute, sender: string, slippageBps: number): Promise<BuiltSwap> {
  const data = await ask(`${SWAP_API}/${network}/api/v1/route/build`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ routeSummary: route.summary, sender, recipient: sender, slippageTolerance: slippageBps }),
  });
  if (typeof data.routerAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(data.routerAddress)) throw new Error('Malformed response');
  if (typeof data.data !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(data.data)) throw new Error('Malformed response');
  return { to: data.routerAddress, data: data.data, value: digits(data.transactionValue) };
}

/** How much of a token `spender` may currently take from `owner`. */
export async function fetchTokenAllowance(rpc: readonly string[], token: string, owner: string, spender: string): Promise<bigint> {
  const result = await evmRpc(rpc, 'eth_call', [{ to: token, data: erc20AllowanceData(owner, spender) }, 'latest']);
  if (typeof result !== 'string') throw new Error('Malformed response');
  return decodeUint256(result);
}
