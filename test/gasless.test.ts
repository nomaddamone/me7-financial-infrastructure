import { Interface, TypedDataEncoder, verifyTypedData, Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  allOrNothing,
  authorizationCall,
  authorizationDigest,
  authorizationSigner,
  checkGaslessRequest,
  countPayouts,
  domainSeparator,
  gaslessCall,
  gaslessFee,
  MULTICALL3,
  signAuthorization,
  signGaslessPayment,
  type GaslessPricing,
  type GaslessRequest,
  type GaslessRules,
  type SignedAuthorization,
  type TokenDomain,
} from '../src/core/gasless.ts';
import { GASLESS, NETWORKS } from '../src/net/endpoints.ts';

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16));

const base = NETWORKS.mainnet.base!;
const DOMAIN: TokenDomain = { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc };
const sender = new Wallet(`0x${'11'.repeat(32)}`);
const KEY = bytes(sender.privateKey);
const TO = '0x2222222222222222222222222222222222222222';
const NOW = 1_800_000_000n;
const nonces = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
// A transfer costs the relay 0.002 USDC in gas at the prices used in these tests.
const PRICING: GaslessPricing = { base: GASLESS.base, free: GASLESS.free, extra: GASLESS.extra, perCall: 2_000n };
const FEE = gaslessFee(PRICING, 1, 1);
const sign = (over: Partial<{ to: string; amount: bigint; fee: bigint; feeReceiver: string; now: bigint; lifetime: bigint; nonces: Uint8Array }> = {}, key = KEY) =>
  signGaslessPayment(DOMAIN, { from: sender.address, to: TO, amount: 25_000_000n, fee: FEE, feeReceiver: GASLESS.receiver, now: NOW, lifetime: 600n, nonces, ...over }, key);
const request = (over: Parameters<typeof sign>[0] = {}, key = KEY): GaslessRequest => ({ chain: 'base', ...sign(over, key) });
const RULES: GaslessRules = { domain: DOMAIN, feeReceiver: GASLESS.receiver, pricing: PRICING, now: NOW, margin: 60n };

/** A wallet with several addresses, as the pocket will have: money gathered from two of them onto a third, then paid out. */
const keys = [1, 2, 3].map((n) => new Wallet(`0x${String(n).repeat(64)}`));
let counter = 0;
const transfer = (from: Wallet, to: string, value: bigint): SignedAuthorization =>
  signAuthorization(DOMAIN, { from: from.address, to, value, validAfter: 0n, validBefore: NOW + 600n, nonce: `0x${(++counter).toString(16).padStart(64, '0')}` }, bytes(from.privateKey));
const gathered = (recipients: string[] = [TO], fee?: bigint): GaslessRequest => {
  const [a, b, fresh] = keys as [Wallet, Wallet, Wallet];
  const transfers = [transfer(a, fresh.address, 10_000_000n), transfer(b, fresh.address, 8_000_000n), ...recipients.map((to) => transfer(fresh, to, 1_000_000n))];
  return { chain: 'base', transfers, fee: transfer(fresh, GASLESS.receiver, fee ?? gaslessFee(PRICING, transfers.length, recipients.length)) };
};

const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
const ethersDomain = { name: 'USD Coin', version: '2', chainId: 8453n, verifyingContract: base.usdc };
const usdc = new Interface(['function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)']);
const multi = new Interface(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])']);
const one = (a: SignedAuthorization) => usdc.encodeFunctionData('transferWithAuthorization', [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s]);

describe('a signed permission to move usdc', () => {
  it('uses the very value the USDC contract on Base reports for itself', () => {
    // Read from the contract (DOMAIN_SEPARATOR) on 2026-11-11.
    expect(domainSeparator(DOMAIN)).toBe('0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f');
    expect(domainSeparator(DOMAIN)).toBe(TypedDataEncoder.hashDomain(ethersDomain));
  });

  it('signs exactly what an independent library signs, and that library accepts the signature', () => {
    const { transfers, fee } = sign();
    const pay = transfers[0]!;
    for (const auth of [pay, fee]) {
      const message = { from: auth.from, to: auth.to, value: auth.value, validAfter: auth.validAfter, validBefore: auth.validBefore, nonce: auth.nonce };
      expect(hex(authorizationDigest(DOMAIN, auth))).toBe(TypedDataEncoder.hash(ethersDomain, types, message));
      expect(verifyTypedData(ethersDomain, types, message, { r: auth.r, s: auth.s, v: auth.v })).toBe(sender.address);
      expect(authorizationSigner(DOMAIN, auth)).toBe(sender.address);
    }
    expect(transfers).toHaveLength(1);
    expect(pay.to).toBe(TO);
    expect(pay.value).toBe(25_000_000n);
    expect(fee.to).toBe(GASLESS.receiver);
    expect(fee.value).toBe(FEE);
    expect(pay.nonce).not.toBe(fee.nonce);
    expect(pay.validBefore).toBe(NOW + 600n);
  });

  it('names another signer the moment anything in it is changed', () => {
    const pay = sign().transfers[0]!;
    expect(authorizationSigner(DOMAIN, { ...pay, to: '0x3333333333333333333333333333333333333333' })).not.toBe(sender.address);
    expect(authorizationSigner(DOMAIN, { ...pay, value: pay.value + 1n })).not.toBe(sender.address);
    expect(authorizationSigner({ ...DOMAIN, chainId: 1n }, pay)).not.toBe(sender.address);
    expect(() => authorizationSigner(DOMAIN, { ...pay, v: 1 })).toThrow();
  });

  it('builds the calls the token and Multicall3 expect, in the order given, with the fee last', () => {
    const single = request();
    expect(hex(authorizationCall(single.transfers[0]!))).toBe(one(single.transfers[0]!));
    const call = gaslessCall(base.usdc, single);
    expect(call.to).toBe(MULTICALL3);
    expect(hex(call.data)).toBe(multi.encodeFunctionData('aggregate3', [[[base.usdc, false, one(single.transfers[0]!)], [base.usdc, false, one(single.fee)]]]));

    const many = gathered();
    expect(hex(gaslessCall(base.usdc, many).data)).toBe(multi.encodeFunctionData('aggregate3', [[...many.transfers, many.fee].map((a) => [base.usdc, false, one(a)])]));
    expect(hex(allOrNothing([{ to: base.usdc, data: authorizationCall(single.fee) }]))).toBe(multi.encodeFunctionData('aggregate3', [[[base.usdc, false, one(single.fee)]]]));
  });
});

describe('the fee for an operation', () => {
  it('is the gas expense, rounded up to a cent, plus one dollar', () => {
    expect(gaslessFee(PRICING, 1, 1)).toBe(1_010_000n); // 2 calls x 0.002 = 0.004 -> 0.01
    expect(gaslessFee(PRICING, 21, 1)).toBe(1_050_000n); // 22 calls x 0.002 = 0.044 -> 0.05
    expect(gaslessFee({ ...PRICING, perCall: 0n }, 1, 1)).toBe(1_010_000n);
    expect(gaslessFee({ ...PRICING, perCall: 30_000n }, 1, 1)).toBe(1_060_000n);
  });

  it('adds twenty cents for each recipient after the fifth', () => {
    expect(gaslessFee(PRICING, 5, 5)).toBe(1_020_000n);
    expect(gaslessFee(PRICING, 6, 6)).toBe(1_220_000n);
    expect(gaslessFee(PRICING, 30, 30)).toBe(1_000_000n + 25n * 200_000n + 70_000n);
  });

  it('counts gathering one’s own money as no recipient at all', () => {
    const count = (r: GaslessRequest) => countPayouts(r.transfers, r.fee);
    expect(count(gathered())).toBe(1);
    expect(count(gathered([TO, '0x4444444444444444444444444444444444444444']))).toBe(2);
    expect(count(gathered([TO, TO, TO]))).toBe(1);
    expect(count(request())).toBe(1);
    // Everything brought onto one's own address, which then pays the fee: nobody is paid.
    const [a, b, own] = keys as [Wallet, Wallet, Wallet];
    expect(countPayouts([transfer(a, own.address, 1n), transfer(b, own.address, 1n)], transfer(own, GASLESS.receiver, 1n))).toBe(0);
    // Twenty addresses emptied onto one and paid out: still one recipient, still about a dollar.
    expect(gaslessFee(PRICING, 21, 1)).toBeLessThan(1_100_000n);
  });
});

describe('what the relay agrees to carry', () => {
  it('takes an honest request, from one address or gathered from several', () => {
    expect(checkGaslessRequest(request(), RULES)).toBeNull();
    expect(checkGaslessRequest(request({ fee: 2_000_000n }), RULES)).toBeNull();
    expect(checkGaslessRequest(gathered(), RULES)).toBeNull();
  });

  it('accepts a fee quoted a moment ago at up to twice cheaper gas, and no less', () => {
    const dearer: GaslessRules = { ...RULES, pricing: { ...PRICING, perCall: 9_000n } };
    expect(checkGaslessRequest(request({ fee: gaslessFee({ ...PRICING, perCall: 4_500n }, 1, 1) }), dearer)).toBeNull();
    expect(checkGaslessRequest(request({ fee: 1_000_000n }), dearer)).toBe('bad-fee');
  });

  it('refuses a fee that is too small or goes to someone else', () => {
    expect(checkGaslessRequest(request({ fee: 999_999n }), RULES)).toBe('bad-fee');
    expect(checkGaslessRequest(request({ feeReceiver: TO }), RULES)).toBe('bad-fee');
    // Seven recipients for the price of one.
    const seven = Array.from({ length: 7 }, (_, i) => `0x${(i + 4).toString(16).repeat(40)}`);
    expect(checkGaslessRequest(gathered(seven, FEE), RULES)).toBe('bad-fee');
    expect(checkGaslessRequest(gathered(seven), RULES)).toBeNull();
  });

  it('refuses permissions that are tampered with, signed by the wrong key or reused', () => {
    const good = request();
    const pay = good.transfers[0]!;
    expect(checkGaslessRequest({ ...good, transfers: [{ ...pay, value: 1n }] }, RULES)).toBe('bad-signature');
    expect(checkGaslessRequest({ ...good, fee: { ...good.fee, value: 5_000_000n } }, RULES)).toBe('bad-signature');
    expect(checkGaslessRequest(request({}, bytes(new Wallet(`0x${'22'.repeat(32)}`).privateKey)), RULES)).toBe('bad-signature');
    expect(checkGaslessRequest(request({ nonces: new Uint8Array(64).fill(7) }), RULES)).toBe('bad-request');
    expect(checkGaslessRequest({ ...good, transfers: [pay, pay] }, RULES)).toBe('bad-request');
    expect(checkGaslessRequest({ ...good, transfers: [{ ...pay, nonce: '0x12' }] }, RULES)).toBe('bad-request');
    expect(checkGaslessRequest({ ...good, transfers: [] }, RULES)).toBe('bad-request');
    expect(checkGaslessRequest({ ...good, transfers: Array.from({ length: 41 }, () => pay) }, RULES)).toBe('bad-request');
  });

  it('refuses permissions that have run out or soon will', () => {
    expect(checkGaslessRequest(request({ lifetime: 30n }), RULES)).toBe('expired');
    expect(checkGaslessRequest(request(), { ...RULES, now: NOW + 900n })).toBe('expired');
  });
});
