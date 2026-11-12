import { abiDecode, address, array, bool, bytes, bytes32, encodeCall, tuple, type AbiValue } from '../core/abi.ts';
import { MULTICALL3 } from '../core/gasless.ts';
import { firstSpendNonce, type Holding } from '../core/rotation.ts';
import { evmRpc } from './send.ts';

const hexOf = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytesOf = (hex: string) => Uint8Array.from(hex.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
const AGGREGATE = 'aggregate3((address,bool,bytes)[])';
const CALLS = [array(tuple(address, bool, bytes))];
const RESULTS = [array(tuple(bool, bytes))];

/** Several read-only calls to one contract answered by the node in one request, through Multicall3. */
async function readMany(rpc: readonly string[], target: string, calls: readonly Uint8Array[], block: string = 'latest'): Promise<Uint8Array[]> {
  const items: AbiValue[] = calls.map((data) => [target, false, data]);
  const answer = await evmRpc(rpc, 'eth_call', [{ to: MULTICALL3, data: hexOf(encodeCall(AGGREGATE, CALLS, [items])) }, block]);
  if (typeof answer !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(answer)) throw new Error('Malformed response');
  const [results] = abiDecode(RESULTS, bytesOf(answer)) as [AbiValue[]];
  if (results.length !== calls.length) throw new Error('Malformed response');
  return results.map((item) => {
    const [ok, returned] = item as [boolean, Uint8Array];
    if (!ok || returned.length !== 32) throw new Error('Malformed response');
    return returned;
  });
}

const word = (b: Uint8Array) => BigInt(hexOf(b));

/**
 * What each of these addresses holds in the token, and whether it has ever
 * sent through the relay. One request to the node covers a hundred addresses.
 */
export async function scanHoldings(rpc: readonly string[], token: string, addresses: readonly { index: number; address: string }[]): Promise<Holding[]> {
  const out: Holding[] = [];
  for (let at = 0; at < addresses.length; at += 100) {
    const part = addresses.slice(at, at + 100);
    const answers = await readMany(
      rpc,
      token,
      part.flatMap((a) => [
        encodeCall('balanceOf(address)', [address], [a.address]),
        encodeCall('authorizationState(address,bytes32)', [address, bytes32], [a.address, firstSpendNonce(a.address)]),
      ]),
    );
    part.forEach((a, i) => out.push({ ...a, balance: word(answers[2 * i] as Uint8Array), spent: word(answers[2 * i + 1] as Uint8Array) !== 0n }));
  }
  return out;
}

/** The request that asks a node for the sum of several addresses' token balances at a block, and how to read its answer. */
export function sumBalanceCall(token: string, owners: readonly string[]): { to: string; data: string } {
  const items: AbiValue[] = owners.map((owner) => [token, false, encodeCall('balanceOf(address)', [address], [owner])]);
  return { to: MULTICALL3, data: hexOf(encodeCall(AGGREGATE, CALLS, [items])) };
}
export function readSumBalance(answer: unknown): bigint {
  if (typeof answer !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(answer)) throw new Error('Malformed response');
  const [results] = abiDecode(RESULTS, bytesOf(answer)) as [AbiValue[]];
  return results.reduce<bigint>((total, item) => {
    const [ok, returned] = item as [boolean, Uint8Array];
    if (!ok || returned.length !== 32) throw new Error('Malformed response');
    return total + word(returned);
  }, 0n);
}
