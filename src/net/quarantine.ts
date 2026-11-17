import { abiDecode, address, array, bool, bytes, encodeCall, tuple, type AbiValue } from '../core/abi.ts';
import { MULTICALL3 } from '../core/gasless.ts';
import { incomingLogsFilter, readIncomingLogs, type Incoming, type Taint } from '../core/quarantine.ts';
import { evmRpc } from './send.ts';

const hexOf = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytesOf = (hex: string) => Uint8Array.from(hex.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));

/**
 * Who paid the token to the wallet's addresses in each of these blocks. The blocks are known
 * already (the wallet's history found them), so each question covers one block and costs a node
 * next to nothing. Asked one after another: the free nodes turn away a burst.
 */
export async function fetchIncomingAt(rpc: readonly string[], token: string, owners: readonly string[], blocks: readonly number[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  for (const block of blocks) out.push(...readIncomingLogs(await evmRpc(rpc, 'eth_getLogs', [incomingLogsFilter(token, owners, block)]), token, owners));
  return out;
}

/**
 * Which of these senders are under sanctions (Chainalysis's oracle on the chain) or frozen by the
 * token's issuer (the token keeps that list itself). Both are contracts, so the answer comes from
 * the same nodes the wallet already reads, in one request per hundred senders, and no address
 * goes to anyone else. A sender on neither list is absent from the answer.
 */
export async function screenSenders(rpc: readonly string[], token: string, oracle: string, senders: readonly string[]): Promise<Map<string, Taint>> {
  const flagged = new Map<string, Taint>();
  for (let at = 0; at < senders.length; at += 100) {
    const part = senders.slice(at, at + 100);
    const calls: AbiValue[] = part.flatMap((s) => [
      [oracle, true, encodeCall('isSanctioned(address)', [address], [s])],
      [token, true, encodeCall('isBlacklisted(address)', [address], [s])],
    ]);
    const answer = await evmRpc(rpc, 'eth_call', [{ to: MULTICALL3, data: hexOf(encodeCall('aggregate3((address,bool,bytes)[])', [array(tuple(address, bool, bytes))], [calls])) }, 'latest']);
    if (typeof answer !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(answer)) throw new Error('Malformed response');
    const [results] = abiDecode([array(tuple(bool, bytes))], bytesOf(answer)) as [AbiValue[]];
    if (results.length !== calls.length) throw new Error('Malformed response');
    const yes = (i: number) => {
      const [ok, returned] = results[i] as [boolean, Uint8Array];
      // A list that does not answer must not pass for "not listed".
      if (!ok || returned.length !== 32) throw new Error('Malformed response');
      return returned[31] !== 0;
    };
    part.forEach((s, i) => {
      if (yes(2 * i)) flagged.set(s, 'sanctioned');
      else if (yes(2 * i + 1)) flagged.set(s, 'frozen');
    });
  }
  return flagged;
}
