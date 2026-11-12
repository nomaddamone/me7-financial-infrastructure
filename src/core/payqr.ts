import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { isValidBitcoinAddress } from './tx-bitcoin.ts';
import { isValidEvmAddress, toChecksumAddress } from './evm.ts';
import type { BitcoinNetwork } from './hd.ts';
import { isValidTronAddress } from './tron.ts';

/**
 * What goes into a QR code for receiving money, and what is read out of one.
 *
 * A code for receiving is the plain address: every wallet and exchange reads
 * that. A code that also asks for an amount is a payment link whose first
 * thing is still the recipient's address, so a reader that understands only
 * addresses pays the right place, and me7 fills in the coin and the amount.
 *
 * Reading is strict: an address of a known kind or a payment link of a known
 * shape. Anything else (a web link above all) is not acted on.
 */
export type PayNetwork = 'evm' | 'tron' | 'btc';

export interface PayRequest {
  network: PayNetwork;
  address: string;
  /** EVM only: the chain the sender asked for, when the code names one. */
  chainId?: bigint;
  /** The coin as me7 names it (an asset id), when the code was made by me7. */
  asset?: string;
  /** A token's contract, when the code is a standard token-transfer link. */
  token?: string;
  /** The amount as decimal text in the coin's own units ("12.5"), or in base units when `baseUnits` is set. */
  amount?: string;
  baseUnits?: boolean;
}

const normal = (address: string) => (address.startsWith('0x') ? address.toLowerCase() : address);
const digest = (address: string) => sha256(utf8ToBytes(`me7 address code v1:${normal(address)}`));

/**
 * A short code that stands for an address: eight digits, the same for the same
 * address on every device and in every language. Forty characters are never
 * compared by eye; eight digits can be read out over the phone. An address
 * changed anywhere gives a different code.
 */
export function addressCode(address: string): string {
  const h = digest(address);
  const n = (((h[0] ?? 0) << 24) | ((h[1] ?? 0) << 16) | ((h[2] ?? 0) << 8) | (h[3] ?? 0)) >>> 0;
  const text = String(n % 100_000_000).padStart(8, '0');
  return `${text.slice(0, 4)} ${text.slice(4)}`;
}

/**
 * A small picture of the address, for the eye: a 5x5 grid, mirrored left to
 * right like a face, so that two addresses rarely look alike. It goes beside
 * the code; the code is what gets compared when it matters.
 */
export function addressPattern(address: string): boolean[][] {
  const h = digest(address);
  return Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => {
      const column = x < 3 ? x : 4 - x;
      return (((h[4 + y] ?? 0) >> column) & 1) === 1;
    }),
  );
}

const AMOUNT = /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/;

/** The text for a receiving code: the bare address, or a payment link when a coin and an amount are asked for. */
export function buildPayText(request: { network: PayNetwork; address: string; chainId?: bigint; asset?: string; amount?: string }): string {
  const { network, address, amount } = request;
  if (!amount) return address;
  if (!AMOUNT.test(amount)) throw new Error('payqr: bad amount');
  // Bitcoin has a standard everyone reads; the others carry me7's own fields after the address.
  if (network === 'btc') return `bitcoin:${address}?amount=${amount}`;
  const scheme = network === 'tron' ? 'tron' : 'ethereum';
  const chain = network === 'evm' && request.chainId !== undefined ? `@${request.chainId}` : '';
  const coin = request.asset && /^[a-z0-9-]{1,24}$/.test(request.asset) ? `me7=${request.asset}&` : '';
  return `${scheme}:${address}${chain}?${coin}amount=${amount}`;
}

function query(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split('&')) {
    const at = part.indexOf('=');
    if (at > 0) out.set(part.slice(0, at).toLowerCase(), decodeURIComponent(part.slice(at + 1)));
  }
  return out;
}

/** Read a scanned or pasted text. Null when it is not something to pay to. */
export function parsePayText(input: string, bitcoin: BitcoinNetwork = 'mainnet'): PayRequest | null {
  const text = input.trim();
  if (text.length === 0 || text.length > 400) return null;
  try {
    if (isValidEvmAddress(text)) return { network: 'evm', address: toChecksumAddress(text) };
    if (isValidTronAddress(text)) return { network: 'tron', address: text };
    if (isValidBitcoinAddress(text, bitcoin)) return { network: 'btc', address: text };

    const colon = text.indexOf(':');
    if (colon < 1) return null;
    const scheme = text.slice(0, colon).toLowerCase();
    const rest = text.slice(colon + 1);
    const mark = rest.indexOf('?');
    const head = mark < 0 ? rest : rest.slice(0, mark);
    const fields = query(mark < 0 ? '' : rest.slice(mark + 1));
    const amount = fields.get('amount');
    const plain = amount !== undefined && AMOUNT.test(amount) ? { amount } : {};
    if (amount !== undefined && !AMOUNT.test(amount)) return null;

    if (scheme === 'bitcoin') {
      return isValidBitcoinAddress(head, bitcoin) ? { network: 'btc', address: head, ...plain } : null;
    }
    if (scheme === 'tron') {
      const asset = fields.get('me7');
      return isValidTronAddress(head) ? { network: 'tron', address: head, ...(asset ? { asset } : {}), ...plain } : null;
    }
    if (scheme !== 'ethereum') return null;

    // ethereum:[pay-]<address>[@chain][/transfer]?...
    const slash = head.indexOf('/');
    const target = (slash < 0 ? head : head.slice(0, slash)).replace(/^pay-/, '');
    const call = slash < 0 ? '' : head.slice(slash + 1);
    const at = target.indexOf('@');
    const first = at < 0 ? target : target.slice(0, at);
    const chainText = at < 0 ? '' : target.slice(at + 1);
    if (!isValidEvmAddress(first) || (chainText && !/^\d{1,12}$/.test(chainText))) return null;
    // A link that moves money and names no chain means Ethereum itself, as the standard has it.
    const moves = call === 'transfer' || fields.has('value');
    const chain = chainText ? { chainId: BigInt(chainText) } : moves ? { chainId: 1n } : {};

    if (call === 'transfer') {
      // The standard link for a token: the first address is the TOKEN, the recipient is in the fields.
      // Taking the first address for the recipient here would send money to the token's contract.
      const recipient = fields.get('address');
      const units = fields.get('uint256');
      if (!recipient || !isValidEvmAddress(recipient)) return null;
      if (units !== undefined && !/^\d{1,78}$/.test(units)) return null;
      return { network: 'evm', address: toChecksumAddress(recipient), token: toChecksumAddress(first), ...chain, ...(units ? { amount: units, baseUnits: true } : {}) };
    }
    if (call !== '') return null;
    const asset = fields.get('me7');
    const wei = fields.get('value');
    if (wei !== undefined && !/^\d{1,78}$/.test(wei)) return null;
    return {
      network: 'evm',
      address: toChecksumAddress(first),
      ...chain,
      ...(asset && /^[a-z0-9-]{1,24}$/.test(asset) ? { asset } : {}),
      ...(wei !== undefined ? { amount: wei, baseUnits: true } : plain),
    };
  } catch {
    return null;
  }
}
