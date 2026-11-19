import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropCrossing, loadCrossings, oneTimeAddresses, openCrossings, saveCrossing, takeBack, tronAddressAt, type Crossing } from '../src/app/crossing.ts';
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

describe("the wallet's one-time Tron addresses", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  /** Tron nodes that know which addresses hold USDT and which exist; they record which were asked about. */
  function nodes(held: Record<string, bigint>, existing: string[], asked: string[] = []) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body)) as { owner_address?: string; address?: string };
        if (String(url).endsWith('/wallet/triggerconstantcontract')) {
          asked.push(b.owner_address!);
          return json({ result: { result: true }, constant_result: [(held[b.owner_address!] ?? 0n).toString(16).padStart(64, '0')] });
        }
        return json(existing.includes(b.address!) ? { address: b.address, balance: 1 } : {});
      }),
    );
    return asked;
  }
  const at = (index: number) => tronAddressAt(wallet, index);

  it('are found from the phrase and the chain alone, as on a device that has no notes', async () => {
    // Number 1 was paid from and emptied to a remainder, number 2 exists but is empty, number 4 holds money; 3 and 5.. are untouched.
    const asked = nodes({ [at(1)]: 265_063n, [at(4)]: 9_000_000n }, [at(1), at(2)]);
    const other = { ...openWallet(MNEMONIC), evm: '0x1111111111111111111111111111111111111111' };
    const list = await oneTimeAddresses(other);
    expect(list.map((o) => [o.index, o.held, o.crossing])).toEqual([[4, 9_000_000n, null], [2, 0n, null], [1, 265_063n, null]]);
    // The search stops eight untouched numbers after the last used one, and the main address is never part of it.
    expect(asked).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(at));
    // The next crossing will not be given a number that is already used.
    expect(JSON.parse(data.get(`me7.cross.mainnet.${other.evm}`)!).next).toBe(5);
  });

  it('carry the record of the transfer where this browser has one', async () => {
    const mine = { ...openWallet(MNEMONIC), evm: '0x2222222222222222222222222222222222222222' };
    saveCrossing(mine, crossing({ stage: 'paid', payTx: 'ff' }));
    nodes({ [at(1)]: 190_000n }, [at(1)]);
    const list = await oneTimeAddresses(mine);
    expect(list.map((o) => [o.index, o.held, o.crossing?.to])).toEqual([[1, 190_000n, 'TKHuVq1oKVruCGLvqVexFs6dawKv6fQgFs']]);
    // Taking a remainder back is a payment of all of it to the wallet's own main address, with no crossing named.
    expect(takeBack(mine, list[0]!)).toMatchObject({ index: 1, address: at(1), to: mine.tron, amount: '190000', deposit: '' });
  });

  it('are none for a session without the seed', async () => {
    nodes({}, []);
    expect(await oneTimeAddresses({ ...openWallet(MNEMONIC), evm: '0x3333333333333333333333333333333333333333', seed: undefined as unknown as Uint8Array })).toEqual([]);
  });
});
