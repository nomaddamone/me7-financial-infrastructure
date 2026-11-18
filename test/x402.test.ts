import { describe, expect, it } from 'vitest';
import { evmAddressFromPrivateKey } from '../src/core/evm.ts';
import { authorizationSigner } from '../src/core/gasless.ts';
import { paymentHeader, readPaymentAsk } from '../src/core/x402.ts';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0xbe683fa884b75cd5cac20a13772ef8fffa716ad6';
// What the screening service really answered an unpaid request with (2026-11-18).
const said = {
  x402Version: 2,
  error: 'payment_required',
  resource: { url: '/screen/light/base/0x4200000000000000000000000000000000000006', description: 'Payment required', mimeType: 'application/json' },
  accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: USDC, amount: '200000', payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }],
};
const want = { chainId: 8453n, token: USDC, most: 200_000n };

describe('paying for an answer with the request (x402)', () => {
  it('reads what the service asks', () => {
    expect(readPaymentAsk(said, want)).toMatchObject({ amount: 200_000n, payTo: PAY_TO, seconds: 300, name: 'USD Coin', version: '2', resource: said.resource });
  });

  it('refuses a price above the one expected, another token, another network, another version', () => {
    expect(() => readPaymentAsk(said, { ...want, most: 199_999n })).toThrow('above');
    expect(() => readPaymentAsk(said, { ...want, token: PAY_TO })).toThrow('no way');
    expect(() => readPaymentAsk(said, { ...want, chainId: 1n })).toThrow('no way');
    expect(() => readPaymentAsk({ ...said, x402Version: 1 }, want)).toThrow('not a payment request');
    expect(() => readPaymentAsk({ ...said, accepts: [{ ...said.accepts[0], payTo: 'somewhere' }] }, want)).toThrow('no way');
    expect(() => readPaymentAsk(null, want)).toThrow();
  });

  it('makes a header that carries a permission for exactly the transfer asked, signed by the payer', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i + 3);
    const from = evmAddressFromPrivateKey(key);
    const nonce = `0x${'ab'.repeat(32)}`;
    const header = paymentHeader(readPaymentAsk(said, want), { from, chainId: 8453n, token: USDC, key, now: 1_800_000_000, nonce });
    const sent = JSON.parse(atob(header)) as { x402Version: number; resource: unknown; accepted: unknown; payload: { signature: string; authorization: Record<string, string> } };
    expect(sent.x402Version).toBe(2);
    expect(sent.resource).toEqual(said.resource);
    expect(sent.accepted).toEqual(said.accepts[0]);
    expect(sent.payload.authorization).toEqual({ from, to: PAY_TO, value: '200000', validAfter: '1799999940', validBefore: '1800000300', nonce });
    expect(sent.payload.signature).toMatch(/^0x[0-9a-f]{128}(1b|1c)$/);
    const sig = sent.payload.signature;
    const signer = authorizationSigner(
      { name: 'USD Coin', version: '2', chainId: 8453n, contract: USDC },
      { from, to: PAY_TO, value: 200_000n, validAfter: 1_799_999_940n, validBefore: 1_800_000_300n, nonce, r: sig.slice(0, 66), s: `0x${sig.slice(66, 130)}`, v: parseInt(sig.slice(130), 16) },
    );
    expect(signer).toBe(from);
  });
});
