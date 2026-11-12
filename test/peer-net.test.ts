import { AbiCoder, Interface, id } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PEER_ESCROW, PEER_INTENT_GUARDIAN } from '../src/core/peer.ts';
import { estimateCallGas, fetchPeerOrder, fetchPeerRate, findPeerDepositIds, registerPeerPayee, waitForReceipt } from '../src/net/peer.ts';

const RPC = ['https://node.example'];
const ME = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const HASH = `0x${'ab'.repeat(32)}`;
const coder = AbiCoder.defaultAbiCoder();
const escrow = new Interface([
  'function getDeposit(uint256) view returns ((address,address,address,(uint256,uint256),bool,uint256,uint256,address,bool))',
  'function getDepositPaymentMethods(uint256) view returns (bytes32[])',
  'function getDepositCurrencies(uint256,bytes32) view returns (bytes32[])',
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Stand-in for a node: answers each JSON-RPC call with whatever `answer` returns for it. */
function node(answer: (method: string, params: any[]) => unknown) {
  const seen: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    seen.push({ url: String(url), body });
    const result = answer(body?.method, body?.params ?? []);
    return result instanceof Response ? result : json({ jsonrpc: '2.0', id: 1, result });
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('registering a payment handle', () => {
  it('sends only the method and the handle, and returns the hash', async () => {
    const seen = node(() => json({ success: true, responseObject: { hashedOnchainId: HASH.toUpperCase().replace('0X', '0x') } }));
    expect(await registerPeerPayee('revolut', 'ivan1abc')).toBe(HASH);
    expect(seen[0]?.url).toBe('https://api.zkp2p.xyz/v2/makers/create');
    expect(seen[0]?.body).toEqual({ processorName: 'revolut', offchainId: 'ivan1abc' });
  });

  it('fails loudly on a refusal or a reply that is not a real hash', async () => {
    node(() => json({ success: false, message: 'Invalid revtag' }, 400));
    await expect(registerPeerPayee('revolut', 'x')).rejects.toThrow('Invalid revtag');
    node(() => json({ success: true, responseObject: { hashedOnchainId: `0x${'00'.repeat(32)}` } }));
    await expect(registerPeerPayee('revolut', 'x')).rejects.toThrow(/Malformed/);
    node(() => json({ success: true, responseObject: { hashedOnchainId: '0x1234' } }));
    await expect(registerPeerPayee('revolut', 'x')).rejects.toThrow(/Malformed/);
    node(() => new Response('<html>', { status: 502 }));
    await expect(registerPeerPayee('revolut', 'x')).rejects.toThrow('HTTP 502');
  });
});

describe('market rate', () => {
  const answers = (rate: bigint, valid = true) => (_m: string, params: any[]) =>
    String(params[0].data).startsWith(id('validateConfig(bytes)').slice(0, 10))
      ? coder.encode(['bytes'], [`0x${'07'.repeat(22)}`])
      : coder.encode(['bool', 'uint256', 'uint256'], [valid, rate, 1790000000n]);

  it('reads the rate from the adapter', async () => {
    node(answers(895788458623875975n));
    expect(await fetchPeerRate(RPC, 'EUR')).toBe(895788458623875975n);
  });

  it('refuses a rate the adapter calls unusable or that is absurd', async () => {
    node(answers(895788458623875975n, false));
    await expect(fetchPeerRate(RPC, 'EUR')).rejects.toThrow();
    node(answers(5n));
    await expect(fetchPeerRate(RPC, 'EUR')).rejects.toThrow();
    node(answers(10n ** 21n));
    await expect(fetchPeerRate(RPC, 'EUR')).rejects.toThrow();
  });
});

describe('orders', () => {
  it('asks the indexer only for the numbers of this address in this escrow', async () => {
    const seen = node(() => json({ data: { Deposit: [{ depositId: '4913' }, { depositId: 12 }, { depositId: 'x' }, {}] } }));
    expect(await findPeerDepositIds(ME)).toEqual([4913n, 12n]);
    expect(seen[0]?.url).toBe('https://indexer.zkp2p.xyz/v1/graphql');
    expect(seen[0]?.body.variables).toEqual({ a: ME, e: PEER_ESCROW });
    node(() => json({ errors: [] }));
    await expect(findPeerDepositIds(ME)).rejects.toThrow();
  });

  const chain = (depositor: string) => (_m: string, params: any[]) => {
    const data = String(params[0].data);
    if (data.startsWith(escrow.getFunction('getDeposit')!.selector))
      return escrow.encodeFunctionResult('getDeposit', [[depositor, '0x0000000000000000000000000000000000000000', USDC, [1n, 9n], true, 200_000_000n, 44_000_000n, PEER_INTENT_GUARDIAN, false]]);
    if (data.startsWith(escrow.getFunction('getDepositPaymentMethods')!.selector)) return escrow.encodeFunctionResult('getDepositPaymentMethods', [[id('revolut')]]);
    return escrow.encodeFunctionResult('getDepositCurrencies', [[id('EUR'), id('JPY')]]);
  };

  it('reads an order from the contract', async () => {
    node(chain(ME));
    expect(await fetchPeerOrder(RPC, 7n, ME)).toEqual({ id: 7n, remaining: 200_000_000n, reserved: 44_000_000n, accepting: true, platform: 'Revolut', currencies: ['EUR'] });
  });

  it("does not show someone else's or a closed order", async () => {
    node(chain('0x0011eaa39468412f260c45397a30790e42260ded'));
    expect(await fetchPeerOrder(RPC, 7n, ME)).toBeNull();
    node(() => `0x${'00'.repeat(320)}`);
    expect(await fetchPeerOrder(RPC, 7n, ME)).toBeNull();
  });
});

describe('contract calls', () => {
  it('adds a margin to the gas estimate and passes on the reason for a failure', async () => {
    node(() => '0x88b8c');
    expect(await estimateCallGas(RPC, { from: ME, to: PEER_ESCROW, data: '0x' })).toBe((560_012n * 13n) / 10n);
    node(() => json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted: ERC20: transfer amount exceeds allowance' } }));
    await expect(estimateCallGas(RPC, { from: ME, to: PEER_ESCROW, data: '0x' })).rejects.toThrow(/exceeds allowance/);
    node(() => '0xffffffffff');
    await expect(estimateCallGas(RPC, { from: ME, to: PEER_ESCROW, data: '0x' })).rejects.toThrow(/out of range/);
  });

  it('waits for a receipt and reports a rejected transaction', async () => {
    let calls = 0;
    node(() => (++calls < 2 ? json({ jsonrpc: '2.0', id: 1, result: null }) : { status: '0x0', logs: [] }));
    expect(await waitForReceipt(RPC, HASH)).toEqual({ ok: false, logs: [] });
    expect(calls).toBe(2);
  }, 10_000);
});
