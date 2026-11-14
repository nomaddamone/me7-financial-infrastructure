import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { buildTrc20Transfer, recoverTronSigner, tronAddressFromBytes } from './tron.ts';

/**
 * USDT on Tron without TRX. The token there cannot be moved by a signature alone, as USDC on
 * Base can: its owner must send the transaction. What can be lent is the network resource a
 * transaction burns, "energy". So the wallet signs two ordinary transfers, one to the recipient
 * and one of the fee to me7, and hands them over unsent; me7's service rents energy onto the
 * owner's address and then sends them. Nothing can be changed on the way: each transfer is
 * signed whole, and the service can only deliver it or not.
 *
 * This file reads a signed transfer back into its parts, strictly: only the one shape the wallet
 * itself builds is accepted, byte for byte.
 */
export interface SignedTrc20Transfer {
  from: string;
  to: string;
  /** The token's contract. */
  contract: string;
  amount: bigint;
  /** Unix milliseconds after which the network drops the transaction. */
  expiration: number;
  /** Sun the network may burn for the call at most. */
  feeLimit: bigint;
  txid: string;
  /** The complete transaction, as it is broadcast. */
  signedHex: string;
}

type Field = { field: number; value: bigint } | { field: number; bytes: Uint8Array };

/** The fields of one protobuf message, in order. Only the two kinds of field Tron's transfers use are understood. */
function fields(data: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  const varint = (): bigint => {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      const byte = data[at++];
      if (byte === undefined || shift > 63n) throw new Error('Malformed transaction');
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
    }
  };
  while (at < data.length) {
    const tag = varint();
    const field = Number(tag >> 3n);
    const kind = Number(tag & 7n);
    if (kind === 0) out.push({ field, value: varint() });
    else if (kind === 2) {
      const length = Number(varint());
      if (length < 0 || at + length > data.length) throw new Error('Malformed transaction');
      out.push({ field, bytes: data.subarray(at, at + length) });
      at += length;
    } else throw new Error('Malformed transaction');
  }
  return out;
}

const bytesOf = (list: Field[], field: number): Uint8Array => {
  const hit = list.filter((f) => f.field === field);
  const one = hit[0];
  if (hit.length !== 1 || !one || !('bytes' in one)) throw new Error('Malformed transaction');
  return one.bytes;
};
const numberOf = (list: Field[], field: number): bigint => {
  const hit = list.filter((f) => f.field === field);
  const one = hit[0];
  if (hit.length !== 1 || !one || !('value' in one)) throw new Error('Malformed transaction');
  return one.value;
};

/**
 * Read a signed TRC-20 transfer. Throws unless it is exactly a transfer(to, amount) call to a
 * token, signed by the address it spends from, with nothing else in it: the parts are put back
 * together with the wallet's own builder and must come out as the very same bytes.
 */
export function readSignedTrc20Transfer(signedHex: string): SignedTrc20Transfer {
  if (!/^([0-9a-f]{2}){100,600}$/.test(signedHex)) throw new Error('Malformed transaction');
  const top = fields(hexToBytes(signedHex));
  if (top.length !== 2) throw new Error('Malformed transaction');
  const raw = bytesOf(top, 1);
  const signature = bytesOf(top, 2);

  const body = fields(raw);
  const call = fields(bytesOf(fields(bytesOf(body, 11)), 2));
  const parameter = fields(bytesOf(call, 2));
  const data = bytesOf(parameter, 4);
  if (data.length !== 68 || bytesToHex(data.subarray(0, 16)) !== `a9059cbb${'00'.repeat(12)}`) throw new Error('Not a token transfer');
  const from = tronAddressFromBytes(bytesOf(parameter, 1));
  const contract = tronAddressFromBytes(bytesOf(parameter, 2));
  const to = tronAddressFromBytes(Uint8Array.from([0x41, ...data.subarray(16, 36)]));
  const amount = BigInt(`0x${bytesToHex(data.subarray(36))}`);
  const expiration = Number(numberOf(body, 8));
  const feeLimit = numberOf(body, 18);
  const ref = { refBlockBytes: bytesOf(body, 1), refBlockHash: bytesOf(body, 4), expiration, timestamp: Number(numberOf(body, 14)) };

  // Built again from its parts it must be identical: no extra field, no second call, no other encoding.
  const again = buildTrc20Transfer(from, contract, to, amount, ref, feeLimit);
  if (bytesToHex(again) !== bytesToHex(raw)) throw new Error('Not a plain token transfer');
  if (recoverTronSigner(raw, signature) !== from) throw new Error('Not signed by its sender');
  return { from, to, contract, amount, expiration, feeLimit, txid: bytesToHex(sha256(raw)), signedHex };
}

const CENT = 10_000n;
/**
 * The fee for a transfer, in the token's units (6 decimals): what the service spends in sun,
 * turned into dollars at the price of TRX (in millionths of a dollar) and rounded up to a cent,
 * plus the service's own part.
 */
export function tronGaslessFee(costSun: bigint, trxMicroUsd: bigint, service: bigint): bigint {
  const cost = (costSun * trxMicroUsd + 999_999n) / 1_000_000n;
  return ((cost + CENT - 1n) / CENT) * CENT + service;
}
