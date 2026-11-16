import { describe, expect, it } from 'vitest';
import type { GaslessPricing } from '../src/core/gasless.ts';
import { planFromPockets, pocketOf, pocketTotals, STEALTH_INDEX, type Holding, type PocketedPlan } from '../src/core/rotation.ts';

const PRICING: GaslessPricing = { base: 1_000_000n, free: 5, extra: 200_000n, perCall: 0n };
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const plain = (index: number, balance: number): Holding => ({ index, address: addr(index + 1), balance: usdc(balance), spent: false });
const stealth = (n: number, balance: number): Holding => ({ index: STEALTH_INDEX + n, address: addr(0xa000 + n), balance: usdc(balance), spent: false });
const FRESH = { index: 9, address: addr(10) };
const TO = addr(0xbeef);
const pay = (value: number) => [{ to: TO, value: usdc(value) }];
const auto = (prefer: 'plain' | 'stealth', mix = false) => ({ prefer, choice: 'auto' as const, mix });
const sources = (p: PocketedPlan) => p.plan.sources.map((s) => s.holding.index);

// 60 on rotating addresses, 40 that came by the stealth code.
const HOLD = [plain(0, 0), plain(1, 35), plain(2, 25), stealth(0, 30), stealth(1, 10)];

describe('two pockets, one balance', () => {
  it('tells the pockets apart and counts each', () => {
    expect(HOLD.map(pocketOf)).toEqual(['plain', 'plain', 'plain', 'stealth', 'stealth']);
    expect(pocketTotals(HOLD)).toEqual({ plain: usdc(60), stealth: usdc(40) });
  });

  it('pays an ordinary address with ordinary money, and a stealth code with stealth money', () => {
    const a = planFromPockets(HOLD, pay(20), PRICING, FRESH, auto('plain')) as PocketedPlan;
    expect([a.from, sources(a), a.joined]).toEqual(['plain', [2], 0]);
    const b = planFromPockets(HOLD, pay(20), PRICING, FRESH, auto('stealth')) as PocketedPlan;
    expect([b.from, sources(b), b.joined]).toEqual(['stealth', [STEALTH_INDEX], 0]);
  });

  it('goes to the other pocket when the first does not hold enough, still without joining them', () => {
    // 45 is more than the whole stealth pocket holds: the ordinary one pays, from two addresses.
    const a = planFromPockets(HOLD, pay(45), PRICING, FRESH, auto('stealth')) as PocketedPlan;
    expect([a.from, sources(a)]).toEqual(['plain', [1, 2]]);
    const b = planFromPockets([plain(0, 0), plain(1, 5), stealth(0, 30)], pay(20), PRICING, FRESH, auto('plain')) as PocketedPlan;
    expect([b.from, sources(b)]).toEqual(['stealth', [STEALTH_INDEX]]);
  });

  it('says how many stealth addresses one operation ties to each other', () => {
    const p = planFromPockets(HOLD, pay(35), PRICING, FRESH, auto('stealth')) as PocketedPlan;
    expect([p.from, sources(p), p.joined]).toEqual(['stealth', [STEALTH_INDEX, STEALTH_INDEX + 1], 2]);
  });

  it('joins the pockets only when told that the user agreed', () => {
    expect(planFromPockets(HOLD, pay(80), PRICING, FRESH, auto('plain'))).toBe('needs-mix');
    expect(planFromPockets(HOLD, pay(80), PRICING, FRESH, auto('stealth'))).toBe('needs-mix');
    const p = planFromPockets(HOLD, pay(80), PRICING, FRESH, auto('plain', true)) as PocketedPlan;
    expect(p.from).toBe('both');
    expect(p.plan.sources.reduce((sum, s) => sum + s.value, 0n)).toBe(usdc(80) + p.plan.fee);
    // More than there is anywhere stays what it was: no money.
    expect(planFromPockets(HOLD, pay(500), PRICING, FRESH, auto('plain', true))).toBe('no-funds');
    // Agreement given in advance changes nothing while one pocket is enough.
    expect((planFromPockets(HOLD, pay(20), PRICING, FRESH, auto('plain', true)) as PocketedPlan).from).toBe('plain');
  });

  it('keeps to the pocket the user named, and says so when it is short', () => {
    const p = planFromPockets(HOLD, pay(20), PRICING, FRESH, { prefer: 'plain', choice: 'stealth', mix: false }) as PocketedPlan;
    expect([p.from, sources(p)]).toEqual(['stealth', [STEALTH_INDEX]]);
    expect(planFromPockets(HOLD, pay(45), PRICING, FRESH, { prefer: 'plain', choice: 'stealth', mix: true })).toBe('pocket-short');
    expect(planFromPockets(HOLD, pay(70), PRICING, FRESH, { prefer: 'stealth', choice: 'plain', mix: true })).toBe('pocket-short');
  });

  it('sends everything from one pocket, and from both only with agreement', () => {
    const one = planFromPockets(HOLD, { all: TO }, PRICING, FRESH, { prefer: 'plain', choice: 'stealth', mix: false }) as PocketedPlan;
    expect([one.from, one.joined, one.plan.payouts[0]!.value + one.plan.fee]).toEqual(['stealth', 2, usdc(40)]);
    expect(planFromPockets(HOLD, { all: TO }, PRICING, FRESH, auto('plain'))).toBe('needs-mix');
    const both = planFromPockets(HOLD, { all: TO }, PRICING, FRESH, auto('plain', true)) as PocketedPlan;
    expect([both.from, both.plan.payouts[0]!.value + both.plan.fee]).toEqual(['both', usdc(100)]);
    // With money in one pocket only, everything is simply that pocket.
    const only = planFromPockets([plain(0, 0), plain(1, 12)], { all: TO }, PRICING, FRESH, auto('stealth')) as PocketedPlan;
    expect([only.from, sources(only)]).toEqual(['plain', [1]]);
    expect(planFromPockets([plain(0, 0)], { all: TO }, PRICING, FRESH, auto('plain'))).toBe('no-funds');
  });
});
