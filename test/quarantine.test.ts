import { describe, expect, it } from 'vitest';
import { incomingLogsFilter, quarantineMarks, readIncomingLogs, sendersToScreen, TRANSFER_TOPIC, type Incoming, type Taint } from '../src/core/quarantine.ts';

const mine = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const bad = '0xbad0000000000000000000000000000000000bad';
const thief = '0x7777777777777777777777777777777777777777';
const friend = '0x3333333333333333333333333333333333333333';
const flagged = new Map<string, Taint>([
  [bad, 'sanctioned'],
  [thief, 'scam'],
]);
const pay = (to: string, from: string, amount: bigint, tx = ''): Incoming => ({ to, from, amount, ...(tx ? { tx } : {}) });

describe('quarantine of one address', () => {
  it('marks the address a listed sender paid to, and no other', () => {
    const marks = quarantineMarks([pay(mine, bad, 5_000_000n, '0xaa'), pay(other, friend, 9_000_000n)], flagged);
    expect(marks).toEqual([{ address: mine, why: 'sanctioned', from: bad, amount: 5_000_000n, tx: '0xaa' }]);
  });

  it('does not count a cent sent to switch an address off', () => {
    expect(quarantineMarks([pay(mine, bad, 999_999n)], flagged)).toEqual([]);
    expect(quarantineMarks([pay(mine, bad, 1_000_000n)], flagged)).toHaveLength(1);
  });

  it('adds up what one sender paid in several payments', () => {
    const marks = quarantineMarks([pay(mine, bad, 600_000n, '0x01'), pay(mine, bad, 600_000n, '0x02')], flagged);
    expect(marks).toEqual([{ address: mine, why: 'sanctioned', from: bad, amount: 1_200_000n, tx: '0x01' }]);
  });

  it('does not add up different senders to reach the floor', () => {
    expect(quarantineMarks([pay(mine, bad, 600_000n), pay(mine, thief, 600_000n)], flagged)).toEqual([]);
  });

  it('names the gravest reason when an address was paid by two listed senders', () => {
    const marks = quarantineMarks([pay(mine, thief, 50_000_000n), pay(mine, bad, 2_000_000n)], flagged);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.why).toBe('sanctioned');
  });

  it('leaves an address alone when nobody listed paid to it', () => {
    expect(quarantineMarks([pay(mine, friend, 100_000_000n)], flagged)).toEqual([]);
    expect(quarantineMarks([], flagged)).toEqual([]);
  });

  it('asks the lists only about senders who reach the floor', () => {
    expect(sendersToScreen([pay(mine, friend, 5_000_000n), pay(mine, bad, 10n), pay(other, thief, 700_000n), pay(other, thief, 700_000n)])).toEqual([friend, thief]);
  });
});

describe('transfers that arrived in a block', () => {
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const topic = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;
  const log = (from: string, to: string, amount: bigint) => ({
    address: token.toLowerCase(),
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
    blockNumber: '0x10',
    transactionHash: '0xfeed',
  });

  it('asks for one block and every address of the wallet at once', () => {
    expect(incomingLogsFilter(token, [mine, other], 16)).toEqual({ address: token, topics: [TRANSFER_TOPIC, null, [topic(mine), topic(other)]], fromBlock: '0x10', toBlock: '0x10' });
  });

  it('reads who paid, to which address and how much', () => {
    expect(readIncomingLogs([log(bad, mine, 7_000_000n)], token, [mine, other])).toEqual([{ to: mine, from: bad, amount: 7_000_000n, block: 16, tx: '0xfeed' }]);
  });

  it('leaves out money moved between the wallet’s own addresses', () => {
    expect(readIncomingLogs([log(other, mine, 7_000_000n)], token, [mine, other])).toEqual([]);
  });

  it('refuses an answer about another token or of another shape', () => {
    expect(() => readIncomingLogs([{ ...log(bad, mine, 1n), address: other }], token, [mine])).toThrow();
    expect(() => readIncomingLogs([{ ...log(bad, mine, 1n), data: '0x' }], token, [mine])).toThrow();
    expect(() => readIncomingLogs({}, token, [mine])).toThrow();
  });
});
