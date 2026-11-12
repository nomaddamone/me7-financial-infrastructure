import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { abiEncode, address, array, bool, bytes, bytes32, encodeCall, tuple, uint, type AbiValue } from './abi.ts';
import { isValidEvmAddress, toChecksumAddress } from './evm.ts';

/**
 * Sending USDC without holding the network's coin.
 *
 * USDC lets its holder sign a permission, "move this much from me to that
 * address", which anyone may then carry to the network and pay the gas for
 * (EIP-3009, transferWithAuthorization). The pocket signs a list of them, the
 * transfers it wants made, and one more, the fee to me7. The relay puts them
 * all into one transaction, so either everything happens or nothing does.
 *
 * The transfers may come from several of the user's own addresses: first
 * gathering money onto a fresh address, then paying from it.
 *
 * A permission names its recipient and amount, and the signature covers both:
 * whoever carries it can deliver it or not, but cannot change it.
 */
export interface Authorization {
  from: string;
  to: string;
  value: bigint;
  /** Unix seconds: not valid before / at or after these moments. */
  validAfter: bigint;
  validBefore: bigint;
  /** 32 random bytes, 0x-hex. Each permission can be used once. */
  nonce: string;
}

export interface AuthorizationSignature {
  v: number;
  r: string;
  s: string;
}

export interface SignedAuthorization extends Authorization, AuthorizationSignature {}

/** The token as its own signature check knows it. */
export interface TokenDomain {
  name: string;
  version: string;
  chainId: bigint;
  contract: string;
}

const hex = (b: Uint8Array) => `0x${bytesToHex(b)}`;
const hashText = (text: string) => hex(keccak_256(utf8ToBytes(text)));

const DOMAIN_TYPE = hashText('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
const TRANSFER_TYPE = hashText('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');

/** The value the token contract mixes into every signature, so a permission for one token or chain is useless on another. */
export function domainSeparator(domain: TokenDomain): string {
  return hex(
    keccak_256(
      abiEncode([bytes32, bytes32, bytes32, uint, address], [DOMAIN_TYPE, hashText(domain.name), hashText(domain.version), domain.chainId, domain.contract]),
    ),
  );
}

function check(auth: Authorization): void {
  if (!isValidEvmAddress(auth.from) || !isValidEvmAddress(auth.to)) throw new Error('gasless: bad address');
  if (!/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) throw new Error('gasless: bad nonce');
  if (auth.value <= 0n || auth.validAfter < 0n || auth.validBefore <= auth.validAfter) throw new Error('gasless: bad amount or time');
}

/** The 32 bytes that are actually signed. */
export function authorizationDigest(domain: TokenDomain, auth: Authorization): Uint8Array {
  check(auth);
  const struct = keccak_256(
    abiEncode([bytes32, address, address, uint, uint, uint, bytes32], [TRANSFER_TYPE, auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce]),
  );
  const out = new Uint8Array(66);
  out.set([0x19, 0x01], 0);
  out.set(hexToBytes(domainSeparator(domain).slice(2)), 2);
  out.set(struct, 34);
  return keccak_256(out);
}

/** Sign a permission with the holder's key. */
export function signAuthorization(domain: TokenDomain, auth: Authorization, privateKey: Uint8Array): SignedAuthorization {
  const sig = secp256k1.sign(authorizationDigest(domain, auth), privateKey, { prehash: false, format: 'recovered' });
  return { ...auth, v: 27 + (sig[0] ?? 0), r: hex(sig.slice(1, 33)), s: hex(sig.slice(33, 65)) };
}

/** Who signed a permission: the address the token contract would compute. Throws on a malformed signature. */
export function authorizationSigner(domain: TokenDomain, signed: SignedAuthorization): string {
  if ((signed.v !== 27 && signed.v !== 28) || !/^0x[0-9a-fA-F]{64}$/.test(signed.r) || !/^0x[0-9a-fA-F]{64}$/.test(signed.s)) {
    throw new Error('gasless: bad signature');
  }
  const compact = new Uint8Array(65);
  compact[0] = signed.v - 27;
  compact.set(hexToBytes(signed.r.slice(2)), 1);
  compact.set(hexToBytes(signed.s.slice(2)), 33);
  const publicKey = secp256k1.recoverPublicKey(compact, authorizationDigest(domain, signed), { prehash: false });
  const point = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return toChecksumAddress(hex(keccak_256(point.subarray(1)).subarray(12)));
}

/** The call to the token that carries out a signed permission. Anyone may make it. */
export function authorizationCall(signed: SignedAuthorization): Uint8Array {
  return encodeCall(
    'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
    [address, address, uint, uint, uint, bytes32, uint, bytes32, bytes32],
    [signed.from, signed.to, signed.value, signed.validAfter, signed.validBefore, signed.nonce, BigInt(signed.v), signed.r, signed.s],
  );
}

/** Multicall3: the same contract at the same address on every EVM chain. It runs several calls as one transaction. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

/** Several calls as one: if any of them fails, the whole transaction is undone. */
export function allOrNothing(calls: readonly { to: string; data: Uint8Array }[]): Uint8Array {
  const items: AbiValue[] = calls.map((c) => [c.to, false, c.data]);
  return encodeCall('aggregate3((address,bool,bytes)[])', [array(tuple(address, bool, bytes))], [items]);
}

/** What the pocket sends to the relay: the transfers, in the order they must happen, and the fee. */
export interface GaslessRequest {
  chain: string;
  transfers: SignedAuthorization[];
  fee: SignedAuthorization;
}

/** The most transfers one request may carry. */
export const GASLESS_MAX_TRANSFERS = 40;

/**
 * What one request costs, in the token's base units: a fixed part, a part for
 * each recipient beyond the first few, and the relay's own gas expense.
 */
export interface GaslessPricing {
  base: bigint;
  /** Recipients covered by the fixed part, and the price of each one beyond them. */
  free: number;
  extra: bigint;
  /** The relay's gas expense for one transfer at current prices. */
  perCall: bigint;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * How many different recipients the transfers pay, as opposed to gathering the
 * sender's own money: a transfer to an address that itself sends later in the
 * same request, or pays its fee, is gathering. Nobody can pass a payment off
 * as gathering, because the recipient would have to sign a transfer of their own.
 */
export function countPayouts(transfers: readonly Authorization[], fee: Authorization): number {
  const paid = transfers.filter((t, i) => !same(fee.from, t.to) && !transfers.slice(i + 1).some((later) => same(later.from, t.to)));
  return new Set(paid.map((t) => t.to.toLowerCase())).size;
}

const CENT = 10_000n;

/** The fee for a request: the fixed part, extra recipients, and the gas expense rounded up to a cent. */
export function gaslessFee(pricing: GaslessPricing, transfers: number, payouts: number): bigint {
  const gas = pricing.perCall * BigInt(transfers + 1);
  const cents = gas <= 0n ? 1n : (gas + CENT - 1n) / CENT;
  return pricing.base + pricing.extra * BigInt(Math.max(0, payouts - pricing.free)) + cents * CENT;
}

/** What the relay accepts on one chain. */
export interface GaslessRules {
  domain: TokenDomain;
  feeReceiver: string;
  /** Prices as they are now; the gas part may have moved since the pocket asked, so half of it is enough. */
  pricing: GaslessPricing;
  /** Unix seconds now, and how long a permission must still be valid for the relay to take it. */
  now: bigint;
  margin: bigint;
}

export type GaslessProblem = 'bad-request' | 'bad-signature' | 'bad-fee' | 'expired';

/**
 * Decide whether a request is one the relay should carry. Everything that can
 * be checked without the network is checked here: every permission is really
 * signed by the address it takes money from, none is used twice, the fee goes
 * to me7 and is not too small, and none is about to expire.
 */
export function checkGaslessRequest(request: GaslessRequest, rules: GaslessRules): GaslessProblem | null {
  const { transfers, fee } = request;
  try {
    if (transfers.length < 1 || transfers.length > GASLESS_MAX_TRANSFERS) return 'bad-request';
    const all = [...transfers, fee];
    all.forEach(check);
    if (new Set(all.map((a) => `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`)).size !== all.length) return 'bad-request';
    const least = gaslessFee({ ...rules.pricing, perCall: rules.pricing.perCall / 2n }, transfers.length, countPayouts(transfers, fee));
    if (!same(fee.to, rules.feeReceiver) || fee.value < least) return 'bad-fee';
    for (const auth of all) {
      if (auth.validAfter > rules.now || auth.validBefore < rules.now + rules.margin) return 'expired';
      if (!same(authorizationSigner(rules.domain, auth), auth.from)) return 'bad-signature';
    }
  } catch {
    return 'bad-request';
  }
  return null;
}

/** The transaction the relay sends: every permission carried out, in order, through Multicall3. */
export function gaslessCall(token: string, request: GaslessRequest): { to: string; data: Uint8Array } {
  return { to: MULTICALL3, data: allOrNothing([...request.transfers, request.fee].map((auth) => ({ to: token, data: authorizationCall(auth) }))) };
}

/**
 * One payment from one address, with its fee, signed. `nonces` are 64 random
 * bytes from the caller. The permissions stay valid for `lifetime` seconds,
 * long enough for the relay to deliver them and no longer.
 */
export function signGaslessPayment(
  domain: TokenDomain,
  input: { from: string; to: string; amount: bigint; fee: bigint; feeReceiver: string; now: bigint; lifetime: bigint; nonces: Uint8Array },
  privateKey: Uint8Array,
): { transfers: SignedAuthorization[]; fee: SignedAuthorization } {
  if (input.nonces.length !== 64) throw new Error('gasless: need 64 random bytes');
  const window = { validAfter: 0n, validBefore: input.now + input.lifetime };
  return {
    transfers: [signAuthorization(domain, { from: input.from, to: input.to, value: input.amount, ...window, nonce: hex(input.nonces.subarray(0, 32)) }, privateKey)],
    fee: signAuthorization(domain, { from: input.from, to: input.feeReceiver, value: input.fee, ...window, nonce: hex(input.nonces.subarray(32)) }, privateKey),
  };
}
