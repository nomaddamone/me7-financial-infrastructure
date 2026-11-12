import { hexToBytes } from '@noble/hashes/utils.js';
import {
  abiEncode,
  abiWords,
  address,
  array,
  bool,
  bytes,
  bytes32,
  encodeCall,
  int,
  keccakText,
  tuple,
  uint,
  wordAddress,
} from './abi.ts';

/**
 * Selling USDC for money on a bank or payment app through Peer (formerly ZKP2P).
 *
 * The seller puts USDC into Peer's escrow contract on Base together with the
 * hash of a payment handle. A buyer reserves some of it, pays the seller in the
 * payment app, proves the payment to the protocol, and the contract hands the
 * reserved USDC to the buyer. The seller signs two things: a spending approval
 * for exactly the amount, and the deposit. Nothing here uses Peer's own code;
 * the calls are built from the contract's published source.
 *
 * Every address below was read back from Base on 2026-11-10: the contracts have
 * code, the payment methods and currencies are registered in Peer's registry,
 * and the price adapter returns sane rates. They are constants on purpose: a
 * server must not be able to tell the wallet where to send money.
 */
export const PEER_ESCROW = '0x777777779d229cdf3110e9de47943791c26300ef';
/** Reads Chainlink price feeds for the contract; the deposit names it as its price source. */
export const PEER_ORACLE_ADAPTER = '0x53881a928abd61c095e5f30b63bc554872c3b2f1';
/** Peer's signer that admits buyers to a deposit. Deposits without it are not shown to buyers. */
export const PEER_GATING_SERVICE = '0x396d31055db28c0c6f36e8b36f18fe7227248a97';
/** May prolong a buyer's reservation (never beyond five days in total). Peer's own deposits set it. */
export const PEER_INTENT_GUARDIAN = '0x83671606454fa72ba1e2831e18c5090d25629414';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type PeerCurrency = 'USD' | 'EUR' | 'GBP';

/**
 * Where the contract takes the market rate of each currency from. The dollar has
 * no feed: one USDC is priced at one dollar. The others are Chainlink feeds
 * quoted in dollars per unit, so the contract inverts them.
 */
const FEEDS: Record<PeerCurrency, { feed: string; invert: boolean }> = {
  USD: { feed: ZERO_ADDRESS, invert: false },
  EUR: { feed: '0xc91d87e81fab8f93699ecf7ee9b44d11e1d53f0f', invert: true },
  GBP: { feed: '0xccea6576904c118037695eb71195a5425e69fa15', invert: true },
};

export interface PeerPlatform {
  /** Peer's name for the payment method; its hash identifies the method on-chain. */
  id: string;
  label: string;
  currencies: readonly PeerCurrency[];
  /** Bring what the user typed to the form Peer registers. */
  normalize: (handle: string) => string;
  /** Rough shape check, so an obvious slip is caught before anything is signed. */
  valid: (handle: string) => boolean;
}

const tag = /^[a-z0-9][a-z0-9._-]{1,62}$/i;

/**
 * Payment methods that can be used without leaving the app. Wise, PayPal and
 * Alipay are missing on purpose: Peer asks their sellers to prove ownership of
 * the account through its browser extension.
 */
export const PEER_PLATFORMS: readonly PeerPlatform[] = [
  { id: 'revolut', label: 'Revolut', currencies: ['EUR', 'USD', 'GBP'], normalize: (h) => h.trim().replace(/^@+/, ''), valid: (h) => tag.test(h) },
  { id: 'venmo', label: 'Venmo', currencies: ['USD'], normalize: (h) => h.trim().replace(/^@+/, ''), valid: (h) => tag.test(h) },
  { id: 'cashapp', label: 'Cash App', currencies: ['USD'], normalize: (h) => h.trim().replace(/^\$+/, ''), valid: (h) => tag.test(h) },
  {
    id: 'zelle',
    label: 'Zelle',
    currencies: ['USD'],
    normalize: (h) => h.trim().toLowerCase(),
    valid: (h) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h) && h.length <= 120,
  },
  { id: 'monzo', label: 'Monzo', currencies: ['GBP'], normalize: (h) => h.trim().replace(/^@+/, ''), valid: (h) => tag.test(h) },
  {
    id: 'chime',
    label: 'Chime',
    currencies: ['USD'],
    normalize: (h) => {
      const clean = h.trim().toLowerCase();
      return clean.startsWith('$') ? clean : `$${clean}`;
    },
    valid: (h) => /^\$[a-z0-9][a-z0-9._-]{1,62}$/.test(h),
  },
];

export const peerPlatform = (id: string): PeerPlatform | undefined => PEER_PLATFORMS.find((p) => p.id === id);

/** On-chain identifier of a payment method: the hash of its lower-case name. */
export const peerMethodId = (platformId: string): string => keccakText(platformId);
/** On-chain identifier of a currency: the hash of its code. */
export const peerCurrencyId = (code: PeerCurrency): string => keccakText(code);

const USDC_DECIMALS_UNIT = 1_000_000n;
/** A buyer may take the deposit in parts, but not in parts smaller than one USDC. */
export const PEER_MIN_ORDER = USDC_DECIMALS_UNIT;
/** The contract asks for a non-zero floor rate even when the market rate decides the price. */
const RATE_FLOOR_SENTINEL = 1n;
/** A price older than a day is refused by the contract instead of being used. */
const MAX_PRICE_AGE_SECONDS = 86_400n;

/** The price source as the contract wants it: abi.encode(feed, invert). */
export function peerFeedConfig(currency: PeerCurrency): Uint8Array {
  const { feed, invert } = FEEDS[currency];
  return abiEncode([address, bool], [feed, invert]);
}

const rangeT = tuple(uint, uint);
const oracleT = tuple(address, bytes, int, uint);
const currencyT = tuple(bytes32, uint, oracleT);
const methodDataT = tuple(address, bytes32, bytes);
const createParamsT = tuple(address, uint, rangeT, array(bytes32), array(methodDataT), array(array(currencyT)), address, address, bool);

const CREATE_DEPOSIT =
  'createDeposit((address,uint256,(uint256,uint256),bytes32[],(address,bytes32,bytes)[],(bytes32,uint256,(address,bytes,int16,uint32))[][],address,address,bool))';

export interface PeerDepositInput {
  /** USDC contract on Base. */
  token: string;
  /** Amount in USDC base units (6 decimals). */
  amount: bigint;
  platform: string;
  currencies: readonly PeerCurrency[];
  /** Hash of the payment handle, as registered with Peer. */
  payeeHash: string;
}

/**
 * Transaction data for the deposit: USDC offered at the market rate with no
 * markup, for one payment method. The deposit closes itself once it is sold out.
 */
export function peerCreateDepositData(input: PeerDepositInput): Uint8Array {
  const platform = peerPlatform(input.platform);
  if (!platform) throw new Error('Unknown payment method');
  if (input.amount <= 0n) throw new RangeError('Amount must be positive');
  if (input.currencies.length === 0 || new Set(input.currencies).size !== input.currencies.length) {
    throw new Error('Currencies must be non-empty and unique');
  }
  for (const c of input.currencies) if (!platform.currencies.includes(c)) throw new Error(`${platform.label} does not pay in ${c}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.payeeHash) || /^0x0{64}$/.test(input.payeeHash)) throw new Error('Bad payee hash');

  const min = input.amount < PEER_MIN_ORDER ? input.amount : PEER_MIN_ORDER;
  const currencies = input.currencies.map((c) => [
    peerCurrencyId(c),
    RATE_FLOOR_SENTINEL,
    [PEER_ORACLE_ADAPTER, peerFeedConfig(c), 0n, MAX_PRICE_AGE_SECONDS],
  ]);
  return encodeCall(
    CREATE_DEPOSIT,
    [createParamsT],
    [
      [
        input.token,
        input.amount,
        [min, input.amount],
        [peerMethodId(platform.id)],
        [[PEER_GATING_SERVICE, input.payeeHash, new Uint8Array(0)]],
        [currencies],
        ZERO_ADDRESS, // no delegate: only the depositor manages the deposit
        PEER_INTENT_GUARDIAN,
        false, // close and forget the deposit when it is sold out
      ],
    ],
  );
}

/** approve(spender, amount) on a token: lets the escrow take exactly this much, once. */
export function erc20ApproveData(spender: string, amount: bigint): Uint8Array {
  return encodeCall('approve(address,uint256)', [address, uint], [spender, amount]);
}

/** Call data for allowance(owner, spender), as 0x-hex. */
export function erc20AllowanceData(owner: string, spender: string): string {
  return hex(encodeCall('allowance(address,address)', [address, address], [owner, spender]));
}

/** Takes everything not reserved by a buyer back to the depositor and stops new reservations. */
export function peerWithdrawData(depositId: bigint): Uint8Array {
  return encodeCall('withdrawDeposit(uint256)', [uint], [depositId]);
}

export const peerGetDepositCall = (depositId: bigint): string => hex(encodeCall('getDeposit(uint256)', [uint], [depositId]));
export const peerGetMethodsCall = (depositId: bigint): string => hex(encodeCall('getDepositPaymentMethods(uint256)', [uint], [depositId]));
export const peerGetCurrenciesCall = (depositId: bigint, methodId: string): string =>
  hex(encodeCall('getDepositCurrencies(uint256,bytes32)', [uint, bytes32], [depositId, methodId]));
/** Asks the price adapter to check a feed and return it in the adapter's own compact form. */
export const peerValidateFeedCall = (currency: PeerCurrency): string =>
  hex(encodeCall('validateConfig(bytes)', [bytes], [peerFeedConfig(currency)]));
/** Asks the price adapter for the current rate of a feed given in its compact form. */
export const peerRateCall = (normalizedConfig: Uint8Array): string => hex(encodeCall('getRate(bytes)', [bytes], [normalizedConfig]));

export interface PeerDeposit {
  depositor: string;
  token: string;
  /** Still for sale and free to take back. */
  remaining: bigint;
  /** Reserved by buyers who are paying (or whose reservation ran out and was not cleared yet). */
  reserved: bigint;
  accepting: boolean;
}

/** Decode getDeposit(). A closed or unknown deposit comes back as all zeros and is reported as null. */
export function decodePeerDeposit(resultHex: string): PeerDeposit | null {
  const w = abiWords(resultHex);
  if (w.length !== 10) throw new Error('Malformed contract response');
  const depositor = wordAddress(w[0] as string);
  if (depositor === ZERO_ADDRESS) return null;
  return {
    depositor,
    token: wordAddress(w[2] as string),
    accepting: BigInt(`0x${w[5]}`) !== 0n,
    remaining: BigInt(`0x${w[6]}`),
    reserved: BigInt(`0x${w[7]}`),
  };
}

/** Decode a returned bytes32[]. */
export function decodeBytes32Array(resultHex: string): string[] {
  const w = abiWords(resultHex);
  if (w.length < 2 || BigInt(`0x${w[0]}`) !== 32n) throw new Error('Malformed contract response');
  const count = Number(BigInt(`0x${w[1]}`));
  if (!Number.isSafeInteger(count) || w.length !== count + 2) throw new Error('Malformed contract response');
  return w.slice(2).map((x) => `0x${x.toLowerCase()}`);
}

/** Decode a returned `bytes` value. */
export function decodeBytes(resultHex: string): Uint8Array {
  const w = abiWords(resultHex);
  if (w.length < 2 || BigInt(`0x${w[0]}`) !== 32n) throw new Error('Malformed contract response');
  const length = Number(BigInt(`0x${w[1]}`));
  if (!Number.isSafeInteger(length) || length > (w.length - 2) * 32) throw new Error('Malformed contract response');
  return hexToBytes(w.slice(2).join('')).subarray(0, length);
}

/** Decode getRate(): whether the price is usable, and units of currency per USDC scaled by 1e18. */
export function decodePeerRate(resultHex: string): { valid: boolean; rate: bigint; updatedAt: bigint } {
  const w = abiWords(resultHex);
  if (w.length !== 3) throw new Error('Malformed contract response');
  return { valid: BigInt(`0x${w[0]}`) !== 0n, rate: BigInt(`0x${w[1]}`), updatedAt: BigInt(`0x${w[2]}`) };
}

const DEPOSIT_RECEIVED = keccakText('DepositReceived(uint256,address,address,uint256,(uint256,uint256),address,address)');

/** The number the contract gave a new deposit, read from the transaction's receipt. */
export function peerDepositIdFromLogs(logs: readonly { address?: unknown; topics?: unknown }[], depositor: string): bigint | null {
  for (const log of logs) {
    const topics = Array.isArray(log.topics) ? (log.topics as unknown[]) : [];
    if (typeof log.address !== 'string' || log.address.toLowerCase() !== PEER_ESCROW) continue;
    if (topics.length !== 4 || topics[0] !== DEPOSIT_RECEIVED) continue;
    const [, id, who] = topics as string[];
    if (typeof id !== 'string' || typeof who !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(id)) continue;
    if (who.toLowerCase() !== `0x${depositor.slice(2).toLowerCase().padStart(64, '0')}`) continue;
    return BigInt(id);
  }
  return null;
}

/** Which of our payment methods and currencies a hash stands for; null when it is not one of ours. */
export function peerMethodByHash(hashHex: string): PeerPlatform | null {
  return PEER_PLATFORMS.find((p) => peerMethodId(p.id) === hashHex.toLowerCase()) ?? null;
}
export function peerCurrencyByHash(hashHex: string): PeerCurrency | null {
  return (Object.keys(FEEDS) as PeerCurrency[]).find((c) => peerCurrencyId(c) === hashHex.toLowerCase()) ?? null;
}

function hex(data: Uint8Array): string {
  let out = '0x';
  for (const b of data) out += b.toString(16).padStart(2, '0');
  return out;
}
