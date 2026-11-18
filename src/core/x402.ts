import { signAuthorization, type TokenDomain } from './gasless.ts';

/**
 * x402: paying for one answer of a web service, with the request itself. The service answers a
 * plain request with "402 Payment Required" and says what it wants: how much of which token, to
 * which address. The caller signs a permission for exactly that transfer (the same kind of
 * permission USDC on Base is moved by, EIP-3009) and repeats the request with it in a header;
 * the service takes the payment and gives its answer. No account, no key.
 *
 * This file reads what the service asks and makes the header. Nothing is signed unless the ask
 * is what the caller expected: the right token on the right network, and no more than a price
 * the caller named.
 */
export interface PaymentAsk {
  /** The whole thing the service said, sent back to it as it was. */
  resource: unknown;
  accepted: Record<string, unknown>;
  amount: bigint;
  payTo: string;
  /** How long the permission should stay good, in seconds. */
  seconds: number;
  /** How the token names itself in its signature check. */
  name: string;
  version: string;
}

/**
 * Read a "402" answer (its body, or its PAYMENT-REQUIRED header decoded). Throws unless it offers
 * the exact scheme for `token` on `chainId`, at no more than `most`.
 */
export function readPaymentAsk(answer: unknown, want: { chainId: bigint; token: string; most: bigint }): PaymentAsk {
  const a = (typeof answer === 'object' && answer !== null ? answer : {}) as { x402Version?: unknown; resource?: unknown; accepts?: unknown };
  if (a.x402Version !== 2 || !Array.isArray(a.accepts)) throw new Error('not a payment request of the kind expected');
  for (const one of a.accepts as Record<string, unknown>[]) {
    const extra = (one?.extra ?? {}) as Record<string, unknown>;
    if (one?.scheme !== 'exact' || one.network !== `eip155:${want.chainId}` || typeof one.asset !== 'string' || one.asset.toLowerCase() !== want.token.toLowerCase()) continue;
    if (typeof one.amount !== 'string' || !/^[0-9]{1,30}$/.test(one.amount) || typeof one.payTo !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(one.payTo)) continue;
    if (typeof extra.name !== 'string' || typeof extra.version !== 'string') continue;
    const amount = BigInt(one.amount);
    if (amount <= 0n || amount > want.most) throw new Error('the price asked is above the price expected');
    const seconds = typeof one.maxTimeoutSeconds === 'number' && one.maxTimeoutSeconds >= 30 && one.maxTimeoutSeconds <= 3600 ? Math.floor(one.maxTimeoutSeconds) : 300;
    return { resource: a.resource, accepted: one, amount, payTo: one.payTo, seconds, name: extra.name, version: extra.version };
  }
  throw new Error('no way of paying that is understood');
}

const base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/**
 * The header that pays: a permission for exactly the transfer asked, signed by `key`, good from a
 * minute ago (clocks differ) until the time the service allows runs out.
 */
export function paymentHeader(ask: PaymentAsk, pay: { from: string; chainId: bigint; token: string; key: Uint8Array; now: number; nonce: string }): string {
  const domain: TokenDomain = { name: ask.name, version: ask.version, chainId: pay.chainId, contract: pay.token };
  const signed = signAuthorization(domain, { from: pay.from, to: ask.payTo, value: ask.amount, validAfter: BigInt(pay.now - 60), validBefore: BigInt(pay.now + ask.seconds), nonce: pay.nonce }, pay.key);
  return base64(
    JSON.stringify({
      x402Version: 2,
      resource: ask.resource,
      accepted: ask.accepted,
      payload: {
        signature: `${signed.r}${signed.s.slice(2)}${signed.v.toString(16)}`,
        authorization: { from: pay.from, to: ask.payTo, value: ask.amount.toString(), validAfter: signed.validAfter.toString(), validBefore: signed.validBefore.toString(), nonce: pay.nonce },
      },
    }),
  );
}
