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
  const resolver = wordToAddress(await evmRpc(rpc, 'eth_call', [{ to: NAME_REGISTRY[parsed.chain], data: resolverOfData(node) }, 'latest']));
  if (!resolver) return null;
  let answer: unknown;
  try {
    answer = await evmRpc(rpc, 'eth_call', [{ to: resolver, data: addrOfData(node) }, 'latest']);
  } catch (e) {
    // A name kept outside the blockchain answers with a refusal that points elsewhere; me7 does not follow it.
    if (/revert|OffchainLookup|execution/i.test(String((e as Error).message))) return null;
    throw e;
  }
  const address = wordToAddress(answer);
  return address ? { ...parsed, address } : null;
}
