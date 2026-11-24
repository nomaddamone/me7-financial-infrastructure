import { AbiCoder, HDNodeWallet, Interface } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGaslessRequest, countPayouts, gaslessFee, MULTICALL3, signAuthorization, type GaslessPricing, type TokenDomain } from '../src/core/gasless.ts';
import {
  firstSpendNonce,
  isUsed,
  MAX_SOURCES,
  fuelAuthorizations,
  planAuthorizations,
  planCollect,
  planFuel,
  planPayment,
  planSendAll,
  receiveIndex,
  type Holding,
  type PaymentPlan,
} from '../src/core/rotation.ts';
import { GASLESS, NETWORKS } from '../src/net/endpoints.ts';
import { readSumBalance, scanHoldings, sumBalanceCall } from '../src/net/rotation.ts';

const base = NETWORKS.mainnet.base!;
const DOMAIN: TokenDomain = { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc };
const PRICING: GaslessPricing = { base: GASLESS.base, free: GASLESS.free, extra: GASLESS.extra, perCall: 2_000n };
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const account = (i: number) => HDNodeWallet.fromPhrase(PHRASE, '', `m/44'/60'/0'/0/${i}`);
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16));
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
/** A wallet whose addresses hold these amounts of USDC, the main address first. */
const wallet = (...amounts: number[]): Holding[] => amounts.map((amount, index) => ({ index, address: account(index).address, balance: usdc(amount), spent: false }));
const freshAfter = (h: Holding[]) => ({ index: h.length + 1, address: account(h.length + 1).address });
const TO = '0x2222222222222222222222222222222222222222';
const NOW = 1_800_000_000n;
let n = 0;
const options = { feeReceiver: GASLESS.receiver, now: NOW, lifetime: 600n, random: () => `0x${(++n).toString(16).padStart(64, '0')}` };
const ok = (plan: PaymentPlan | string): PaymentPlan => {
  if (typeof plan === 'string') throw new Error(plan);
  return plan;
};
/** Sign a plan as the pocket would and ask whether the relay would take it. */
const relayVerdict = (plan: PaymentPlan) => {
  const unsigned = planAuthorizations(plan, options);
  const sign = (u: (typeof unsigned.transfers)[number]) => {
    const { index, ...auth } = u;
    return signAuthorization(DOMAIN, auth, bytes(account(index).privateKey));
  };
  const request = { chain: 'base', transfers: unsigned.transfers.map(sign), fee: sign(unsigned.fee) };
  return { request, problem: checkGaslessRequest(request, { domain: DOMAIN, feeReceiver: GASLESS.receiver, pricing: PRICING, now: NOW, margin: 60n }) };
};

describe('which address is shown for receiving', () => {
  it('is the first one after the main address that has never been used', () => {
    expect(receiveIndex(wallet(100))).toBe(1);
    expect(receiveIndex(wallet(0, 5, 7))).toBe(3);
    // An address that was paid to and later emptied is still used: it is not handed out again.
    const emptied = wallet(0, 0, 7);
    emptied[1]!.spent = true;
    expect(isUsed(emptied[1]!)).toBe(true);
    expect(receiveIndex(emptied)).toBe(3);
    // Nothing arrived on the address shown: it stays the same however often it is asked for.
    expect(receiveIndex(wallet(0, 5, 0, 0))).toBe(2);
  });

  it('marks each address by a number of its own, the same on every device', () => {
    const a = account(1).address;
    expect(firstSpendNonce(a)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(firstSpendNonce(a)).toBe(firstSpendNonce(a.toLowerCase()));
    expect(firstSpendNonce(a)).not.toBe(firstSpendNonce(account(2).address));
  });
});

describe('where the money for a payment comes from', () => {
  it('pays straight from one address when one holds enough, choosing the smallest that does', () => {
    const h = wallet(0, 500, 30, 12);
    const plan = ok(planPayment(h, [{ to: TO, value: usdc(10) }], PRICING, freshAfter(h)));
    expect(plan.via).toBeNull();
    expect(plan.sources.map((s) => s.holding.index)).toEqual([3]);
    expect(plan.fee).toBe(gaslessFee(PRICING, 1, 1));
    expect(plan.transfers).toBe(1);
    // 12 is not enough for 11.5 plus the fee, so the next smallest pays.
    expect(ok(planPayment(h, [{ to: TO, value: usdc(11.5) }], PRICING, freshAfter(h))).sources[0]!.holding.index).toBe(2);
  });

  it('gathers from the fewest addresses when none holds enough, and leaves nothing on the fresh one', () => {
    const h = wallet(0, 40, 30, 12, 5);
    const fresh = freshAfter(h);
    const plan = ok(planPayment(h, [{ to: TO, value: usdc(60) }], PRICING, fresh));
    expect(plan.via).toEqual(fresh);
    expect(plan.sources.map((s) => s.holding.index)).toEqual([1, 2]);
    expect(plan.fee).toBe(gaslessFee(PRICING, 3, 1));
    // The first is emptied; the second gives only what is still missing.
    expect(plan.sources[0]!.value).toBe(usdc(40));
    expect(plan.sources[1]!.value).toBe(usdc(60) + plan.fee - usdc(40));
    expect(plan.sources.reduce((s, x) => s + x.value, 0n)).toBe(usdc(60) + plan.fee);
    expect(ok(planPayment(h, [{ to: TO, value: usdc(80) }], PRICING, fresh)).sources.map((s) => s.holding.index)).toEqual([1, 2, 3]);
  });

  it('says so when the wallet does not hold the amount and the fee, or when it is spread too thin', () => {
    const h = wallet(0, 40, 30);
    expect(planPayment(h, [{ to: TO, value: usdc(69.5) }], PRICING, freshAfter(h))).toBe('no-funds');
    expect(planPayment(wallet(0), [{ to: TO, value: 1n }], PRICING, freshAfter(h))).toBe('no-funds');
    expect(planPayment(h, [], PRICING, freshAfter(h))).toBe('no-funds');
    const thin = wallet(0, ...new Array<number>(MAX_SOURCES + 5).fill(2));
    expect(planPayment(thin, [{ to: TO, value: usdc(58) }], PRICING, freshAfter(thin))).toBe('too-many');
    expect(ok(planPayment(thin, [{ to: TO, value: usdc(40) }], PRICING, freshAfter(thin))).sources).toHaveLength(21);
  });

  it('pays several recipients in one operation, charging for those beyond the fifth', () => {
    const h = wallet(0, 100);
    const seven = Array.from({ length: 7 }, (_, i) => ({ to: `0x${(i + 3).toString(16).repeat(40)}`, value: usdc(1) }));
    const plan = ok(planPayment(h, seven, PRICING, freshAfter(h)));
    expect(plan.transfers).toBe(7);
    expect(plan.fee).toBe(gaslessFee(PRICING, 7, 7));
    expect(plan.fee).toBeGreaterThan(usdc(1.4));
    expect(relayVerdict(plan).problem).toBeNull();
  });

  it('sends everything: every address emptied, the recipient gets the total less the fee', () => {
    const one = wallet(25);
    const direct = ok(planSendAll(one, TO, PRICING, freshAfter(one)));
    expect(direct.via).toBeNull();
    expect(direct.payouts).toEqual([{ to: TO, value: usdc(25) - gaslessFee(PRICING, 1, 1) }]);

    const h = wallet(3, 40, 0, 12);
    const all = ok(planSendAll(h, TO, PRICING, freshAfter(h)));
    expect(all.sources.map((s) => [s.holding.index, s.value])).toEqual([[1, usdc(40)], [3, usdc(12)], [0, usdc(3)]]);
    expect(all.fee).toBe(gaslessFee(PRICING, 4, 1));
    expect(all.payouts[0]!.value).toBe(usdc(55) - all.fee);
    expect(planSendAll(wallet(0.5), TO, PRICING, freshAfter(h))).toBe('no-funds');
    expect(planSendAll(wallet(0, 0), TO, PRICING, freshAfter(h))).toBe('no-funds');
  });

  it('brings everything onto the main address, which pays the fee and is charged for no recipient', () => {
    const h = wallet(0, 40, 0, 12);
    const plan = ok(planCollect(h, PRICING));
    expect(plan.via).toEqual({ index: 0, address: h[0]!.address });
    expect(plan.sources.map((s) => s.holding.index)).toEqual([1, 3]);
    expect(plan.payouts).toEqual([]);
    expect(plan.fee).toBe(gaslessFee(PRICING, 2, 0));
    const { request, problem } = relayVerdict(plan);
    expect(problem).toBeNull();
    expect(countPayouts(request.transfers, request.fee)).toBe(0);
    expect(request.fee.from).toBe(h[0]!.address);
    expect(planCollect(wallet(50), PRICING)).toBe('no-funds');
    expect(planCollect(wallet(50, 0, 0), PRICING)).toBe('no-funds');
  });
});

describe('the permissions a plan turns into', () => {
  it('gathers first, then pays, then the fee, each signed by the address it takes from, and the relay accepts them', () => {
    const h = wallet(0, 40, 30, 12);
    const fresh = freshAfter(h);
    const plan = ok(planPayment(h, [{ to: TO, value: usdc(60) }], PRICING, fresh));
    const { transfers, fee } = planAuthorizations(plan, options);
    expect(transfers.map((t) => [t.index, t.to])).toEqual([[1, fresh.address], [2, fresh.address], [fresh.index, TO]]);
    expect(fee).toMatchObject({ index: fresh.index, from: fresh.address, to: GASLESS.receiver, value: plan.fee });
    expect(transfers[2]!.value).toBe(usdc(60));
    expect(transfers.every((t) => t.validBefore === NOW + 600n)).toBe(true);
    const { request, problem } = relayVerdict(plan);
    expect(problem).toBeNull();
    expect(countPayouts(request.transfers, request.fee)).toBe(1);
  });

  it('marks the first transfer of every address, so an emptied address is recognised later', () => {
    const h = wallet(0, 40, 30);
    h[2]!.spent = true;
    const fresh = freshAfter(h);
    const { transfers, fee } = planAuthorizations(ok(planPayment(h, [{ to: TO, value: usdc(60) }], PRICING, fresh)), options);
    expect(transfers[0]!.nonce).toBe(firstSpendNonce(h[1]!.address));
    // This address has sent before: its mark is already on the chain, and a used number cannot be used again.
    expect(transfers[1]!.nonce).not.toBe(firstSpendNonce(h[2]!.address));
    // The fresh address is marked by its payment, not by its fee.
    expect(transfers[2]!.nonce).toBe(firstSpendNonce(fresh.address));
    expect(fee.nonce).not.toBe(firstSpendNonce(fresh.address));
    expect(new Set([...transfers, fee].map((t) => t.nonce)).size).toBe(4);
  });
});

describe('reading the addresses from the chain', () => {
  const coder = AbiCoder.defaultAbiCoder();
  const multi = new Interface(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])']);
  const token = new Interface(['function balanceOf(address) view returns (uint256)', 'function authorizationState(address, bytes32) view returns (bool)']);
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the balance and the mark of every address in one request', async () => {
    const addresses = [0, 1, 2].map((index) => ({ index, address: account(index).address }));
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const { params } = JSON.parse(init.body) as { params: [{ to: string; data: string }] };
      expect(params[0].to).toBe(MULTICALL3);
      const [calls] = multi.decodeFunctionData('aggregate3', params[0].data) as unknown as [[string, boolean, string][]];
      const results = calls.map(([target, , data]) => {
        expect(target).toBe(base.usdc);
        const call = token.parseTransaction({ data })!;
        asked.push(`${call.name}:${call.args[0] as string}`);
        if (call.name === 'balanceOf') return [true, coder.encode(['uint256'], [call.args[0] === addresses[1]!.address ? 7_500_000n : 0n])];
        expect(call.args[1]).toBe(firstSpendNonce(call.args[0] as string));
        return [true, coder.encode(['bool'], [call.args[0] === addresses[2]!.address])];
      });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: coder.encode(['tuple(bool,bytes)[]'], [results]) }));
    });
    const found = await scanHoldings(base.rpc, base.usdc, addresses);
    expect(found).toEqual([
      { index: 0, address: addresses[0]!.address, balance: 0n, spent: false },
      { index: 1, address: addresses[1]!.address, balance: 7_500_000n, spent: false },
      { index: 2, address: addresses[2]!.address, balance: 0n, spent: true },
    ]);
    expect(asked).toHaveLength(6);
    expect(receiveIndex(found)).toBe(3);
  });

  it('adds several addresses up into one balance for the history', () => {
    const owners = [account(0).address, account(1).address];
    const call = sumBalanceCall(base.usdc, owners);
    expect(call.to).toBe(MULTICALL3);
    const [calls] = multi.decodeFunctionData('aggregate3', call.data) as unknown as [[string, boolean, string][]];
    expect(calls.map(([, , data]) => token.parseTransaction({ data })!.args[0])).toEqual(owners);
    const answer = coder.encode(['tuple(bool,bytes)[]'], [[[true, coder.encode(['uint256'], [5n])], [true, coder.encode(['uint256'], [37n])]]]);
    expect(readSumBalance(answer)).toBe(42n);
    expect(() => readSumBalance(coder.encode(['tuple(bool,bytes)[]'], [[[false, '0x']]]))).toThrow();
    expect(() => readSumBalance('nonsense')).toThrow();
  });

describe('getting the main address ready for what the service cannot carry', () => {
  const COST = usdc(0.25);
  const fee = (transfers: number) => gaslessFee(PRICING, transfers, 0) + COST;
  const plan = (h: Holding[], amount: bigint | 'all') => {
    const p = planFuel(h, amount, PRICING, COST);
    if (typeof p === 'string') throw new Error(p);
    return p;
  };

  it('takes nothing from the other addresses when the main one holds the amount and the fee', () => {
    const p = plan(wallet(100, 40, 30), usdc(50));
    expect(p).toEqual({ gather: [], fee: fee(0), amount: usdc(50) });
  });

  it('takes from the largest addresses only what is missing, the fee counted in', () => {
    const h = wallet(10, 5, 40, 30);
    const p = plan(h, usdc(60));
    // 10 on the main address; 40 and 30 are the largest of the rest. The last gives only what is still short.
    expect(p.gather.map((g) => [g.holding.index, g.value])).toEqual([[2, usdc(40)], [3, usdc(60) + fee(2) - usdc(50)]]);
    expect(p.fee).toBe(fee(2));
    const onMain = usdc(10) + p.gather.reduce((n2, g) => n2 + g.value, 0n);
    expect(onMain - p.fee).toBe(usdc(60));
  });

  it('sells everything: every address is emptied, and the fee comes out of the total', () => {
    const p = plan(wallet(10, 5, 40), 'all');
    expect(p.gather.map((g) => g.value)).toEqual([usdc(40), usdc(5)]);
    expect(p.amount).toBe(usdc(55) - fee(2));
  });

  it('says so when there is not enough, and allows asking for gas alone', () => {
    expect(planFuel(wallet(1, 0.2), usdc(1), PRICING, COST)).toBe('no-funds');
    expect(planFuel(wallet(0, 0), 'all', PRICING, COST)).toBe('no-funds');
    expect(plan(wallet(5), 0n)).toEqual({ gather: [], fee: fee(0), amount: 0n });
  });

  it('signs into a request the service takes: gathering onto the main address, the fee from it', () => {
    const h = wallet(10, 40, 30);
    const p = plan(h, usdc(60));
    const main = h[0]!.address;
    const unsigned = fuelAuthorizations(p, main, options);
    expect(unsigned.transfers.every((t) => t.to === main)).toBe(true);
    expect([unsigned.fee.from, unsigned.fee.to, unsigned.fee.value]).toEqual([main, GASLESS.receiver, p.fee]);
    // An address that never sent through the service marks its first transfer.
    expect(unsigned.transfers[0]!.nonce).toBe(firstSpendNonce(unsigned.transfers[0]!.from));
    const sign = (u: (typeof unsigned.transfers)[number]) => {
      const { index, ...auth } = u;
      return signAuthorization(DOMAIN, auth, bytes(account(index).privateKey));
    };
    const request = { chain: 'base', transfers: unsigned.transfers.map(sign), fee: sign(unsigned.fee) };
    expect(countPayouts(request.transfers, request.fee)).toBe(0);
    // With the price of the ETH added to the fixed part, as the service adds it, the fee is exactly enough.
    const rules = { domain: DOMAIN, feeReceiver: GASLESS.receiver, pricing: { ...PRICING, base: PRICING.base + COST }, now: NOW, margin: 60n };
    expect(checkGaslessRequest(request, rules)).toBeNull();
    expect(checkGaslessRequest({ ...request, fee: sign({ ...unsigned.fee, value: p.fee - usdc(0.3) }) }, rules)).toBe('bad-fee');
  });
});
});
