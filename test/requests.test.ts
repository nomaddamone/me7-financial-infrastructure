import { describe, expect, it } from 'vitest';
import { mergeAsked, sanitizeAsked, type Asked } from '../src/app/requests.ts';

const NOW = 1_800_000_000_000;
const one = (id: string, over: Partial<Asked> = {}): Asked => ({ id, index: 3, address: '0xF3f50213C1d2e255e4B2bAD430F8A38EEF8D718E', amount: '25000000', note: 'за дизайн', created: NOW - 60_000, until: NOW / 1000 + 3600, hash: '#pay=eyJ2IjoxLCJ0IjoiMHg', ...over });

describe('requests for payment kept by the wallet', () => {
  it('keeps what is well formed and drops the rest', () => {
    const good = one('a');
    expect(sanitizeAsked([good, { ...good, kind: 'asked' }], NOW)).toEqual([good, good]);
    for (const bad of [null, 'text', { ...good, index: 0 }, { ...good, address: '0x12' }, { ...good, amount: '-1' }, { ...good, hash: '#trading' }, { ...good, note: 7 }, { ...good, until: 1.5 }, { id: '1', name: 'anna', address: '0x1', asset: 'usdc-base' }]) {
      expect(sanitizeAsked([bad], NOW)).toEqual([]);
    }
    expect(sanitizeAsked('nope', NOW)).toEqual([]);
  });

  it('clears away a request a week after its time is up, and its mark with it', () => {
    const old = one('old', { until: NOW / 1000 - 8 * 86_400 });
    const recent = one('recent', { until: NOW / 1000 - 6 * 86_400, gone: true });
    expect(sanitizeAsked([old, recent], NOW)).toEqual([recent]);
  });

  it('makes one list of two devices’ lists, where a request removed on either stays removed', () => {
    const a = one('a', { created: 1 });
    const b = one('b', { created: 2 });
    const c = one('c', { created: 3 });
    expect(mergeAsked([a, b], [b, c]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(mergeAsked([a, { ...b, gone: true }], [b]).find((x) => x.id === 'b')?.gone).toBe(true);
    expect(mergeAsked([b], [{ ...b, gone: true }]).find((x) => x.id === 'b')?.gone).toBe(true);
    expect(mergeAsked([], [a])).toEqual([a]);
  });
});
