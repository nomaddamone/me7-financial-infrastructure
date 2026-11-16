import { Interface, Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  checkGaslessRequest,
  gaslessCall,
  gaslessFee,
  MULTICALL3,
  signGaslessPayment,
  type GaslessPricing,
  type GaslessRequest,
  type GaslessRules,
  type StealthNote,
  type TokenDomain,
} from '../src/core/gasless.ts';
import { matchAnnouncement, parseStealthCode, STEALTH_ANNOUNCER, stealthAddressFor, stealthCode, stealthKeys, stealthMetaAddress, tokenMetadata } from '../src/core/stealth.ts';
import { GASLESS, NETWORKS } from '../src/net/endpoints.ts';

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16));

const base = NETWORKS.mainnet.base!;
const DOMAIN: TokenDomain = { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc };
const payer = new Wallet(`0x${'11'.repeat(32)}`);
const NOW = 1_800_000_000n;
const PRICING: GaslessPricing = { base: GASLESS.base, free: GASLESS.free, extra: GASLESS.extra, perCall: 2_000n };
const RULES: GaslessRules = { domain: DOMAIN, feeReceiver: GASLESS.receiver, pricing: PRICING, now: NOW, margin: 60n };
const AMOUNT = 25_000_000n;

// The receiver, who only ever gave out a code.
const receiver = stealthKeys(new Uint8Array(64).fill(7));
const CODE = stealthCode(stealthMetaAddress(receiver));

/** What the payer's wallet builds from the code: a payment to a new address, and the note that goes with it. */
function pay(salt = 9): { request: GaslessRequest; note: StealthNote } {
  const paid = stealthAddressFor(parseStealthCode(CODE)!, new Uint8Array(32).fill(salt));
  const note = { stealthAddress: paid.address, ephemeralPubKey: hex(paid.ephemeralPubKey), metadata: hex(tokenMetadata(paid.viewTag, base.usdc, AMOUNT)) };
  const signed = signGaslessPayment(
    DOMAIN,
    { from: payer.address, to: paid.address, amount: AMOUNT, fee: gaslessFee(PRICING, 1, 1), feeReceiver: GASLESS.receiver, now: NOW, lifetime: 600n, nonces: Uint8Array.from({ length: 64 }, (_, i) => i + salt) },
    bytes(payer.privateKey),
  );
  return { request: { chain: 'base', ...signed, notes: [note] }, note };
}

describe('paying by a stealth code through the service', () => {
  it('carries the note in the same operation as the payment, after it', () => {
    const { request, note } = pay();
    expect(checkGaslessRequest(request, RULES)).toBeNull();
    const call = gaslessCall(base.usdc, request);
    expect(call.to).toBe(MULTICALL3);
    const multi = new Interface(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls)']);
    const [calls] = multi.decodeFunctionData('aggregate3', hex(call.data)) as unknown as [{ target: string; allowFailure: boolean; callData: string }[]];
    expect(calls.map((c) => c.target)).toEqual([base.usdc, base.usdc, STEALTH_ANNOUNCER]);
    // Nothing in the operation may fail on its own: a note is never left for money that did not move.
    expect(calls.every((c) => c.allowFailure === false)).toBe(true);
    const announcer = new Interface(['function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)']);
    const [scheme, address, key, metadata] = announcer.decodeFunctionData('announce', calls[2]!.callData);
    expect([scheme, address, key, metadata]).toEqual([1n, note.stealthAddress, note.ephemeralPubKey, note.metadata]);
  });

  it('lets the receiver find, from that note alone, the address the money went to', () => {
    const { request, note } = pay();
    const found = matchAnnouncement(receiver, bytes(note.ephemeralPubKey), bytes(note.metadata)[0]);
    expect(found?.address).toBe(request.transfers[0]!.to);
    // Two payments by the same code go to two addresses.
    expect(pay(10).request.transfers[0]!.to).not.toBe(request.transfers[0]!.to);
  });

  it('refuses a note that does not belong to a payment in the operation, or is not shaped as the standard says', () => {
    const { request, note } = pay();
    const withNotes = (notes: StealthNote[]): GaslessRequest => ({ ...request, notes });
    expect(checkGaslessRequest(withNotes([{ ...note, stealthAddress: '0x2222222222222222222222222222222222222222' }]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes([note, note]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes([{ ...note, ephemeralPubKey: `0x04${'ab'.repeat(32)}` }]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes([{ ...note, ephemeralPubKey: note.ephemeralPubKey.slice(0, -2) }]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes([{ ...note, metadata: '0x' }]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes([{ ...note, metadata: `0x${'00'.repeat(65)}` }]), RULES)).toBe('bad-request');
    expect(checkGaslessRequest(withNotes(Array.from({ length: 11 }, () => note)), RULES)).toBe('bad-request');
    // No notes at all is the ordinary case and stays allowed.
    expect(checkGaslessRequest(withNotes([]), RULES)).toBeNull();
    expect(gaslessCall(base.usdc, { ...request, notes: undefined }).data.length).toBeLessThan(gaslessCall(base.usdc, request).data.length);
  });
});
