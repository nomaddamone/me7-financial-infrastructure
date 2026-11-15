import { trc20BalanceOfParameter, trc20TransferData } from '../core/tron.ts';
import { withFallback } from './fallback.ts';

/** One call to a Tron node's HTTP API, with fallback across nodes. */
async function tronPost(endpoints: readonly string[], path: string, body: unknown): Promise<Record<string, unknown>> {
  const { value } = await withFallback(endpoints, async (base, signal) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('Malformed response');
    return json as Record<string, unknown>;
  });
  return value;
}

const amount = (value: unknown, fallback?: bigint): bigint => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Malformed response');
  return BigInt(value);
};
const hexText = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export interface TronAccount {
  /** False for an address that has never received anything: sending to it costs an activation fee. */
  exists: boolean;
  /** Sun (1 TRX = 1,000,000 sun). */
  balance: bigint;
}

export async function fetchTronAccount(endpoints: readonly string[], address: string): Promise<TronAccount> {
  const body = await tronPost(endpoints, '/wallet/getaccount', { address, visible: true });
  if (body.Error) throw new Error('Malformed response');
  return { exists: typeof body.address === 'string', balance: amount(body.balance, 0n) };
}

async function constantCall(
  endpoints: readonly string[],
  owner: string,
  contract: string,
  selector: string,
  parameter: string,
): Promise<{ result: string; energy: bigint }> {
  const body = await tronPost(endpoints, '/wallet/triggerconstantcontract', {
    owner_address: owner,
    contract_address: contract,
    function_selector: selector,
    parameter,
    visible: true,
  });
  const ok = (body.result as { result?: unknown } | undefined)?.result === true;
  const first = (body.constant_result as unknown[] | undefined)?.[0];
  if (!ok || typeof first !== 'string' || !/^[0-9a-f]{64}$/i.test(first)) throw new Error('Contract call failed');
  return { result: first, energy: amount(body.energy_used, 0n) };
}

/** TRC-20 token balance in the token's base units. */
export async function fetchTrc20Balance(endpoints: readonly string[], contract: string, owner: string): Promise<bigint> {
  const { result } = await constantCall(endpoints, owner, contract, 'balanceOf(address)', trc20BalanceOfParameter(owner));
  return BigInt(`0x${result}`);
}

/**
 * Whether the token's issuer has frozen the address. USDT's contract keeps that list itself
 * and answers for free; money on a frozen address stays there for good.
 */
export async function fetchTrc20Frozen(endpoints: readonly string[], contract: string, address: string): Promise<boolean> {
  const { result } = await constantCall(endpoints, address, contract, 'isBlackListed(address)', trc20BalanceOfParameter(address));
  return BigInt(`0x${result}`) !== 0n;
}

/** Energy a token transfer would burn, found by running it on a node without sending it. */
export async function estimateTrc20Energy(
  endpoints: readonly string[],
  contract: string,
  from: string,
  to: string,
  value: bigint,
): Promise<bigint> {
  const parameter = hexText(trc20TransferData(to, value)).slice(8);
  const { energy } = await constantCall(endpoints, from, contract, 'transfer(address,uint256)', parameter);
  if (energy <= 0n || energy > 2_000_000n) throw new Error('Energy estimate out of range');
  return energy;
}

/** The newest block: its id and time anchor a transaction and set its expiry. */
export async function fetchTronBlock(endpoints: readonly string[]): Promise<{ id: string; timestamp: number }> {
  const body = await tronPost(endpoints, '/wallet/getnowblock', {});
  const id = body.blockID;
  const timestamp = (body.block_header as { raw_data?: { timestamp?: unknown } } | undefined)?.raw_data?.timestamp;
  if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id) || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)) {
    throw new Error('Malformed response');
  }
  return { id, timestamp };
}

export interface TronFeeRates {
  /** Sun burned per byte when the account has no free bandwidth left. */
  perByte: bigint;
  /** Sun burned per unit of energy the account doesn't have. */
  perEnergy: bigint;
  /** Sun burned when a transfer activates a brand-new address. */
  newAccount: bigint;
}

export async function fetchTronFeeRates(endpoints: readonly string[]): Promise<TronFeeRates> {
  const body = await tronPost(endpoints, '/wallet/getchainparameters', {});
  const list = body.chainParameter;
  if (!Array.isArray(list)) throw new Error('Malformed response');
  const get = (key: string) => amount((list as { key?: unknown; value?: unknown }[]).find((p) => p.key === key)?.value);
  const rates = {
    perByte: get('getTransactionFee'),
    perEnergy: get('getEnergyFee'),
    newAccount: get('getCreateNewAccountFeeInSystemContract') + get('getCreateAccountFee'),
  };
  // A node must not be able to talk us into an absurd fee.
  if (rates.perByte > 100_000n || rates.perEnergy > 100_000n || rates.newAccount > 100_000_000n) {
    throw new Error('Fee data out of range');
  }
  return rates;
}

export interface TronResources {
  /** Bytes the account can still send for free today. */
  bandwidth: bigint;
  /** Energy the account has from staking. */
  energy: bigint;
}

export async function fetchTronResources(endpoints: readonly string[], address: string): Promise<TronResources> {
  const body = await tronPost(endpoints, '/wallet/getaccountresource', { address, visible: true });
  const left = (limit: unknown, used: unknown) => {
    const rest = amount(limit, 0n) - amount(used, 0n);
    return rest > 0n ? rest : 0n;
  };
  const free = left(body.freeNetLimit, body.freeNetUsed);
  const staked = left(body.NetLimit, body.NetUsed);
  // The two bandwidth pools are not combined: a transaction must fit into one of them.
  return { bandwidth: free > staked ? free : staked, energy: left(body.EnergyLimit, body.EnergyUsed) };
}

/** Broadcast a signed transaction (hex). Returns its id; a rejection becomes an Error with the node's message. */
export async function broadcastTron(endpoints: readonly string[], signedHex: string, txid: string): Promise<string> {
  let body: Record<string, unknown>;
  try {
    body = await tronPost(endpoints, '/wallet/broadcasthex', { transaction: signedHex });
  } catch (e) {
    const reasons = (e as { failures?: { reason: string }[] }).failures?.map((f) => f.reason) ?? [];
    throw new Error(reasons.find((r) => r !== 'timeout') ?? reasons[0] ?? 'Broadcast failed');
  }
  if (body.result === true) return typeof body.txid === 'string' && /^[0-9a-f]{64}$/.test(body.txid) ? body.txid : txid;
  // The same transaction sent twice (a retry after a lost answer) is already on its way.
  if (body.code === 'DUP_TRANSACTION_ERROR') return txid;
  let message = typeof body.message === 'string' ? body.message : '';
  if (/^([0-9a-f]{2})+$/i.test(message)) {
    // Nodes hex-encode the human-readable reason.
    message = new TextDecoder().decode(Uint8Array.from(message.match(/../g) ?? [], (h) => parseInt(h, 16)));
  }
  throw new Error([body.code, message].filter((x) => typeof x === 'string' && x).join(': ').slice(0, 200) || 'Broadcast failed');
}
