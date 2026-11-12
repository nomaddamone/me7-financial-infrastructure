import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContacts, saveContacts, withContact, type Contact } from '../src/app/contacts.ts';

const OWNER = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
const store = () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  return data;
};

describe('the address book', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps contacts per wallet and reads them back', () => {
    store();
    const list = withContact([], { name: '  Аня  ', address: ' 0x2222222222222222222222222222222222222222 ', asset: 'usdc-base' }, 'a1');
    expect(list).toEqual([{ id: 'a1', name: 'Аня', address: '0x2222222222222222222222222222222222222222', asset: 'usdc-base' }]);
    expect(saveContacts(OWNER, list)).toBe(true);
    expect(loadContacts(OWNER.toLowerCase())).toEqual(list);
    expect(loadContacts('0x0000000000000000000000000000000000000001')).toEqual([]);
  });

  it('keeps one entry per address and coin, under the latest name, and the same address for another coin apart', () => {
    let list: Contact[] = withContact([], { name: 'old', address: '0xAbC0000000000000000000000000000000000001', asset: 'usdc-base' }, '1');
    list = withContact(list, { name: 'new', address: '0xabc0000000000000000000000000000000000001', asset: 'usdc-base' }, '2');
    list = withContact(list, { name: 'eth', address: '0xabc0000000000000000000000000000000000001', asset: 'eth-base' }, '3');
    expect(list.map((c) => [c.id, c.name])).toEqual([['2', 'new'], ['3', 'eth']]);
    expect(withContact([], { name: 'x'.repeat(100), address: 'T', asset: 'trx' }, '4')[0]!.name).toHaveLength(40);
  });

  it('drops anything malformed instead of showing it, and survives a browser without storage', () => {
    const data = store();
    data.set(`me7.contacts.${OWNER.toLowerCase()}`, JSON.stringify([{ id: '1', name: 'ok', address: '0x1', asset: 'eth' }, { id: 2, name: 'bad' }, null, { id: '3', name: '', address: 'x', asset: 'eth' }]));
    expect(loadContacts(OWNER)).toEqual([{ id: '1', name: 'ok', address: '0x1', asset: 'eth' }]);
    data.set(`me7.contacts.${OWNER.toLowerCase()}`, '{not json');
    expect(loadContacts(OWNER)).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(loadContacts(OWNER)).toEqual([]);
    expect(saveContacts(OWNER, [])).toBe(false);
  });
});
