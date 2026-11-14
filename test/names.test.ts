import { Interface, namehash as ethersNamehash } from 'ethers';
import { describe, expect, it } from 'vitest';
import { addrOfData, isIssuableLabel, nameAvailableData, nameFee, namehash, namePriceData, NAME_RESOLVER, NAME_YEAR, parseName, registerNameData, resolverOfData } from '../src/core/names.ts';

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;

describe('names that stand for an address', () => {
  it('are numbered exactly as an independent library numbers them', () => {
    for (const name of ['eth', 'base.eth', 'anna.base.eth', 'vitalik.eth', 'a-b.c9.eth']) expect(namehash(name)).toBe(ethersNamehash(name));
    expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae');
  });

  it('are understood on the network they belong to, however they are typed', () => {
    expect(parseName(' Anna.Base.ETH ')).toEqual({ name: 'anna.base.eth', chain: 'base' });
    expect(parseName('anna.eth')).toEqual({ name: 'anna.eth', chain: 'ethereum' });
    expect(parseName('pay.anna.eth')).toEqual({ name: 'pay.anna.eth', chain: 'ethereum' });
  });

  it('are not looked up when they could be a look-alike or are not names at all', () => {
    for (const bad of [
      '',
      'anna',
      'eth',
      '.eth',
      'anna..eth',
      '-anna.eth',
      'anna-.eth',
      'an na.eth',
      'anna.com',
      'аnna.eth', // the first letter is Cyrillic
      'xn--nna-5cd.eth',
      'anna_1.eth',
      'ånna.base.eth',
      '0x91e98673268b84b73FD4822F2D55Ea8CBd675ce0',
      'a.b.c.d.eth',
      `${'a'.repeat(64)}.eth`,
      'anna.eth/transfer',
    ]) {
      expect(parseName(bad), bad).toBeNull();
    }
  });

  it('ask the registry and the records contract in the standard way', () => {
    const node = namehash('anna.base.eth');
    expect(resolverOfData(node)).toBe(`0x0178b8bf${node.slice(2)}`);
    expect(addrOfData(node)).toBe(`0x3b3b57de${node.slice(2)}`);
  });
});

describe('a name of one\'s own', () => {
  const OWNER = '0x91e98673268b84b73FD4822F2D55Ea8CBd675ce0';
  const controller = new Interface([
    'function register((string name, address owner, uint256 duration, address resolver, bytes[] data, bool reverseRecord, uint256[] coinTypes, uint256 signatureExpiry, bytes signature) request) payable',
    'function registerPrice(string name, uint256 duration) view returns (uint256)',
    'function available(string name) view returns (bool)',
  ]);
  const resolver = new Interface(['function setAddr(bytes32 node, address a)']);

  it('is registered with exactly the call an independent library builds', () => {
    const setAddr = resolver.encodeFunctionData('setAddr', [ethersNamehash('anna-7.base.eth'), OWNER]);
    expect(hex(registerNameData('anna-7', OWNER))).toBe(controller.encodeFunctionData('register', [['anna-7', OWNER, NAME_YEAR, NAME_RESOLVER, [setAddr], false, [], 0, '0x']]));
    expect(hex(namePriceData('anna-7'))).toBe(controller.encodeFunctionData('registerPrice', ['anna-7', NAME_YEAR]));
    expect(hex(nameAvailableData('anna-7'))).toBe(controller.encodeFunctionData('available', ['anna-7']));
  });

  it('is for a year, points at its owner and is nobody\'s primary name', () => {
    const [request] = controller.decodeFunctionData('register', hex(registerNameData('anna', OWNER))) as unknown as [{ owner: string; duration: bigint; reverseRecord: boolean; data: string[] }];
    expect(request.owner).toBe(OWNER);
    expect(request.duration).toBe(365n * 24n * 3600n);
    expect(request.reverseRecord).toBe(false);
    expect(resolver.decodeFunctionData('setAddr', request.data[0]!)[1]).toBe(OWNER);
  });

  it('may be three plain characters or more', () => {
    for (const good of ['abc', 'anna', 'a-b', 'me7', '123', 'a'.repeat(63)]) expect(isIssuableLabel(good), good).toBe(true);
    for (const bad of ['', 'ab', 'Anna', 'an na', '-ab', 'ab-', 'a.b', 'anna.base.eth', 'xn--abc', 'аня', 'a_b', 'a'.repeat(64)]) expect(isIssuableLabel(bad), bad).toBe(false);
  });

  it('costs the registry\'s price and the gas, rounded up to a cent, plus the service\'s half dollar', () => {
    expect(nameFee(195_800n, 2_600n, 500_000n)).toBe(700_000n);
    expect(nameFee(200_000n, 0n, 500_000n)).toBe(700_000n);
    expect(nameFee(200_001n, 0n, 500_000n)).toBe(710_000n);
    expect(nameFee(19_580_000n, 2_600n, 500_000n)).toBe(20_090_000n);
  });
});
