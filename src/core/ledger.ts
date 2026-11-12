/**
 * Talking to a Ledger device: the wire format over USB and the commands of its
 * Ethereum app. With a Ledger the private key never leaves the device: the
 * wallet sends a transaction, the device shows it on its own screen, and only
 * a signature comes back.
 *
 * Written from Ledger's published libraries (hw-transport-webhid, hw-app-eth),
 * which define this protocol; none of their code is included.
 */

/** Ledger's USB vendor id, to offer only its devices in the browser's picker. */
export const LEDGER_VENDOR_ID = 0x2c97;

const PACKET = 64;
const TAG = 0x05;

/**
 * Cut a command into USB packets. Each is 64 bytes: channel (2), tag 0x05,
 * packet number (2), then payload. The payload of the whole message starts with
 * its length (2) and is padded with zeros to fill the last packet.
 */
export function hidFrames(channel: number, apdu: Uint8Array): Uint8Array[] {
  const body = PACKET - 5;
  const message = new Uint8Array(2 + apdu.length);
  message[0] = apdu.length >> 8;
  message[1] = apdu.length & 0xff;
  message.set(apdu, 2);
  const count = Math.ceil(message.length / body);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const frame = new Uint8Array(PACKET);
    frame[0] = channel >> 8;
    frame[1] = channel & 0xff;
    frame[2] = TAG;
    frame[3] = i >> 8;
    frame[4] = i & 0xff;
    frame.set(message.subarray(i * body, (i + 1) * body), 5);
    frames.push(frame);
  }
  return frames;
}

/** Puts the device's answer back together from the packets it arrives in. */
export class HidAssembler {
  private sequence = 0;
  private length = -1;
  private readonly parts: number[] = [];
  private readonly channel: number;

  constructor(channel: number) {
    this.channel = channel;
  }

  /**
   * Take one packet. Returns the complete answer once the last packet is in,
   * null before that. A packet of another channel (another program talking to
   * the device) is skipped; one out of order is an error.
   */
  push(packet: Uint8Array): Uint8Array | null {
    if (packet.length < 7) throw new Error('Ledger: short packet');
    if (((packet[0] ?? 0) << 8) + (packet[1] ?? 0) !== this.channel) return null;
    if (packet[2] !== TAG) throw new Error('Ledger: unexpected packet');
    if (((packet[3] ?? 0) << 8) + (packet[4] ?? 0) !== this.sequence) throw new Error('Ledger: packet out of order');
    let at = 5;
    if (this.sequence === 0) {
      this.length = ((packet[5] ?? 0) << 8) + (packet[6] ?? 0);
      at = 7;
    }
    this.sequence += 1;
    for (let i = at; i < packet.length && this.parts.length < this.length; i++) this.parts.push(packet[i] ?? 0);
    return this.parts.length === this.length ? Uint8Array.from(this.parts) : null;
  }
}

/** A command for the device: class, instruction, two parameters, then the data with its length before it. */
export function apdu(cla: number, ins: number, p1: number, p2: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (data.length > 255) throw new RangeError('Ledger: command data too long');
  const out = new Uint8Array(5 + data.length);
  out.set([cla, ins, p1, p2, data.length], 0);
  out.set(data, 5);
  return out;
}

export type LedgerProblem =
  /** The user pressed "reject" on the device. */
  | 'rejected'
  /** The device is locked with its PIN. */
  | 'locked'
  /** The Ethereum app is not open on the device. */
  | 'no-app'
  /** The device refuses to show this transaction and asks for blind signing, which this wallet never uses. */
  | 'blind'
  | 'other';

export class LedgerError extends Error {
  readonly problem: LedgerProblem;
  readonly status: number;
  constructor(problem: LedgerProblem, status: number) {
    super(`Ledger: ${problem} (0x${status.toString(16)})`);
    this.problem = problem;
    this.status = status;
  }
}

/** What the two status bytes at the end of every answer mean. */
export function ledgerProblem(status: number): LedgerProblem {
  if (status === 0x6985 || status === 0x5501) return 'rejected';
  if (status === 0x5515 || status === 0x6b0c || status === 0x6982) return 'locked';
  // The dashboard or another app answers "unknown command" to the Ethereum app's instructions.
  if (status === 0x6d00 || status === 0x6e00 || status === 0x6d02 || status === 0x6511 || status === 0x6e01) return 'no-app';
  if (status === 0x6a80 || status === 0x6a84) return 'blind';
  return 'other';
}

/** Split the device's answer into its data and status; anything but success (0x9000) is raised. */
export function ledgerResponse(answer: Uint8Array): Uint8Array {
  if (answer.length < 2) throw new Error('Ledger: empty answer');
  const status = ((answer[answer.length - 2] ?? 0) << 8) + (answer[answer.length - 1] ?? 0);
  if (status !== 0x9000) throw new LedgerError(ledgerProblem(status), status);
  return answer.subarray(0, answer.length - 2);
}

const HARDENED = 0x80000000;
function accountPath(coin: number, index: number): Uint8Array {
  const parts = [44 + HARDENED, coin + HARDENED, HARDENED, 0, index];
  const out = new Uint8Array(1 + parts.length * 4);
  out[0] = parts.length;
  parts.forEach((part, i) => new DataView(out.buffer).setUint32(1 + i * 4, part >>> 0));
  return out;
}
/** The account's place in the key tree, as the device wants it: m/44'/60'/0'/0/0, the same one the pocket uses. */
export const ledgerEvmPath = (index = 0): Uint8Array => accountPath(60, index);
/** The Tron account: m/44'/195'/0'/0/0, again the pocket's own path. */
export const ledgerTronPath = (index = 0): Uint8Array => accountPath(195, index);

/**
 * Ask the device which app is open. Every app and the home screen answer this
 * one the same way: a format byte, then the name and the version, each with
 * its length before it.
 */
export const ledgerAppNameCommand = (): Uint8Array => apdu(0xb0, 0x01, 0x00, 0x00);
export function parseLedgerAppName(data: Uint8Array): string {
  const length = data[1] ?? 0;
  if (data[0] !== 1 || data.length < 2 + length) throw new Error('Ledger: unreadable app name');
  return String.fromCharCode(...data.subarray(2, 2 + length));
}

const CLA_ETH = 0xe0;

/** Ask for the account's address. With `show`, the device also displays it for the user to compare. */
export function ledgerAddressCommand(path: Uint8Array, show: boolean): Uint8Array {
  return apdu(CLA_ETH, 0x02, show ? 0x01 : 0x00, 0x00, path);
}

/** Read the address out of the answer: public key (with its length), then the address as text (with its length). */
export function parseLedgerAddress(data: Uint8Array): string {
  const keyLength = data[0] ?? 0;
  const addressLength = data[1 + keyLength] ?? 0;
  const start = 2 + keyLength;
  if (addressLength !== 40 || data.length < start + addressLength) throw new Error('Ledger: unreadable address');
  const text = String.fromCharCode(...data.subarray(start, start + addressLength));
  if (!/^[0-9a-fA-F]{40}$/.test(text)) throw new Error('Ledger: unreadable address');
  return `0x${text}`;
}

/** Ask which version of the Ethereum app is open. */
export const ledgerAppConfigCommand = (): Uint8Array => apdu(CLA_ETH, 0x06, 0x00, 0x00);
export function parseLedgerAppVersion(data: Uint8Array): string {
  if (data.length < 4) throw new Error('Ledger: unreadable app version');
  return `${data[1]}.${data[2]}.${data[3]}`;
}

/**
 * Tell the device about a token, so that it shows "send 10 USDT" instead of
 * asking for blind signing. The description is signed by Ledger; the device
 * checks that signature and ignores a description it cannot verify.
 */
export const ledgerTokenCommand = (description: Uint8Array): Uint8Array => apdu(CLA_ETH, 0x0a, 0x00, 0x00, description);

/**
 * The commands that hand a transaction to the device for signing: the path
 * followed by the unsigned transaction, in pieces of at most 255 bytes. The
 * answer to the last one carries the signature.
 */
export function ledgerSignCommands(path: Uint8Array, unsigned: Uint8Array): Uint8Array[] {
  const payload = new Uint8Array(path.length + unsigned.length);
  payload.set(path, 0);
  payload.set(unsigned, path.length);
  const commands: Uint8Array[] = [];
  for (let at = 0; at < payload.length; at += 255) {
    commands.push(apdu(CLA_ETH, 0x04, at === 0 ? 0x00 : 0x80, 0x00, payload.subarray(at, at + 255)));
  }
  return commands;
}

/** The signature in the device's answer: one byte that tells which of the two possible keys signed, then r and s. */
export function parseLedgerSignature(data: Uint8Array): { yParity: number; r: Uint8Array; s: Uint8Array } {
  if (data.length < 65) throw new Error('Ledger: unreadable signature');
  // For the transaction format used here the device answers 0 or 1. Older apps answer 27 or 28,
  // or the legacy value built from the chain id, whose last bit is the opposite of the parity.
  const v = data[0] ?? 0;
  const yParity = v === 0 || v === 1 ? v : v === 27 || v === 28 ? v - 27 : (v + 1) % 2;
  return { yParity, r: data.slice(1, 33), s: data.slice(33, 65) };
}

/**
 * Ledger's signed descriptions of the tokens this wallet shows, by chain and
 * contract (lower case). Copied on 2026-11-11 from Ledger's public list
 * (cdn.live.ledger.com/cryptoassets/evm/<chain>/erc20-signatures.json). Each
 * is: ticker, contract, decimals, chain id, Ledger's signature. They are not
 * secret and cannot be forged: a wrong one is simply refused by the device.
 */
export const LEDGER_TOKENS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '1': {
    '0xdac17f958d2ee523a2206206994597c13d831ec7':
      '0455534454dac17f958d2ee523a2206206994597c13d831ec700000006000000013044022078c66ccea3e4dedb15a24ec3c783d7b582cd260daf62fd36afe9a8212a344aed0220160ba8c1c4b6a8aa6565bed20632a091aeeeb7bfdac67fc6589a6031acbf511c',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':
      '0455534443a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000006000000013045022100b2e358726e4e6a6752cf344017c0e9d45b9a904120758d45f61b2804f9ad5299022015161ef28d8c4481bd9432c13562def9cce688bcfec896ef244c9a213f106cdd',
    '0x6b175474e89094c44da98b954eedeac495271d0f':
      '034441496b175474e89094c44da98b954eedeac495271d0f00000012000000013045022100b3aa979633284eb0f55459099333ab92cf06fdd58dc90e9c070000c8e968864c02207b10ec7d6609f51dda53d083a6e165a0abf3a77e13250e6f260772809b49aff5',
    '0x514910771af9ca656af840dff83e8264ecf986ca':
      '044c494e4b514910771af9ca656af840dff83e8264ecf986ca000000120000000130440220651bded883b8b185a2608450206aec79f9a8845406735f57b2a77c559fdb519202202162d372e209c04b03743367b3904628bd8f64b180f13cfb1e7df1600606dd72',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599':
      '04574254432260fac5e5542a773aa44fbcfedf7c193bc2c59900000008000000013045022100d733b3d1bc49a05698e14d8869834cf1911bef89cd98ea8d38f7c372b81a007b02206fb43deddc7508b567f330ba292eda1299410935434cb9795fec26ea1560dd2c',
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf':
      '056362425443cbb7c0000ab88b473b1f5afd9ef808440eed33bf00000008000000013044022040e4f48e19ef0f5ca8a13c922192e3e898836204cc5b261de4d6a95955ab9d8402206aaf52e1186cde04d19200215be28088c7dc644bfae47e3c45d281b0a052fb5a',
  },
  '8453': {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913':
      '0455534443833589fcd6edb6e08f4c7c32d4f71b54bda02913000000060000210530450221008ee00330ddbe5643a79fae21e6ee7fad654e6fe62439fe3699d5e70368e2a6e50220439ae5b92438d0172339a93e32881a2cb47d1115390ab5f3af379c5f8b2ba339',
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf':
      '056362425443cbb7c0000ab88b473b1f5afd9ef808440eed33bf0000000800002105304502210097129ab6b79ad87ec53224c2b25d3288009a27a59b45eeb1c6e8cb245ed3e605022055e7c2c23c65fc4217c3fe6b622cf71c1f84fd63b1c7e05cb29715d052c94dbb',
  },
};

/** Ledger's description of a token, or null if this wallet has none for it (then the token cannot be sent from a Ledger here). */
export function ledgerTokenDescription(chainId: bigint, contract: string): string | null {
  return LEDGER_TOKENS[chainId.toString()]?.[contract.toLowerCase()] ?? null;
}

/**
 * Bluetooth. The same commands travel in smaller pieces: each starts with the
 * tag 0x05 and its number, the first one also carries the total length, and
 * nothing is padded. The size of a piece is agreed with the device first.
 */

/** The Bluetooth services of Ledger devices, by the family id inside the identifier. */
const BLE_FAMILIES: Readonly<Record<string, string>> = { '0004': 'Ledger Nano X', '8004': 'Ledger Nano Gen5', '6004': 'Ledger Stax', '3004': 'Ledger Flex' };
const bleUuid = (family: string, part: string) => `13d63400-2c97-${family}-${part}-4c6564676572`;

export interface LedgerBleService {
  name: string;
  service: string;
  /** The device answers here. */
  notify: string;
  /** Commands are written here. */
  write: string;
}
export const LEDGER_BLE_SERVICES: readonly LedgerBleService[] = Object.entries(BLE_FAMILIES).map(([family, name]) => ({
  name,
  service: bleUuid(family, '0000'),
  notify: bleUuid(family, '0001'),
  write: bleUuid(family, '0002'),
}));

/** The question that asks the device how many bytes fit into one piece. */
export const BLE_MTU_REQUEST = Uint8Array.of(0x08, 0, 0, 0, 0);
/** Until the device answers, the smallest size every Bluetooth link allows. */
export const BLE_DEFAULT_MTU = 20;

/** The piece size from the device's answer to the question above, or null if this is not that answer. */
export function parseBleMtu(packet: Uint8Array): number | null {
  if (packet[0] !== 0x08 || packet.length < 6) return null;
  const size = packet[5] ?? 0;
  return size > BLE_DEFAULT_MTU ? size : BLE_DEFAULT_MTU;
}

/** Cut a command into Bluetooth pieces of at most `mtu` bytes. */
export function bleFrames(command: Uint8Array, mtu: number): Uint8Array[] {
  if (mtu < 6) throw new RangeError('Ledger: Bluetooth piece too small');
  const frames: Uint8Array[] = [];
  for (let at = 0, index = 0; at < command.length || index === 0; index++) {
    const head = index === 0 ? 5 : 3;
    const chunk = command.subarray(at, at + mtu - head);
    const frame = new Uint8Array(head + chunk.length);
    frame[0] = TAG;
    frame[1] = index >> 8;
    frame[2] = index & 0xff;
    if (index === 0) {
      frame[3] = command.length >> 8;
      frame[4] = command.length & 0xff;
    }
    frame.set(chunk, head);
    frames.push(frame);
    at += chunk.length;
  }
  return frames;
}

/** Puts the device's answer back together from Bluetooth pieces. */
export class BleAssembler {
  private index = 0;
  private length = -1;
  private readonly parts: number[] = [];

  /** Take one piece. Returns the complete answer once the last piece is in, null before that. */
  push(packet: Uint8Array): Uint8Array | null {
    // The answer to the size question may still arrive; it is not part of a command's answer.
    if (packet[0] === 0x08) return null;
    if (packet.length < 3 || packet[0] !== TAG) throw new Error('Ledger: unexpected packet');
    if (((packet[1] ?? 0) << 8) + (packet[2] ?? 0) !== this.index) throw new Error('Ledger: packet out of order');
    let at = 3;
    if (this.index === 0) {
      if (packet.length < 5) throw new Error('Ledger: short packet');
      this.length = ((packet[3] ?? 0) << 8) + (packet[4] ?? 0);
      at = 5;
    }
    this.index += 1;
    for (let i = at; i < packet.length; i++) this.parts.push(packet[i] ?? 0);
    if (this.parts.length > this.length) throw new Error('Ledger: answer longer than announced');
    return this.parts.length === this.length ? Uint8Array.from(this.parts) : null;
  }
}

/**
 * The Tron app. A Ledger runs one app at a time, so TRX and USDT on Tron need
 * this app open instead of the Ethereum one.
 */
const CLA_TRON = 0xe0;

/** Ask for the Tron account's address. With `show`, the device also displays it. */
export function ledgerTronAddressCommand(path: Uint8Array, show: boolean): Uint8Array {
  return apdu(CLA_TRON, 0x02, show ? 0x01 : 0x00, 0x00, path);
}

/** Read the address out of the answer: public key (with its length), then the address as text (with its length). */
export function parseLedgerTronAddress(data: Uint8Array): string {
  const keyLength = data[0] ?? 0;
  const addressLength = data[1 + keyLength] ?? 0;
  const start = 2 + keyLength;
  if (addressLength !== 34 || data.length < start + addressLength) throw new Error('Ledger: unreadable address');
  const text = String.fromCharCode(...data.subarray(start, start + addressLength));
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text)) throw new Error('Ledger: unreadable address');
  return text;
}

/** Where a number written in the transaction's variable-length form ends, and its value. */
function varint(bytes: Uint8Array, at: number): { value: number; end: number } {
  let value = 0;
  let shift = 0;
  for (let i = at; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return { value, end: i + 1 };
    shift += 7;
    if (shift > 49) break;
  }
  throw new Error('Ledger: unreadable transaction');
}

const TRON_CHUNK = 250;

/**
 * The commands that hand a Tron transaction to the device. Unlike Ethereum,
 * the transaction may only be cut between its fields, never inside one: the
 * device reads each piece as whole fields. The first piece carries the path.
 */
export function ledgerTronSignCommands(path: Uint8Array, raw: Uint8Array): Uint8Array[] {
  const pieces: number[][] = [[...path]];
  for (let at = 0; at < raw.length; ) {
    const key = varint(raw, at);
    const next = varint(raw, key.end);
    // A field is a number, or a length followed by that many bytes.
    const end = (key.value & 7) === 0 ? next.end : next.end + next.value;
    if (end > raw.length) throw new Error('Ledger: unreadable transaction');
    const field = raw.subarray(at, end);
    if (field.length > TRON_CHUNK) throw new Error('Ledger: transaction field too long for the device');
    const current = pieces[pieces.length - 1] as number[];
    if (current.length + field.length > TRON_CHUNK) pieces.push([...field]);
    else current.push(...field);
    at = end;
  }
  // One piece: 0x10. Several: 0x00 for the first, 0x80 in between, 0x90 for the last.
  return pieces.map((piece, i) =>
    apdu(CLA_TRON, 0x04, pieces.length === 1 ? 0x10 : i === 0 ? 0x00 : i === pieces.length - 1 ? 0x90 : 0x80, 0x00, Uint8Array.from(piece)),
  );
}

/** The signature in the Tron app's answer: 65 bytes, r, s and the byte that tells which key signed. */
export function parseLedgerTronSignature(data: Uint8Array): Uint8Array {
  if (data.length < 65) throw new Error('Ledger: unreadable signature');
  return data.slice(0, 65);
}
