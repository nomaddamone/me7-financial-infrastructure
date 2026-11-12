import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { deriveKey, mnemonicToSeed } from '../src/core/index.ts';
import {
  buildTrc20Transfer,
  buildTronTransfer,
  decodeTronAddress,
  isValidTronAddress,
  signTronTransaction,
  trc20BalanceOfParameter,
  trc20TransferData,
  tronAddressFromPrivateKey,
  tronPath,
  tronRef,
} from '../src/core/tron.ts';

const seed = mnemonicToSeed(
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
);
const key = deriveKey(seed, tronPath(0));
const OWNER = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const TO = 'TQGfKPHs3AwiBT44ibkCU64u1G4ttojUXU';
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

describe('Tron addresses', () => {
  it('derives the reference address of the BIP39 test vector', () => {
    expect(tronPath(0)).toBe("m/44'/195'/0'/0/0");
    expect(tronAddressFromPrivateKey(key.privateKey)).toBe(OWNER);
  });

  it('decodes to the raw bytes a node uses', () => {
    expect(bytesToHex(decodeTronAddress(OWNER))).toBe('41c8599111f29c1e1e061265b4af93ea1f274ad78a');
    expect(bytesToHex(decodeTronAddress(USDT))).toBe('41eca9bc828a3005b9a3b909f2cc5c2a54794de05f');
  });

  it('rejects typos, other networks and junk', () => {
    expect(isValidTronAddress(OWNER)).toBe(true);
    expect(isValidTronAddress(`${OWNER.slice(0, -1)}J`)).toBe(false);
    expect(isValidTronAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
    expect(isValidTronAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(false);
    expect(isValidTronAddress('')).toBe(false);
    expect(() => tronPath(-1)).toThrow(RangeError);
  });
});

/**
 * Both fixtures below were returned by a Tron node (nile.trongrid.io,
 * /wallet/createtransaction and /wallet/triggersmartcontract) on 2026-11-10.
 * Our builder must reproduce them byte for byte from the same inputs.
 */
describe('Tron transactions match a real node', () => {
  it('TRX transfer', () => {
    const raw = buildTronTransfer(OWNER, TO, 1_500_000n, {
      refBlockBytes: hexToBytes('b4f2'),
      refBlockHash: hexToBytes('201b27e221fcf9f9'),
      expiration: 1794323427000,
      timestamp: 1794323367991,
    });
    expect(bytesToHex(raw)).toBe(
      '0a02b4f22208201b27e221fcf9f940b8dd8ab09c345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541c8599111f29c1e1e061265b4af93ea1f274ad78a1215419cdeccbed8527dca387ee1116bc3915de88d714a18e0c65b70b79087b09c34',
    );
    expect(signTronTransaction(raw, key.privateKey).txid).toBe(
      '417c87aa7167f22eb20c2ed232ad5ba9d714c2a4f6acea4c2f20e743acad1bfa',
    );
  });

  it('USDT (TRC-20) transfer with a fee limit', () => {
    const raw = buildTrc20Transfer(
      OWNER,
      USDT,
      TO,
      2_500_000n,
      {
        refBlockBytes: hexToBytes('b4fc'),
        refBlockHash: hexToBytes('b3a0c300447af9bd'),
        expiration: 1794323457000,
        timestamp: 1794323398612,
      },
      30_000_000n,
    );
    expect(bytesToHex(raw)).toBe(
      '0a02b4fc2208b3a0c300447af9bd40e8c78cb09c345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541eca9bc828a3005b9a3b909f2cc5c2a54794de05f2244a9059cbb0000000000000000000000009cdeccbed8527dca387ee1116bc3915de88d714a00000000000000000000000000000000000000000000000000000000002625a070d4ff88b09c3490018087a70e',
    );
    expect(signTronTransaction(raw, key.privateKey).txid).toBe(
      'ab2bcf720a8dc78398483caacc4456460bc13488341eecce2b568ea13afdfa9a',
    );
  });
});

describe('Tron signing', () => {
  const ref = tronRef({ id: '000000000453b503549cc830c37f6c98485584c222217338798fc699c0038c3d', timestamp: 1794323364000 }, 1794323365000);

  it('anchors to the block and expires a minute later', () => {
    expect(bytesToHex(ref.refBlockBytes)).toBe('b503');
    expect(bytesToHex(ref.refBlockHash)).toBe('549cc830c37f6c98');
    expect(ref.expiration).toBe(1794323424000);
    expect(() => tronRef({ id: 'zz', timestamp: 1 }, 1)).toThrow();
  });

  it('produces a signature that recovers to the signer, in the order Tron expects', () => {
    const raw = buildTronTransfer(OWNER, TO, 1n, ref);
    const { txid, signedHex } = signTronTransaction(raw, key.privateKey);
    expect(txid).toBe(bytesToHex(sha256(raw)));
    const signed = hexToBytes(signedHex);
    // Transaction { raw_data = 1, signature = 2 }: the raw bytes come first, then 65 signature bytes.
    expect(signedHex.startsWith(`0a${raw.length.toString(16)}`) || signedHex.startsWith('0a')).toBe(true);
    const sig = signed.subarray(signed.length - 65);
    expect(signed[signed.length - 67]).toBe(0x12);
    expect(signed[signed.length - 66]).toBe(65);
    expect([0, 1]).toContain(sig[64]);
    const recovered = secp256k1.Signature.fromBytes(Uint8Array.from([sig[64]!, ...sig.subarray(0, 64)]), 'recovered')
      .recoverPublicKey(sha256(raw))
      .toBytes(true);
    expect(bytesToHex(recovered)).toBe(bytesToHex(key.publicKey));
    expect(signTronTransaction(raw, key.privateKey).signedHex).toBe(signedHex);
  });

  it('encodes token call data and balance queries', () => {
    expect(bytesToHex(trc20TransferData(TO, 2_500_000n))).toBe(
      'a9059cbb0000000000000000000000009cdeccbed8527dca387ee1116bc3915de88d714a00000000000000000000000000000000000000000000000000000000002625a0',
    );
    expect(trc20BalanceOfParameter(OWNER)).toBe('000000000000000000000000c8599111f29c1e1e061265b4af93ea1f274ad78a');
  });

  it('refuses bad input', () => {
    expect(() => buildTronTransfer(OWNER, TO, 0n, ref)).toThrow(RangeError);
    expect(() => buildTronTransfer(OWNER, 'nope', 1n, ref)).toThrow(/address/);
    expect(() => buildTrc20Transfer(OWNER, USDT, TO, 1n, ref, 0n)).toThrow(RangeError);
    expect(() => buildTrc20Transfer(OWNER, USDT, TO, 0n, ref, 1n)).toThrow(RangeError);
    expect(() => trc20TransferData(TO, -1n)).toThrow(RangeError);
    expect(() => buildTronTransfer(OWNER, TO, 1n, { ...ref, refBlockBytes: new Uint8Array(3) })).toThrow(/reference/);
  });
});
