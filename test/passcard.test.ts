import { describe, expect, it } from 'vitest';
import { choosePassAddresses, PASS_ADDRESSES } from '../src/app/passcard.ts';
import { STEALTH_INDEX } from '../src/app/stealth.ts';

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;
const holding = (index: number, balance = 0n) => ({ index, address: addr(index), balance, spent: false });
const at = (index: number) => ({ index, address: addr(index) });

describe('the addresses a card in Apple Wallet is opened for', () => {
  it('opens the main one, the one shown for receiving and the next two', () => {
    const holdings = Array.from({ length: 22 }, (_, i) => holding(i));
    expect(choosePassAddresses(addr(0), { holdings, receive: at(1), fresh: at(2) }, new Set())).toEqual([addr(0), addr(3), addr(2), addr(1)]);
  });

  it('keeps the newest addresses when the pocket has more than the service takes', () => {
    // Forty addresses were paid to; money is expected on the forty-first.
    const holdings = Array.from({ length: 62 }, (_, i) => holding(i, i === 7 ? 5_000_000n : 0n));
    const chosen = choosePassAddresses(addr(0), { holdings, receive: at(41), fresh: at(42) }, new Set([12]));
    expect(chosen).toHaveLength(PASS_ADDRESSES);
    expect(chosen[0]).toBe(addr(0));
    // What money is expected on, an address set aside for a request, and an old address that still holds money.
    for (const i of [41, 42, 43, 12, 7]) expect(chosen).toContain(addr(i));
    // The rest are the newest of the used ones, not the oldest.
    expect(chosen).toContain(addr(40));
    expect(chosen).not.toContain(addr(1));
  });

  it('never opens a stealth address', () => {
    const holdings = [holding(0), holding(1), holding(2), holding(3), { ...holding(STEALTH_INDEX, 9_000_000n) }];
    expect(choosePassAddresses(addr(0), { holdings, receive: at(1), fresh: at(2) }, new Set())).not.toContain(addr(STEALTH_INDEX));
  });
});
