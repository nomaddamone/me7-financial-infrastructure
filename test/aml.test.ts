import { describe, expect, it } from 'vitest';
import { networkOfAddress, readRiskReport } from '../src/core/aml.ts';

describe('reading a risk report', () => {
  it('finds the score and what was found, in the shape the screening service documents', () => {
    const answer = {
      request_id: 'x',
      code: 200000,
      message: 'ok',
      data: {
        chain_id: 8453,
        address: '0x42',
        risk_score: 3,
        risk_indicators: [
          { type: 'Individual Risk', indicator: { name: 'Mixer', code: 5 } },
          { type: 'Interaction Risk', indicator: { name: 'Sanctioned', code: 9 }, source: '0x1' },
          { type: 'Interaction Risk', indicator: { name: 'Sanctioned', code: 9 }, source: '0x2' },
        ],
      },
    };
    expect(readRiskReport(answer)).toEqual({ score: 3, indicators: ['Mixer', 'Sanctioned'] });
  });

  it('reads a bare answer, other spellings, and a clean one', () => {
    expect(readRiskReport({ riskScore: '1', riskIndicators: ['Scam', { name: 'Phishing' }] })).toEqual({ score: 1, indicators: ['Scam', 'Phishing'] });
    expect(readRiskReport({ data: { risk_score: 1, risk_indicators: [] } })).toEqual({ score: 1, indicators: [] });
  });

  it('claims nothing it cannot read', () => {
    for (const odd of [null, 'text', [], { data: { risk_score: {} } }, { something: 'else' }]) expect(readRiskReport(odd)).toEqual({ score: null, indicators: [] });
  });

  it('tells which network an address looks like', () => {
    expect(networkOfAddress('0x4200000000000000000000000000000000000006')).toBe('evm');
    expect(networkOfAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe('tron');
    expect(networkOfAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe('bitcoin');
    expect(networkOfAddress('hello')).toBeNull();
  });
});
