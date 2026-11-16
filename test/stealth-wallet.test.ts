import { Interface } from 'ethers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signWithAddresses } from '../src/app/addresses.ts';
import { STEALTH_INDEX, stealthFinds, stealthKeyAt, syncStealth } from '../src/app/stealth.ts';
import { openWallet } from '../src/app/wallet.ts';
import { evmAddressFromPrivateKey } from '../src/core/evm.ts';
import { authorizationSigner, type TokenDomain } from '../src/core/gasless.ts';
import { STEALTH_ANNOUNCER, stealthAddressFor, stealthKeys, tokenMetadata } from '../src/core/stealth.ts';
import { GASLESS, NETWORKS } from '../src/net/endpoints.ts';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const base = NETWORKS.mainnet.base!;
const DOMAIN: TokenDomain = { ...GASLESS.domain, chainId: base.chainId, contract: base.usdc };
const iface = new Interface(['event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)']);
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** A note on the chain for a payment to this wallet's stealth code. */
function noteFor(seed: Uint8Array, salt: number, block: number) {
  const paid = stealthAddressFor(stealthKeys(seed), new Uint8Array(32).fill(salt));
  const log = iface.encodeEventLog('Announcement', [1n, paid.address, STEALTH_ANNOUNCER, paid.ephemeralPubKey, tokenMetadata(paid.viewTag, base.usdc, 1_000_000n)]);
  return { address: paid.address, log: { topics: log.topics, data: log.data, blockNumber: `0x${block.toString(16)}` } };
}

/** Nodes that know the chain's height and these notes; they record which blocks were asked for. */
function nodes(head: number, logs: { blockNumber: string }[], asked: [number, number][] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)) as { method: string; params: { fromBlock: string; toBlock: string }[] };
      if (q.method === 'eth_blockNumber') return json({ jsonrpc: '2.0', id: 1, result: `0x${head.toString(16)}` });
      const from = Number(q.params[0]!.fromBlock);
      const to = Number(q.params[0]!.toBlock);
      asked.push([from, to]);
      return json({ jsonrpc: '2.0', id: 1, result: logs.filter((l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to) });
    }),
  );
  return asked;
}

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the wallet's stealth payments", () => {
  it('finds them, remembers them, and goes on from where it stopped', async () => {
    const wallet = openWallet(MNEMONIC, 'one');
    const a = noteFor(wallet.seed, 1, 58_000_010);
    const b = noteFor(wallet.seed, 2, 58_000_020);
    const again = noteFor(wallet.seed, 1, 58_000_030); // the same address announced a second time
    const asked = nodes(58_000_025, [a.log, b.log, again.log]);

    expect((await syncStealth(wallet)).map((f) => f.address)).toEqual([a.address, b.address]);
    expect(asked).toEqual([[58_000_000, 58_000_025]]);
    expect(stealthFinds(wallet).map((f) => f.address)).toEqual([a.address, b.address]);

    // Within half a minute the chain is not asked again.
    await syncStealth(wallet);
    expect(asked).toHaveLength(1);

    // Later: only the new blocks are read, and an address already known is not listed twice.
    vi.setSystemTime(Date.now() + 60_000);
    nodes(58_000_040, [a.log, b.log, again.log], asked);
    expect((await syncStealth(wallet)).map((f) => f.address)).toEqual([a.address, b.address]);
    expect(asked[1]).toEqual([58_000_026, 58_000_040]);
  });

  it('keeps its place when the nodes do not answer', async () => {
    const wallet = openWallet(MNEMONIC, 'two');
    const a = noteFor(wallet.seed, 3, 58_000_005);
    nodes(58_000_010, [a.log]);
    await syncStealth(wallet);
    vi.setSystemTime(Date.now() + 60_000);
    vi.stubGlobal('fetch', vi.fn(async () => json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'down' } })));
    await expect(syncStealth(wallet)).rejects.toThrow();
    // What was found before is still there, and the place has not moved.
    expect(stealthFinds(wallet).map((f) => f.address)).toEqual([a.address]);
    expect(JSON.parse([...data.values()][0]!).scannedTo).toBe(58_000_010);
  });

  it('signs for a stealth address with that address’s own key, and for no other', async () => {
    const wallet = openWallet(MNEMONIC, 'three');
    const a = noteFor(wallet.seed, 4, 58_000_005);
    const b = noteFor(wallet.seed, 5, 58_000_006);
    nodes(58_000_010, [a.log, b.log]);
    await syncStealth(wallet);

    expect(evmAddressFromPrivateKey(stealthKeyAt(wallet, STEALTH_INDEX))).toBe(a.address);
    expect(evmAddressFromPrivateKey(stealthKeyAt(wallet, STEALTH_INDEX + 1))).toBe(b.address);
    expect(() => stealthKeyAt(wallet, STEALTH_INDEX + 2)).toThrow();

    const auth = { to: wallet.evm, value: 500_000n, validAfter: 0n, validBefore: 2_000_000_000n, nonce: `0x${'ab'.repeat(32)}` };
    const [main, first, second] = signWithAddresses(wallet, DOMAIN, [
      { index: 0, from: wallet.evm, ...auth },
      { index: STEALTH_INDEX, from: a.address, ...auth },
      { index: STEALTH_INDEX + 1, from: b.address, ...auth },
    ]);
    // What USDC's contract would compute for each permission is the address the money leaves.
    expect(authorizationSigner(DOMAIN, main!)).toBe(wallet.evm);
    expect(authorizationSigner(DOMAIN, first!)).toBe(a.address);
    expect(authorizationSigner(DOMAIN, second!)).toBe(b.address);
    // A number that points at one stealth address cannot sign for another.
    expect(() => signWithAddresses(wallet, DOMAIN, [{ index: STEALTH_INDEX, from: b.address, ...auth }])).toThrow();
  });

  it('finds nothing for a session without the seed', async () => {
    const wallet = { ...openWallet(MNEMONIC, 'four'), seed: undefined as unknown as Uint8Array };
    nodes(58_000_010, []);
    expect(await syncStealth(wallet)).toEqual([]);
    expect(() => stealthKeyAt(wallet, STEALTH_INDEX)).toThrow();
  });
});
