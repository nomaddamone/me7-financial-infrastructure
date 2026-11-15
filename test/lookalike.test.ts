import { describe, expect, it } from 'vitest';
import { lookalikeOf, resembles } from '../src/core/lookalike.ts';

const REAL = 'TLo16PtRAu5f2dazCwegnLUMhjYgaYgU8i';
const TWIN = 'TLo1xxxxxxxxxxxxxxxxxxxxxxxxxxgU8i';
const OTHER = 'TMkkPBi7UcHb3SGTpxqTFFKF52e4cm95Vo';
const EVM = '0x2191AAdA5B32A6A76a0D945B4C16b62ef34Ec5F8';

describe('look-alike addresses', () => {
  it('sees a twin: the same ends, another middle', () => {
    expect(resembles(REAL, TWIN)).toBe(true);
    expect(lookalikeOf(TWIN, [OTHER, REAL])).toBe(REAL);
  });
  it('does not take an address for its own twin, nor strangers for twins', () => {
    expect(resembles(REAL, REAL)).toBe(false);
    expect(resembles(REAL, OTHER)).toBe(false);
    expect(lookalikeOf(REAL, [REAL, TWIN])).toBeNull();
    expect(lookalikeOf(OTHER, [REAL])).toBeNull();
  });
  it('does not count the letter every Tron address starts with', () => {
    expect(resembles('TAbcdefghijkmnopqrstuvwxyz1234567a', 'TZZZZZZZZZZZZZZZZZZZZZZZZZZZZ4567a')).toBe(false);
  });
  it('compares EVM addresses whatever their case', () => {
    expect(resembles(EVM, EVM.toLowerCase())).toBe(false);
    expect(lookalikeOf(EVM.toLowerCase(), [EVM])).toBeNull();
    expect(resembles(EVM, '0x2191000000000000000000000000000000Ec5f8'.replace('Ec5f8', '4ec5f8'))).toBe(true);
    expect(resembles(EVM, '0x00000000000000000000000000000000004Ec5F8')).toBe(true);
    expect(resembles(EVM, '0x1111111111111111111111111111111111111111')).toBe(false);
  });
  it('never matches across networks', () => {
    expect(resembles(REAL, EVM)).toBe(false);
  });
});
