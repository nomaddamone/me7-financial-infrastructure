import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropCrossing, loadCrossings, openCrossings, saveCrossing, tronAddressAt, type Crossing } from '../src/app/crossing.ts';
import { openWallet } from '../src/app/wallet.ts';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

const wallet = openWallet(MNEMONIC);
const crossing = (over: Partial<Crossing> = {}): Crossing => ({
  id: 'a',
  index: 1,
  address: tronAddressAt(wallet, 1),
  to: 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs',
  amount: '100000000',
  budget: '103100000',
  deposit: '0x1111111111111111111111111111111111111111',
  usdcIn: '104400000',
  baseTx: '',
  started: 1,
  deadline: 2,
  stage: 'open',
  payTx: '',
  ...over,
});

describe('the record of payments that cross from Base to Tron', () => {
  it('gives each crossing a Tron address of its own, apart from the main one', () => {
    expect(tronAddressAt(wallet, 0)).toBe(wallet.tron);
    expect(tronAddressAt(wallet, 1)).not.toBe(wallet.tron);
    expect(tronAddressAt(wallet, 1)).not.toBe(tronAddressAt(wallet, 2));
    expect(tronAddressAt(wallet, 1)).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it('keeps what is under way, changes it in place, and tells the finished from the open', () => {
    expect(loadCrossings(wallet)).toEqual([]);
    expect(saveCrossing(wallet, crossing())).toBe(true);
    expect(saveCrossing(wallet, crossing({ id: 'b', index: 2, address: tronAddressAt(wallet, 2) }))).toBe(true);
    expect(openCrossings(wallet).map((c) => c.id)).toEqual(['a', 'b']);
    saveCrossing(wallet, crossing({ baseTx: '0xabc', stage: 'paid', payTx: 'ff' }));
    expect(loadCrossings(wallet).map((c) => [c.id, c.stage])).toEqual([['a', 'paid'], ['b', 'open']]);
    expect(openCrossings(wallet).map((c) => c.id)).toEqual(['b']);
    // The number of an address is never handed out twice, even when its crossing is forgotten.
    dropCrossing(wallet, 'b');
    expect(loadCrossings(wallet).map((c) => c.id)).toEqual(['a']);
    expect(JSON.parse([...data.values()][0]!).next).toBe(3);
  });

  it('says so when the browser will not keep the record, and survives a spoilt one', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full'); } });
    expect(saveCrossing(wallet, crossing())).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => '{"next":"x","list":[{"id":1}]}', setItem: () => undefined });
    expect(loadCrossings(wallet)).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ next: 4, list: [crossing(), { id: 'junk' }, crossing({ id: 'c', index: 0 })] }), setItem: () => undefined });
    expect(loadCrossings(wallet).map((c) => c.id)).toEqual(['a']);
  });
});
