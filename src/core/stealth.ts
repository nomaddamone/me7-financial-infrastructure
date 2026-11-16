import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { abiEncode, address, bytes, bytes32, encodeCall, uint } from './abi.ts';
import { toChecksumAddress } from './evm.ts';
import { deriveKey } from './hd.ts';

/**
 * Stealth addresses (ERC-5564, scheme 1: secp256k1 with view tags).
 *
 * The receiver publishes two public keys, the stealth meta-address. Whoever pays takes them,
 * makes up a key used once, and from the two works out an address nobody has seen before and
 * only the receiver can spend from. Beside the payment the payer leaves a note on the chain
 * (the announcement): the public half of the once-used key. It means nothing to anyone but
 * the receiver, whose viewing key turns it back into the same address.
 *
 *   payer:     s = eph · V            receiver:  s = v · EPH
 *              h = keccak256(s)                  h = keccak256(s)
 *              address of S + h·G                key = spend + h   (mod n)
 *
 * s is the shared point in its compressed form (33 bytes), as the reference implementation
 * (ScopeLift's stealth-address-sdk) hashes it; the first byte of h is the view tag, by which
 * the receiver throws out 255 notes in 256 without the costlier steps.
 *
 * THE DERIVATION PATHS AND THE ARITHMETIC BELOW MUST NEVER CHANGE. Money sent to a stealth
 * address can be found and spent only by repeating them exactly. The test suite pins them.
 */
export const STEALTH_SCHEME = 1n;
/** ERC-5564's announcer and ERC-6538's registry: the same addresses on every chain that has them. */
export const STEALTH_ANNOUNCER = '0x55649E01B5Df198D18D95b5cc5051630cfD45564';
export const STEALTH_REGISTRY = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538';
/** keccak256("Announcement(uint256,address,address,bytes,bytes)"): the announcer's only event. */
export const ANNOUNCEMENT_TOPIC = '0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7';

/** Where the two keys come from in the account's seed. Hardened, so the viewing key says nothing of the spending one. */
const SPEND_PATH = "m/5564'/0'/0'";
const VIEW_PATH = "m/5564'/0'/1'";
const N = secp256k1.Point.Fn.ORDER;

export interface StealthKeys {
  spend: Uint8Array;
  view: Uint8Array;
  /** Compressed public keys, 33 bytes each. */
  spendPub: Uint8Array;
  viewPub: Uint8Array;
}

/** The account's stealth keys. The viewing key finds payments; only the spending key can move them. */
export function stealthKeys(seed: Uint8Array): StealthKeys {
  const spend = deriveKey(seed, SPEND_PATH);
  const view = deriveKey(seed, VIEW_PATH);
  return { spend: spend.privateKey, view: view.privateKey, spendPub: spend.publicKey, viewPub: view.publicKey };
}

/** The meta-address: the spending and the viewing public key, one after the other, as 0x-hex (132 digits). */
export function stealthMetaAddress(keys: Pick<StealthKeys, 'spendPub' | 'viewPub'>): string {
  return `0x${bytesToHex(keys.spendPub)}${bytesToHex(keys.viewPub)}`;
}

/** The meta-address as it is handed to a payer: st:<chain>:0x… */
export const stealthCode = (meta: string, chain = 'base'): string => `st:${chain}:${meta}`;

function point(compressed: Uint8Array) {
  // Throws unless the bytes are a point of the curve: a made-up key cannot be paid to.
  const p = secp256k1.Point.fromBytes(compressed);
  p.assertValidity();
  return p;
}

export interface StealthTarget {
  chain: string | null;
  meta: string;
  spendPub: Uint8Array;
  viewPub: Uint8Array;
}

/**
 * Read what a payer was given: "st:<chain>:0x<spend><view>", or the bare 0x form. Null unless
 * it is exactly two valid compressed keys. A single key (the standard allows one key for both
 * uses) is not accepted: this wallet never issues one, and paying to it would let whoever can
 * see the payments spend them.
 */
export function parseStealthCode(text: string): StealthTarget | null {
  const m = /^(?:st:([a-z0-9]{1,16}):)?(0x[0-9a-fA-F]{132})$/.exec(text.trim());
  if (!m) return null;
  const meta = (m[2] as string).toLowerCase();
  try {
    const spendPub = hexToBytes(meta.slice(2, 68));
    const viewPub = hexToBytes(meta.slice(68));
    point(spendPub);
    point(viewPub);
    return { chain: m[1] ?? null, meta, spendPub, viewPub };
  } catch {
    return null;
  }
}

const addressOfPoint = (uncompressed: Uint8Array): string => toChecksumAddress(bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12)));

/** h = keccak256 of the shared point, compressed. Its first byte is the view tag. */
function sharedHash(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return keccak_256(secp256k1.getSharedSecret(privateKey, publicKey, true));
}

function scalar(h: Uint8Array): bigint {
  const k = BigInt(`0x${bytesToHex(h)}`);
  // The reference treats h as a private key, which zero and anything past the curve's order are not.
  if (k === 0n || k >= N) throw new Error('stealth: unusable shared secret');
  return k;
}

export interface StealthPayment {
  address: string;
  /** The public half of the once-used key, compressed (33 bytes): what the announcement carries. */
  ephemeralPubKey: Uint8Array;
  viewTag: number;
}

/**
 * The payer's side: the address to pay for this meta-address, with the once-used key given.
 * The key must be fresh random bytes for every payment; reusing one gives the same address.
 */
export function stealthAddressFor(target: Pick<StealthTarget, 'spendPub' | 'viewPub'>, ephemeralKey: Uint8Array): StealthPayment {
  const h = sharedHash(ephemeralKey, target.viewPub);
  const stealth = point(target.spendPub).add(secp256k1.Point.BASE.multiply(scalar(h)));
  return { address: addressOfPoint(stealth.toBytes(false)), ephemeralPubKey: secp256k1.getPublicKey(ephemeralKey, true), viewTag: h[0] as number };
}

export interface StealthMatch {
  address: string;
  /** h: what is added to the spending key to get this address's key. */
  tweak: Uint8Array;
}

/**
 * The receiver's side: is this announcement mine? With the view tag given, a note meant for
 * someone else is nearly always dropped after one multiplication. The viewing key is enough.
 */
export function matchAnnouncement(keys: Pick<StealthKeys, 'view' | 'spendPub'>, ephemeralPubKey: Uint8Array, viewTag?: number): StealthMatch | null {
  let h: Uint8Array;
  try {
    h = sharedHash(keys.view, ephemeralPubKey);
  } catch {
    return null; // not a point of the curve: somebody's junk
  }
  if (viewTag !== undefined && h[0] !== viewTag) return null;
  try {
    const stealth = point(keys.spendPub).add(secp256k1.Point.BASE.multiply(scalar(h)));
    return { address: addressOfPoint(stealth.toBytes(false)), tweak: h };
  } catch {
    return null;
  }
}

/** The private key of a stealth address: the spending key plus the tweak, modulo the curve's order. */
export function stealthPrivateKey(spend: Uint8Array, tweak: Uint8Array): Uint8Array {
  const k = (BigInt(`0x${bytesToHex(spend)}`) + scalar(tweak)) % N;
  if (k === 0n) throw new Error('stealth: unusable key');
  return hexToBytes(k.toString(16).padStart(64, '0'));
}

/** The note's metadata for a token transfer: the view tag, transfer(address,uint256), the token, the amount. */
export function tokenMetadata(viewTag: number, token: string, amount: bigint): Uint8Array {
  const out = new Uint8Array(57);
  out[0] = viewTag;
  out.set([0xa9, 0x05, 0x9c, 0xbb], 1);
  out.set(hexToBytes(token.slice(2).toLowerCase()), 5);
  out.set(hexToBytes(amount.toString(16).padStart(64, '0')), 25);
  return out;
}

/** Call data for the announcer: leave the note beside the payment. Anyone may make the call. */
export function announceData(payment: Pick<StealthPayment, 'address' | 'ephemeralPubKey'>, metadata: Uint8Array): Uint8Array {
  return encodeCall('announce(uint256,address,bytes,bytes)', [uint, address, bytes, bytes], [STEALTH_SCHEME, payment.address, payment.ephemeralPubKey, metadata]);
}

/** One announcement as the chain logs it. */
export interface Announcement {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number | undefined;
  metadata: Uint8Array;
}

/**
 * Read an announcement from a log's topics and data. Null for anything that is not a scheme-1
 * announcement with a 33-byte key: the announcer takes whatever it is given, so logs may be junk.
 */
export function readAnnouncement(topics: readonly string[], data: string): Announcement | null {
  try {
    if (topics.length !== 4 || topics[0]?.toLowerCase() !== ANNOUNCEMENT_TOPIC || BigInt(topics[1] as string) !== STEALTH_SCHEME) return null;
    const body = hexToBytes(data.replace(/^0x/, ''));
    const word = (at: number) => Number(BigInt(`0x${bytesToHex(body.subarray(at, at + 32))}`));
    const field = (head: number) => {
      const at = word(head);
      const length = word(at);
      if (at + 32 + length > body.length) throw new Error('short');
      return body.slice(at + 32, at + 32 + length);
    };
    const ephemeralPubKey = field(0);
    const metadata = field(32);
    if (ephemeralPubKey.length !== 33) return null;
    return { stealthAddress: toChecksumAddress((topics[2] as string).slice(-40)), ephemeralPubKey, viewTag: metadata[0], metadata };
  } catch {
    return null;
  }
}

/* ---------- the registry: the meta-address tied to an address, so a name can lead to it ---------- */

/** keccak256("Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)"), as the registry itself reports. */
const ENTRY_TYPEHASH = '0xad167d3025c204a322703b7e9c41f6179d0d174570f484391f50080b960d41d6';

/** What the owner of an address signs to have their meta-address written into the registry by someone else (who pays the gas). */
export function registryEntryDigest(domainSeparator: string, meta: string, nonce: bigint): Uint8Array {
  const struct = keccak_256(abiEncode([bytes32, uint, bytes32, uint], [ENTRY_TYPEHASH, STEALTH_SCHEME, `0x${bytesToHex(keccak_256(hexToBytes(meta.slice(2))))}`, nonce]));
  const out = new Uint8Array(66);
  out.set([0x19, 0x01], 0);
  out.set(hexToBytes(domainSeparator.slice(2)), 2);
  out.set(struct, 34);
  return keccak_256(out);
}

/** The owner's signature over a registry entry: r, s, v, as the registry reads it. */
export function signRegistryEntry(domainSeparator: string, meta: string, nonce: bigint, privateKey: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(registryEntryDigest(domainSeparator, meta, nonce), privateKey, { prehash: false, format: 'recovered' });
  const out = new Uint8Array(65);
  out.set(sig.slice(1, 65), 0);
  out[64] = 27 + (sig[0] ?? 0);
  return out;
}

/** Call data: write `registrant`'s meta-address into the registry on their signature. */
export function registerOnBehalfData(registrant: string, signature: Uint8Array, meta: string): Uint8Array {
  return encodeCall('registerKeysOnBehalf(address,uint256,bytes,bytes)', [address, uint, bytes, bytes], [registrant, STEALTH_SCHEME, signature, hexToBytes(meta.slice(2))]);
}

/** Call data: read the meta-address registered for an address. */
export function metaAddressOfData(registrant: string): Uint8Array {
  return encodeCall('stealthMetaAddressOf(address,uint256)', [address, uint], [registrant, STEALTH_SCHEME]);
}
