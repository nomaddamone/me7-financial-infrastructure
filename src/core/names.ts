import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { address, array, bool, bytes, bytes32, encodeCall, tuple, uint } from './abi.ts';

/**
 * Names that stand for an address: "anna.base.eth" on Base, "anna.eth" on Ethereum.
 * Both are read straight from the registry contract in the blockchain, with nobody in between.
 *
 * Only plain names are understood: small Latin letters, digits and the hyphen. A name can be
 * written with look-alike letters of another alphabet and lead to somebody else; telling those
 * apart safely takes a table of every script in the world, so such names are not resolved at all.
 */
export type NameChain = 'base' | 'ethereum';

export interface ParsedName {
  /** The name as it is looked up: lower case. */
  name: string;
  chain: NameChain;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Is this text a name me7 can look up? Null for anything else, an address included. */
export function parseName(input: string): ParsedName | null {
  const name = input.trim().toLowerCase();
  if (name.length > 255 || !name.endsWith('.eth')) return null;
  const labels = name.split('.');
  if (labels.length < 2 || labels.length > 4) return null;
  for (const label of labels) {
    // "xn--" marks a name of another alphabet written in Latin letters: the same look-alike risk.
    if (!LABEL.test(label) || label.startsWith('xn--')) return null;
  }
  return { name, chain: name.endsWith('.base.eth') ? 'base' : 'ethereum' };
}

/** The number a name goes by inside the registry (ENS "namehash"), as 0x-hex. */
export function namehash(name: string): string {
  let node: Uint8Array = new Uint8Array(32);
  for (const label of name.split('.').reverse()) node = keccak_256(concatBytes(node, keccak_256(utf8ToBytes(label))));
  return `0x${bytesToHex(node)}`;
}

/** The registries: ENS on Ethereum, and Base's own registry of *.base.eth names. */
export const NAME_REGISTRY: Record<NameChain, string> = {
  ethereum: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  base: '0xB94704422c2a1E396835A571837Aa5AE53285a95',
};

/** Ask the registry which contract keeps this name's records. */
export const resolverOfData = (node: string) => `0x${bytesToHex(encodeCall('resolver(bytes32)', [bytes32], [node]))}`;
/** Ask that contract for the address the name points to. */
export const addrOfData = (node: string) => `0x${bytesToHex(encodeCall('addr(bytes32)', [bytes32], [node]))}`;

/**
 * Issuing a name of one's own: "anna.base.eth", registered in Base's registry for a year and
 * pointed at the owner's address. The registry is paid in ETH; me7's service pays it and the gas,
 * and takes its fee in USDC (see server/relay-core.ts).
 *
 * Addresses of Base's own contracts, checked against the chain on 2026-11-13: the controller that
 * sells names and the resolver that keeps their records.
 */
export const NAME_CONTROLLER = '0xa7d2607c6BD39Ae9521e514026CBB078405Ab322';
export const NAME_RESOLVER = '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875';
/** Names are sold by the year. */
export const NAME_YEAR = 31_536_000n;

/** May this be the first part of a new name? Three characters at least, plain letters, digits and hyphens. */
export function isIssuableLabel(label: string): boolean {
  return label.length >= 3 && label.length <= 63 && LABEL.test(label) && !label.startsWith('xn--');
}

const text = (s: string) => utf8ToBytes(s);
/** Ask the controller what a year of this name costs, in wei. */
export const namePriceData = (label: string) => encodeCall('registerPrice(string,uint256)', [bytes, uint], [text(label), NAME_YEAR]);
/** Ask the controller whether this name is free to take. */
export const nameAvailableData = (label: string) => encodeCall('available(string)', [bytes], [text(label)]);

/**
 * The call that registers `label`.base.eth for a year to `owner` and points it at `owner`.
 * The name is never made anyone's "primary" name here: that record would go to whoever sends
 * the transaction, which is me7's service and not the owner.
 */
export function registerNameData(label: string, owner: string): Uint8Array {
  const node = namehash(`${label}.base.eth`);
  const setAddr = encodeCall('setAddr(bytes32,address)', [bytes32, address], [node, owner]);
  return encodeCall(
    'register((string,address,uint256,address,bytes[],bool,uint256[],uint256,bytes))',
    [tuple(bytes, address, uint, address, array(bytes), bool, array(uint), uint, bytes)],
    [[text(label), owner, NAME_YEAR, NAME_RESOLVER, [setAddr], false, [], 0n, new Uint8Array(0)]],
  );
}

const CENT = 10_000n;
/** The fee for a name, in USDC's units: what the registry and the gas cost, rounded up to a cent, plus the service's part. */
export function nameFee(registry: bigint, gas: bigint, service: bigint): bigint {
  return ((registry + gas + CENT - 1n) / CENT) * CENT + service;
}
