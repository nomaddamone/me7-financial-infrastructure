import {
  decodeBytes,
  decodeBytes32Array,
  decodePeerDeposit,
  decodePeerRate,
  erc20AllowanceData,
  PEER_ESCROW,
  PEER_ORACLE_ADAPTER,
  peerCurrencyByHash,
  peerGetCurrenciesCall,
  peerGetDepositCall,
  peerGetMethodsCall,
  peerMethodByHash,
  peerRateCall,
  peerValidateFeedCall,
  type PeerCurrency,
} from '../core/peer.ts';
import { decodeUint256 } from '../core/erc20.ts';
import { PEER_API, PEER_INDEXER } from './endpoints.ts';
import { withFallback } from './fallback.ts';
import { evmRpc } from './send.ts';

const call = async (rpc: readonly string[], to: string, data: string): Promise<string> => {
  const result = await evmRpc(rpc, 'eth_call', [{ to, data }, 'latest']);
  if (typeof result !== 'string') throw new Error('Malformed response');
  return result;
};

/**
 * Register a payment handle with Peer and get back the hash that goes into the
 * deposit. Peer keeps the handle so that a buyer who reserves the deposit can be
 * told where to pay; the chain only ever sees the hash.
 */
export async function registerPeerPayee(platform: string, handle: string): Promise<string> {
  const res = await fetch(`${PEER_API}/v2/makers/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ processorName: platform, offchainId: handle }),
    signal: AbortSignal.timeout(20_000),
  });
  // A reply that is not JSON is reported below as a failure.
  const body = (await res.json().catch(() => null)) as {
    success?: unknown;
    message?: unknown;
    responseObject?: { hashedOnchainId?: unknown };
  } | null;
  const hash = body?.responseObject?.hashedOnchainId;
  if (!res.ok || body?.success !== true || typeof hash !== 'string') {
    const message = typeof body?.message === 'string' ? body.message.slice(0, 200) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || /^0x0{64}$/.test(hash)) throw new Error('Malformed response');
  return hash.toLowerCase();
}

/** How much of a token the escrow is currently allowed to take from the owner. */
export async function fetchAllowance(rpc: readonly string[], token: string, owner: string): Promise<bigint> {
  return decodeUint256(await call(rpc, token, erc20AllowanceData(owner, PEER_ESCROW)));
}

/**
 * The market rate the contract would use right now: units of the currency per
 * one USDC, scaled by 1e18. Read from the same adapter the deposit names, so
 * the number shown is the number the contract sees.
 */
export async function fetchPeerRate(rpc: readonly string[], currency: PeerCurrency): Promise<bigint> {
  const normalized = decodeBytes(await call(rpc, PEER_ORACLE_ADAPTER, peerValidateFeedCall(currency)));
  const { valid, rate } = decodePeerRate(await call(rpc, PEER_ORACLE_ADAPTER, peerRateCall(normalized)));
  // Sanity bounds: none of the offered currencies is worth less than a tenth or more than ten dollars.
  if (!valid || rate < 10n ** 17n || rate > 10n ** 19n) throw new Error('Rate unavailable');
  return rate;
}

/**
 * Gas a contract call needs, with a margin. Unlike a plain transfer there is no
 * safe guess: if the node says the call would fail, that is the answer, and it
 * is raised with the node's reason instead of signing a transaction that burns
 * its fee.
 */
export async function estimateCallGas(rpc: readonly string[], tx: { from: string; to: string; data: string; value?: string }): Promise<bigint> {
  let gas: unknown;
  try {
    gas = await evmRpc(rpc, 'eth_estimateGas', [tx]);
  } catch (e) {
    const reasons = (e as { failures?: { reason: string }[] }).failures?.map((f) => f.reason) ?? [];
    throw new Error(reasons.find((r) => r !== 'timeout') ?? 'Gas estimate failed');
  }
  if (typeof gas !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(gas)) throw new Error('Malformed response');
  const value = BigInt(gas);
  if (value < 21_000n || value > 3_000_000n) throw new Error('Gas estimate out of range');
  return (value * 13n) / 10n;
}

export interface Receipt {
  ok: boolean;
  logs: { address?: unknown; topics?: unknown; data?: unknown }[];
}

/** The receipt of a transaction, or null while it is still waiting to be included. */
async function receiptOnce(rpc: readonly string[], hash: string): Promise<Receipt | null> {
  const { value } = await withFallback(rpc, async (url, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: { status?: unknown; logs?: unknown } | null; error?: unknown } | null;
    if (!body || body.error) throw new Error('RPC error');
    if (body.result === null || body.result === undefined) return null;
    const { status, logs } = body.result;
    if ((status !== '0x1' && status !== '0x0') || !Array.isArray(logs)) throw new Error('Malformed response');
    return { ok: status === '0x1', logs: logs as Receipt['logs'] };
  });
  return value;
}

/** Wait until a broadcast transaction is included. Throws if that takes longer than the timeout. */
export async function waitForReceipt(rpc: readonly string[], hash: string, timeoutMs = 120_000): Promise<Receipt> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const receipt = await receiptOnce(rpc, hash);
      if (receipt) return receipt;
    } catch {
      /* a node hiccup: keep waiting */
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the transaction');
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Numbers of the deposits an address has made, from Peer's indexer. Used only
 * to find them (ordinary nodes cannot search that far back); what a deposit
 * holds is always read from the contract.
 */
export async function findPeerDepositIds(owner: string): Promise<bigint[]> {
  const query =
    'query($a:String!,$e:String!){Deposit(where:{depositor:{_ilike:$a},escrowAddress:{_ilike:$e}},limit:200){depositId}}';
  const res = await fetch(PEER_INDEXER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: owner, e: PEER_ESCROW } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { Deposit?: unknown } } | null;
  const rows = body?.data?.Deposit;
  if (!Array.isArray(rows)) throw new Error('Malformed response');
  const ids: bigint[] = [];
  for (const row of rows as { depositId?: unknown }[]) {
    const id = typeof row.depositId === 'number' ? String(row.depositId) : row.depositId;
    if (typeof id === 'string' && /^\d{1,15}$/.test(id)) ids.push(BigInt(id));
  }
  return ids;
}

export interface PeerOrder {
  id: bigint;
  /** Still for sale; can be taken back at any moment. */
  remaining: bigint;
  /** Reserved by buyers. */
  reserved: bigint;
  accepting: boolean;
  /** Payment method and currencies, when they are ones this app offers. */
  platform: string | null;
  currencies: PeerCurrency[];
}

/**
 * One order as the contract holds it now. Null when it is closed (sold out or
 * taken back) or when it does not belong to this owner.
 */
export async function fetchPeerOrder(rpc: readonly string[], id: bigint, owner: string): Promise<PeerOrder | null> {
  const deposit = decodePeerDeposit(await call(rpc, PEER_ESCROW, peerGetDepositCall(id)));
  if (!deposit || deposit.depositor !== owner.toLowerCase()) return null;
  let platform: string | null = null;
  let currencies: PeerCurrency[] = [];
  try {
    const [method] = decodeBytes32Array(await call(rpc, PEER_ESCROW, peerGetMethodsCall(id)));
    if (method) {
      platform = peerMethodByHash(method)?.label ?? null;
      const codes = decodeBytes32Array(await call(rpc, PEER_ESCROW, peerGetCurrenciesCall(id, method)));
      currencies = codes.map(peerCurrencyByHash).filter((c): c is PeerCurrency => c !== null);
    }
  } catch {
    /* the amounts above are what matters; the labels are a nicety */
  }
  return { id, remaining: deposit.remaining, reserved: deposit.reserved, accepting: deposit.accepting, platform, currencies };
}
