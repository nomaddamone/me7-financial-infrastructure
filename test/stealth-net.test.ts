import { Interface } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STEALTH_ANNOUNCER, stealthAddressFor, stealthKeys, tokenMetadata } from '../src/core/stealth.ts';
import { fetchHeadBlock, scanStealth } from '../src/net/stealth.ts';

const iface = new Interface(['event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)']);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RPC = ['https://node.one', 'https://node.two'];
const mine = stealthKeys(new Uint8Array(64).fill(7));
const theirs = stealthKeys(new Uint8Array(64).fill(8));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** A note on the chain for a payment to `keys`, in block `block`. */
function note(keys: typeof mine, seed: number, block: number, wrongAddress = false) {
  const paid = stealthAddressFor(keys, new Uint8Array(32).fill(seed));
  const log = iface.encodeEventLog('Announcement', [1n, wrongAddress ? USDC : paid.address, STEALTH_ANNOUNCER, paid.ephemeralPubKey, tokenMetadata(paid.viewTag, USDC, 5_000_000n)]);
  return { address: paid.address, log: { topics: log.topics, data: log.data, blockNumber: `0x${block.toString(16)}` } };
}

afterEach(() => vi.unstubAllGlobals());

describe('finding stealth payments', () => {
  it('keeps the notes meant for this account and no others', async () => {
    const a = note(mine, 1, 1_000);
    const b = note(mine, 2, 1_500);
    const stranger = note(theirs, 3, 1_200);
    const forged = note(mine, 4, 1_300, true); // our key, but naming another address
    const asked: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { params: unknown[] };
        asked.push(body.params[0]);
        return json({ jsonrpc: '2.0', id: 1, result: [a.log, stranger.log, forged.log, b.log, { topics: 'junk' }] });
      }),
    );
    const found = await scanStealth(RPC, mine, 900, 2_000);
    expect(found.map((f) => f.address)).toEqual([a.address, b.address]);
    expect(found.map((f) => f.block)).toEqual([1_000, 1_500]);
    expect(found[0]?.ephemeralPubKey).toMatch(/^0x0[23][0-9a-f]{64}$/);
    // The nodes are asked for everybody's notes: the question never names this account.
    expect(asked).toEqual([{ address: STEALTH_ANNOUNCER, topics: [expect.stringMatching(/^0x5f0eab80/)], fromBlock: '0x384', toBlock: '0x7d0' }]);
  });

  it('walks a long history in stretches and reports how far it has got', async () => {
    const ranges: [number, number][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const q = (JSON.parse(String(init.body)) as { params: { fromBlock: string; toBlock: string }[] }).params[0]!;
        ranges.push([Number(q.fromBlock), Number(q.toBlock)]);
        return json({ jsonrpc: '2.0', id: 1, result: [] });
      }),
    );
    const steps: number[] = [];
    await scanStealth(RPC, mine, 1, 100_000, (done) => steps.push(done));
    expect(ranges).toEqual([
      [1, 45_000],
      [45_001, 90_000],
      [90_001, 100_000],
    ]);
    expect(steps).toEqual([45_000, 90_000, 100_000]);
  });

  it('asks for less when the nodes refuse a long stretch, and gives up rather than skip blocks', async () => {
    const ranges: [number, number][] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const q = (JSON.parse(String(init.body)) as { params: { fromBlock: string; toBlock: string }[] }).params[0]!;
        const span = Number(q.toBlock) - Number(q.fromBlock) + 1;
        if (span > 12_000) return json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'exceed maximum block range' } });
        ranges.push([Number(q.fromBlock), Number(q.toBlock)]);
        return json({ jsonrpc: '2.0', id: 1, result: [] });
      }),
    );
    await scanStealth(RPC, mine, 1, 30_000);
    expect(ranges).toEqual([
      [1, 11_250],
      [11_251, 22_500],
      [22_501, 30_000],
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'down' } })));
    await expect(scanStealth(RPC, mine, 1, 30_000)).rejects.toThrow();
  });

  it('reads the height of the chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: '0x3751d6c' })));
    expect(await fetchHeadBlock(RPC)).toBe(58_006_892);
  });
});
