import { isValidEvmAddress, toChecksumAddress } from '../core/evm.ts';
import { addrOfData, NAME_REGISTRY, namehash, parseName, resolverOfData, type NameChain } from '../core/names.ts';
import { NET } from './endpoints.ts';
import { evmRpc } from './send.ts';

const ZERO = '0x0000000000000000000000000000000000000000';
/** The last twenty bytes of a 32-byte answer, as an address; null when the answer is not one. */
function wordToAddress(answer: unknown): string | null {
  if (typeof answer !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(answer)) return null;
  if (!/^0x0{24}/.test(answer)) return null;
  const address = `0x${answer.slice(26)}`;
  return isValidEvmAddress(address) && address.toLowerCase() !== ZERO ? toChecksumAddress(address) : null;
}

export interface ResolvedName {
  name: string;
  chain: NameChain;
  address: string;
}

/** The nodes of the network a name lives on; none in test mode, where these registries do not exist. */
function nodesOf(chain: NameChain): readonly string[] | null {
  if (NET.mode !== 'mainnet') return null;
  return chain === 'base' ? (NET.base?.rpc ?? null) : NET.evm.rpc;
}

/**
 * One read of the chain that two nodes must agree on. A name becomes an address money is sent to, and a single
 * node could answer with its own: so each node is asked by itself, and the answer counts only when at least two
 * give it and none gives another. Throws when fewer than two answer, or when they differ.
 */
async function agreed(rpc: readonly string[], call: { to: string; data: string }): Promise<unknown> {
  const answers = await Promise.allSettled(rpc.slice(0, 4).map((url) => evmRpc([url], 'eth_call', [call, 'latest'])));
  const given = answers.flatMap((a) => (a.status === 'fulfilled' && typeof a.value === 'string' ? [a.value.toLowerCase()] : []));
  if (given.length >= 2) {
    if (new Set(given).size !== 1) throw new Error('The nodes disagree about this name');
    return given[0];
  }
  // Two nodes that both refuse the call say the same thing too: the caller reads what the refusal means.
  const refused = answers.flatMap((a) => (a.status === 'rejected' && /revert|OffchainLookup|execution/i.test(String((a.reason as Error | null)?.message)) ? [a.reason as Error] : []));
  if (refused.length >= 2 && given.length === 0) throw refused[0] as Error;
  throw new Error('Too few nodes answered to trust a name');
}

/**
 * The address a name points to, read from the blockchain: first which contract keeps the name's
 * records, then the address in it. Null when the text is not a name, the name is not registered
 * or it has no address. Throws when the nodes cannot be reached, so "not found" is never a guess.
 */
export async function resolveName(input: string): Promise<ResolvedName | null> {
  const parsed = parseName(input);
  if (!parsed) return null;
  const rpc = nodesOf(parsed.chain);
  if (!rpc) return null;
  const node = namehash(parsed.name);
  const resolver = wordToAddress(await agreed(rpc, { to: NAME_REGISTRY[parsed.chain], data: resolverOfData(node) }));
  if (!resolver) return null;
  let answer: unknown;
  try {
    answer = await agreed(rpc, { to: resolver, data: addrOfData(node) });
  } catch (e) {
    // A name kept outside the blockchain answers with a refusal that points elsewhere; me7 does not follow it.
    if (/revert|OffchainLookup|execution/i.test(String((e as Error).message))) return null;
    throw e;
  }
  const address = wordToAddress(answer);
  return address ? { ...parsed, address } : null;
}
