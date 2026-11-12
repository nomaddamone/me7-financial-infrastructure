import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastTron,
  estimateTrc20Energy,
  fetchTrc20Balance,
  fetchTronAccount,
  fetchTronBlock,
  fetchTronFeeRates,
  fetchTronResources,
} from '../src/net/tron.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OWNER = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const TO = 'TQGfKPHs3AwiBT44ibkCU64u1G4ttojUXU';
const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TXID = 'ab'.repeat(32);
const sentBody = (mock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((mock.mock.calls[call] as unknown as [string, { body: string }])[1].body);

afterEach(() => vi.unstubAllGlobals());

describe('Tron node calls', () => {
  it('reads an account and recognises a never-used address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ address: OWNER, balance: 62026125191 })));
    expect(await fetchTronAccount(['https://t1'], OWNER)).toEqual({ exists: true, balance: 62026125191n });
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    expect(await fetchTronAccount(['https://t1'], TO)).toEqual({ exists: false, balance: 0n });
    vi.stubGlobal('fetch', vi.fn(async () => json({ address: OWNER })));
    expect((await fetchTronAccount(['https://t1'], OWNER)).balance).toBe(0n);
  });

  it('reads a token balance with the right call', async () => {
    const mock = vi.fn(async () => json({ result: { result: true }, constant_result: ['0'.repeat(58) + '2625a0'] }));
    vi.stubGlobal('fetch', mock);
    expect(await fetchTrc20Balance(['https://t1'], USDT, OWNER)).toBe(2_500_000n);
    expect(sentBody(mock)).toEqual({
      owner_address: OWNER,
      contract_address: USDT,
      function_selector: 'balanceOf(address)',
      parameter: '000000000000000000000000c8599111f29c1e1e061265b4af93ea1f274ad78a',
      visible: true,
    });
  });

  it('estimates energy by simulating the transfer and rejects a failed simulation', async () => {
    const mock = vi.fn(async () => json({ result: { result: true }, energy_used: 14650, constant_result: ['0'.repeat(64)] }));
    vi.stubGlobal('fetch', mock);
    expect(await estimateTrc20Energy(['https://t1'], USDT, OWNER, TO, 2_500_000n)).toBe(14650n);
    expect(sentBody(mock).parameter).toBe(
      '0000000000000000000000009cdeccbed8527dca387ee1116bc3915de88d714a00000000000000000000000000000000000000000000000000000000002625a0',
    );
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: { result: false, message: 'REVERT' } })));
    await expect(estimateTrc20Energy(['https://t1'], USDT, OWNER, TO, 1n)).rejects.toThrow();
  });

  it('reads the newest block', async () => {
    const id = '000000000453b503549cc830c37f6c98485584c222217338798fc699c0038c3d';
    vi.stubGlobal('fetch', vi.fn(async () => json({ blockID: id, block_header: { raw_data: { number: 72594691, timestamp: 1794323364000 } } })));
    expect(await fetchTronBlock(['https://t1'])).toEqual({ id, timestamp: 1794323364000 });
    vi.stubGlobal('fetch', vi.fn(async () => json({ blockID: 'nope' })));
    await expect(fetchTronBlock(['https://t1'])).rejects.toThrow();
  });

  it('reads fee rates and refuses absurd ones', async () => {
    const params = (energy: number) => ({
      chainParameter: [
        { key: 'getTransactionFee', value: 1000 },
        { key: 'getEnergyFee', value: energy },
        { key: 'getCreateAccountFee', value: 100000 },
        { key: 'getCreateNewAccountFeeInSystemContract', value: 1000000 },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async () => json(params(100))));
    expect(await fetchTronFeeRates(['https://t1'])).toEqual({ perByte: 1000n, perEnergy: 100n, newAccount: 1_100_000n });
    vi.stubGlobal('fetch', vi.fn(async () => json(params(10_000_000))));
    await expect(fetchTronFeeRates(['https://t1'])).rejects.toThrow();
  });

  it('works out what the account can still do for free', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ freeNetLimit: 600, freeNetUsed: 250, EnergyLimit: 50000, EnergyUsed: 20000 })));
    expect(await fetchTronResources(['https://t1'], OWNER)).toEqual({ bandwidth: 350n, energy: 30000n });
    vi.stubGlobal('fetch', vi.fn(async () => json({ freeNetLimit: 600, freeNetUsed: 700 })));
    expect(await fetchTronResources(['https://t1'], OWNER)).toEqual({ bandwidth: 0n, energy: 0n });
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    expect(await fetchTronResources(['https://t1'], OWNER)).toEqual({ bandwidth: 0n, energy: 0n });
  });

  it('broadcasts, decodes rejections and tolerates a repeated send', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: true, txid: TXID })));
    expect(await broadcastTron(['https://t1'], '0a00', TXID)).toBe(TXID);
    const reason = Buffer.from('Validate TransferContract error, balance is not sufficient.').toString('hex');
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'CONTRACT_VALIDATE_ERROR', message: reason })));
    await expect(broadcastTron(['https://t1'], '0a00', TXID)).rejects.toThrow(/CONTRACT_VALIDATE_ERROR: Validate TransferContract error, balance is not sufficient/);
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'DUP_TRANSACTION_ERROR', message: '' })));
    expect(await broadcastTron(['https://t1'], '0a00', TXID)).toBe(TXID);
  });
});
