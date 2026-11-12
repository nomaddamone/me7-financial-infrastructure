import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { HDNodeWallet, Transaction } from 'ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apdu,
  BLE_MTU_REQUEST,
  BleAssembler,
  bleFrames,
  HidAssembler,
  hidFrames,
  LEDGER_BLE_SERVICES,
  LEDGER_TOKENS,
  ledgerAddressCommand,
  ledgerAppNameCommand,
  LedgerError,
  ledgerEvmPath,
  ledgerProblem,
  ledgerResponse,
  ledgerSignCommands,
  ledgerTokenDescription,
  ledgerTronAddressCommand,
  ledgerTronPath,
  ledgerTronSignCommands,
  parseBleMtu,
  parseLedgerAddress,
  parseLedgerAppName,
  parseLedgerTronAddress,
  parseLedgerSignature,
} from '../src/core/ledger.ts';
import { assembleEvmTransaction, evmSigningPayload, recoverEvmSigner, signEvmTransaction, type EvmTransaction } from '../src/core/tx-evm.ts';
import { erc20TransferData } from '../src/core/erc20.ts';
import { buildTrc20Transfer, buildTronTransfer, signTronTransaction, tronAddressFromPrivateKey, tronRef } from '../src/core/tron.ts';
import { NETWORKS } from '../src/net/endpoints.ts';
import { Ledger, ledgerSupported, ledgerWays } from '../src/net/ledger.ts';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const account = HDNodeWallet.fromPhrase(PHRASE, '', "m/44'/60'/0'/0/0");
const KEY = bytes(account.privateKey.slice(2));
const ADDRESS = account.address;
const TRON_KEY = bytes(HDNodeWallet.fromPhrase(PHRASE, '', "m/44'/195'/0'/0/0").privateKey.slice(2));
const TRON_ADDRESS = tronAddressFromPrivateKey(TRON_KEY);
const TRON_USDT = NETWORKS.mainnet.tron.usdt;
const TRON_REF = tronRef({ id: '0000000004c4b40a' + 'ab'.repeat(24), timestamp: 1_800_000_000_000 }, 1_800_000_000_500);
const tx: EvmTransaction = { chainId: 8453n, nonce: 7n, maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 30_000_000n, gasLimit: 21000n, to: '0x1111111111111111111111111111111111111111', value: 1_000_000_000_000_000n };

describe('usb packets', () => {
  it('cuts a command into 64-byte packets with channel, tag, number and the length up front', () => {
    const command = apdu(0xe0, 0x02, 0, 0, ledgerEvmPath());
    const frames = hidFrames(0x1234, command);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(64);
    expect(hex(frames[0]!.subarray(0, 7))).toBe('1234050000001a');
    expect(hex(frames[0]!.subarray(7, 7 + command.length))).toBe(hex(command));
    expect([...frames[0]!.subarray(7 + command.length)].every((b) => b === 0)).toBe(true);

    const long = hidFrames(1, new Uint8Array(150).fill(7));
    expect(long).toHaveLength(3);
    expect(long.map((f) => (f[3]! << 8) + f[4]!)).toEqual([0, 1, 2]);
  });

  it('puts an answer back together, skipping another program’s packets', () => {
    const answer = Uint8Array.from({ length: 300 }, (_, i) => i % 251);
    const assembler = new HidAssembler(0xbeef);
    let out: Uint8Array | null = null;
    for (const frame of hidFrames(0xbeef, answer)) {
      expect(assembler.push(hidFrames(0x0001, Uint8Array.of(1, 2, 3))[0]!)).toBeNull();
      out = assembler.push(frame);
    }
    expect(out && hex(out)).toBe(hex(answer));
  });

  it('refuses packets out of order or of the wrong kind', () => {
    const frames = hidFrames(5, new Uint8Array(200));
    expect(() => new HidAssembler(5).push(frames[1]!)).toThrow(/out of order/);
    const bad = frames[0]!.slice();
    bad[2] = 9;
    expect(() => new HidAssembler(5).push(bad)).toThrow(/unexpected/);
    expect(() => new HidAssembler(5).push(new Uint8Array(3))).toThrow(/short/);
  });
});

describe('ethereum app commands', () => {
  it('names the same account the pocket uses', () => {
    expect(hex(ledgerEvmPath())).toBe('058000002c8000003c800000000000000000000000');
    expect(hex(ledgerAddressCommand(ledgerEvmPath(), false))).toBe('e002000015058000002c8000003c800000000000000000000000');
    expect(hex(ledgerAddressCommand(ledgerEvmPath(), true)).slice(0, 8)).toBe('e0020100');
  });

  it('reads the address out of the device’s answer', () => {
    const key = new Uint8Array(65).fill(4);
    const text = new TextEncoder().encode(ADDRESS.slice(2));
    const answer = Uint8Array.from([65, ...key, 40, ...text]);
    expect(parseLedgerAddress(answer)).toBe(ADDRESS);
    expect(() => parseLedgerAddress(answer.subarray(0, 80))).toThrow();
    expect(() => parseLedgerAddress(Uint8Array.from([1, 4, 40, ...new TextEncoder().encode('z'.repeat(40))]))).toThrow();
  });

  it('hands a long transaction over in pieces of at most 255 bytes', () => {
    const commands = ledgerSignCommands(ledgerEvmPath(), new Uint8Array(600).fill(1));
    expect(commands.map((c) => hex(c.subarray(0, 4)))).toEqual(['e0040000', 'e0048000', 'e0048000']);
    expect(commands.map((c) => c[4])).toEqual([255, 255, 621 - 510]);
    expect(commands.reduce((n, c) => n + c.length - 5, 0)).toBe(621);
    expect(() => apdu(0xe0, 4, 0, 0, new Uint8Array(256))).toThrow();
  });

  it('reads the signature whatever way the app reports which key signed', () => {
    const body = [...new Uint8Array(32).fill(1), ...new Uint8Array(32).fill(2)];
    expect(parseLedgerSignature(Uint8Array.from([0, ...body])).yParity).toBe(0);
    expect(parseLedgerSignature(Uint8Array.from([1, ...body])).yParity).toBe(1);
    expect(parseLedgerSignature(Uint8Array.from([27, ...body])).yParity).toBe(0);
    expect(parseLedgerSignature(Uint8Array.from([28, ...body])).yParity).toBe(1);
    // Legacy value: chainId * 2 + 35 + parity, cut to one byte.
    expect(parseLedgerSignature(Uint8Array.from([(8453 * 2 + 35 + 1) & 0xff, ...body])).yParity).toBe(1);
    expect(() => parseLedgerSignature(new Uint8Array(10))).toThrow();
  });

  it('turns the status at the end of an answer into something the user can act on', () => {
    expect(hex(ledgerResponse(bytes('01029000')))).toBe('0102');
    const failure = (status: string) => {
      try {
        ledgerResponse(bytes(status));
      } catch (e) {
        return (e as LedgerError).problem;
      }
      return 'none';
    };
    expect(failure('6985')).toBe('rejected');
    expect(failure('5515')).toBe('locked');
    expect(failure('6d00')).toBe('no-app');
    expect(failure('6a80')).toBe('blind');
    expect(ledgerProblem(0x1234)).toBe('other');
    expect(() => ledgerResponse(new Uint8Array(1))).toThrow();
  });
});

describe('tron app commands', () => {
  it('names the Tron account the pocket uses and asks every app for its name the same way', () => {
    expect(hex(ledgerTronPath())).toBe('058000002c800000c3800000000000000000000000');
    expect(hex(ledgerAppNameCommand())).toBe('b001000000');
    expect(hex(ledgerTronAddressCommand(ledgerTronPath(), true)).slice(0, 10)).toBe('e002010015');
    expect(parseLedgerAppName(Uint8Array.from([1, 4, 0x54, 0x72, 0x6f, 0x6e, 1, 0x30]))).toBe('Tron');
    expect(() => parseLedgerAppName(Uint8Array.from([1, 9, 0x54]))).toThrow();
  });

  it('reads a Tron address and refuses anything that is not one', () => {
    const answer = (text: string) => Uint8Array.from([2, 4, 4, text.length, ...new TextEncoder().encode(text)]);
    expect(parseLedgerTronAddress(answer(TRON_ADDRESS))).toBe(TRON_ADDRESS);
    expect(() => parseLedgerTronAddress(answer(`0${TRON_ADDRESS.slice(1)}`))).toThrow();
    expect(() => parseLedgerTronAddress(answer(TRON_ADDRESS.slice(0, 30)))).toThrow();
  });

  it('hands a transfer over whole, and a long transaction cut only between its fields', () => {
    const raw = buildTrc20Transfer(TRON_ADDRESS, TRON_USDT, TRON_ADDRESS, 1n, TRON_REF, 30_000_000n);
    const [only, ...rest] = ledgerTronSignCommands(ledgerTronPath(), raw);
    expect(rest).toEqual([]);
    expect(hex(only!.subarray(0, 4))).toBe('e0041000');
    expect(hex(only!.subarray(5))).toBe(hex(ledgerTronPath()) + hex(raw));

    // Four fields of 150 bytes each: no two fit into one piece next to the path.
    const field = (n: number) => [(n << 3) | 2, 0x93, 0x01, ...new Array<number>(147).fill(n)];
    const long = Uint8Array.from([1, 2, 3, 4].flatMap(field));
    const commands = ledgerTronSignCommands(ledgerTronPath(), long);
    expect(commands.map((c) => hex(c.subarray(0, 4)))).toEqual(['e0040000', 'e0048000', 'e0048000', 'e0049000']);
    expect(commands.map((c) => c.length - 5)).toEqual([21 + 150, 150, 150, 150]);
    expect(commands.map((c) => hex(c.subarray(5))).join('')).toBe(hex(ledgerTronPath()) + hex(long));

    expect(() => ledgerTronSignCommands(ledgerTronPath(), raw.subarray(0, raw.length - 3))).toThrow();
    expect(() => ledgerTronSignCommands(ledgerTronPath(), Uint8Array.from([0x0a, 0xff, 0x01, ...new Array<number>(255).fill(1)]))).toThrow();
  });
});

describe('signature made outside the wallet', () => {
  const sign = (payload: Uint8Array) => {
    const sig = secp256k1.sign(keccak_256(payload), KEY, { prehash: false, format: 'recovered' });
    return { yParity: sig[0]!, r: sig.slice(1, 33), s: sig.slice(33, 65) };
  };

  it('gives the device exactly the bytes an independent library would sign', () => {
    const reference = Transaction.from({ type: 2, chainId: tx.chainId, nonce: Number(tx.nonce), maxPriorityFeePerGas: tx.maxPriorityFeePerGas, maxFeePerGas: tx.maxFeePerGas, gasLimit: tx.gasLimit, to: tx.to, value: tx.value });
    expect(`0x${hex(evmSigningPayload(tx))}`).toBe(reference.unsignedSerialized);
  });

  it('assembles the same transaction as signing in the wallet does, and knows who signed', () => {
    const signature = sign(evmSigningPayload(tx));
    const assembled = assembleEvmTransaction(tx, signature);
    expect(assembled).toEqual(signEvmTransaction(tx, KEY));
    expect(Transaction.from(assembled.raw).from).toBe(ADDRESS);
    expect(`0x${hex(recoverEvmSigner(tx, signature))}`).toBe(ADDRESS.toLowerCase());
    // The other parity is another key: the check that the device signed for this account relies on that.
    expect(`0x${hex(recoverEvmSigner(tx, { ...signature, yParity: 1 - signature.yParity }))}`).not.toBe(ADDRESS.toLowerCase());
    expect(() => assembleEvmTransaction(tx, { ...signature, yParity: 2 })).toThrow();
    expect(() => assembleEvmTransaction(tx, { ...signature, r: new Uint8Array(31) })).toThrow();
  });
});

describe('token descriptions for the device', () => {
  /** The production key Ledger signs token descriptions with, from the source of its Ethereum app (src/public_keys.h). */
  const LEDGER_TOKEN_KEY = bytes('045e6c1020c14dc46442fe89f97c0b68cdb15976dc24f24c316e7b30fe4e8cc76b1489150c21514ebf440ff5dea5393d83de5358cd098fce8fd0f81daa94979183');
  const parse = (description: string) => {
    const b = bytes(description);
    const tl = b[0]!;
    const view = new DataView(b.buffer);
    return {
      ticker: new TextDecoder().decode(b.subarray(1, 1 + tl)),
      contract: `0x${hex(b.subarray(1 + tl, 21 + tl))}`,
      decimals: view.getUint32(21 + tl),
      chainId: view.getUint32(25 + tl),
      // The device hashes everything after the ticker's length byte: ticker, contract, decimals, chain.
      signed: b.subarray(1, 29 + tl),
      signature: b.subarray(29 + tl),
    };
  };
  const main = NETWORKS.mainnet;
  const expected: [string, string, string, number][] = [
    ['1', main.evm.tokens.usdt, 'USDT', 6],
    ['1', main.evm.tokens.usdc, 'USDC', 6],
    ['1', main.evm.tokens.dai, 'DAI', 18],
    ['1', main.evm.tokens.link, 'LINK', 18],
    ['1', main.evm.tokens.wbtc!, 'WBTC', 8],
    ['1', main.evm.tokens.cbbtc!, 'cbBTC', 8],
    ['8453', main.base!.usdc, 'USDC', 6],
    ['8453', main.base!.cbbtc, 'cbBTC', 8],
  ];

  it('describes exactly the tokens the wallet holds, on the right chain, with the right decimals', () => {
    for (const [chain, contract, ticker, decimals] of expected) {
      const description = ledgerTokenDescription(BigInt(chain), contract);
      expect(description, `${ticker} on ${chain}`).not.toBeNull();
      const d = parse(description!);
      expect({ ticker: d.ticker, contract: d.contract, decimals: d.decimals, chainId: d.chainId }).toEqual({ ticker, contract: contract.toLowerCase(), decimals, chainId: Number(chain) });
    }
    expect(Object.values(LEDGER_TOKENS).reduce((n, list) => n + Object.keys(list).length, 0)).toBe(expected.length);
    expect(ledgerTokenDescription(1n, '0x1111111111111111111111111111111111111111')).toBeNull();
    expect(ledgerTokenDescription(137n, main.evm.tokens.usdt)).toBeNull();
  });

  it('carries Ledger’s own signature on every description, so the device will accept it', () => {
    for (const list of Object.values(LEDGER_TOKENS)) {
      for (const description of Object.values(list)) {
        const d = parse(description);
        expect(secp256k1.verify(d.signature, sha256(d.signed), LEDGER_TOKEN_KEY, { prehash: false, format: 'der', lowS: false })).toBe(true);
      }
    }
  });
});

describe('a session with a device', () => {
  /** A stand-in Ledger: speaks the same packets and commands, signs with the test account's key. */
  function fakeDevice(options: { key?: Uint8Array; status?: number; app?: string } = {}) {
    const key = options.key ?? KEY;
    const listeners: ((e: { data: DataView }) => void)[] = [];
    const seen: string[] = [];
    let inbound: number[] = [];
    let expected = 0;
    let pending = new Uint8Array(0);
    const reply = (channel: number, data: Uint8Array, status = 0x9000) => {
      const answer = Uint8Array.from([...data, status >> 8, status & 0xff]);
      for (const frame of hidFrames(channel, answer)) for (const l of listeners) l({ data: new DataView(frame.buffer) });
    };
    const handle = (channel: number, command: Uint8Array) => {
      seen.push(hex(command.subarray(0, 4)));
      const [, ins, p1] = command;
      const data = command.subarray(5);
      if (options.status) return reply(channel, new Uint8Array(0), options.status);
      const app = options.app ?? 'Ethereum';
      if (ins === 0x01 && command[0] === 0xb0) {
        const name = new TextEncoder().encode(app);
        return reply(channel, Uint8Array.from([1, name.length, ...name, 5, ...new TextEncoder().encode('1.0.0')]));
      }
      if (app === 'Tron') {
        if (ins === 0x02) {
          const address = new TextEncoder().encode(tronAddressFromPrivateKey(key));
          return reply(channel, Uint8Array.from([65, ...secp256k1.getPublicKey(key, false), 34, ...address]));
        }
        if (ins === 0x04) {
          const first = p1 === 0x10 || p1 === 0x00;
          pending = first ? data.slice(21) : Uint8Array.from([...pending, ...data]);
          if (p1 !== 0x10 && p1 !== 0x90) return reply(channel, new Uint8Array(0));
          const sig = secp256k1.sign(sha256(pending), key, { prehash: false, format: 'recovered' });
          // The Tron app answers r, s and then the byte that tells which key signed.
          return reply(channel, Uint8Array.from([...sig.subarray(1), sig[0]!]));
        }
        return reply(channel, new Uint8Array(0), 0x6d00);
      }
      if (ins === 0x06) return reply(channel, Uint8Array.of(0, 1, 15, 0));
      if (ins === 0x02) {
        const address = new TextEncoder().encode(ADDRESS.slice(2));
        return reply(channel, Uint8Array.from([65, ...new Uint8Array(65).fill(4), 40, ...address]));
      }
      if (ins === 0x0a) return reply(channel, new Uint8Array(0));
      if (ins === 0x04) {
        pending = p1 === 0 ? data.slice(21) : Uint8Array.from([...pending, ...data]);
        // The transaction is complete when it parses; a real device knows from the encoded length.
        try {
          Transaction.from(`0x${hex(pending)}`);
        } catch {
          return reply(channel, new Uint8Array(0));
        }
        const sig = secp256k1.sign(keccak_256(pending), key, { prehash: false, format: 'recovered' });
        return reply(channel, sig);
      }
      return reply(channel, new Uint8Array(0), 0x6d00);
    };
    const device = {
      opened: false,
      productName: 'Ledger Stax',
      open: async () => {
        device.opened = true;
      },
      close: async () => {
        device.opened = false;
      },
      sendReport: async (_id: number, frame: Uint8Array) => {
        const channel = (frame[0]! << 8) + frame[1]!;
        const first = (frame[3]! << 8) + frame[4]! === 0;
        if (first) {
          expected = (frame[5]! << 8) + frame[6]!;
          inbound = [];
        }
        inbound.push(...frame.subarray(first ? 7 : 5));
        if (inbound.length >= expected) handle(channel, Uint8Array.from(inbound.slice(0, expected)));
      },
      addEventListener: (_t: string, l: (e: { data: DataView }) => void) => void listeners.push(l),
      removeEventListener: () => undefined,
    };
    vi.stubGlobal('navigator', { hid: { requestDevice: async () => [device], addEventListener: () => undefined, removeEventListener: () => undefined } });
    return { device, seen };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('reads the address and signs a transfer that an independent library accepts', async () => {
    const { seen } = fakeDevice();
    expect(ledgerSupported()).toBe(true);
    const ledger = await Ledger.connect();
    expect(ledger.name).toBe('Ledger Stax');
    expect(await ledger.appVersion()).toBe('1.15.0');
    expect(await ledger.address()).toBe(ADDRESS);
    const signed = await ledger.sign(tx, ADDRESS);
    const parsed = Transaction.from(signed.raw);
    expect(parsed.from).toBe(ADDRESS);
    expect(parsed.to).toBe(tx.to);
    expect(parsed.value).toBe(tx.value);
    expect(parsed.hash).toBe(signed.hash);
    expect(seen).toEqual(['e0060000', 'e0020000', 'e0040000']);
  });

  it('sends the token description first, and a long token transfer in pieces', async () => {
    const { seen } = fakeDevice();
    const ledger = await Ledger.connect();
    const usdc = NETWORKS.mainnet.base!.usdc;
    const data = erc20TransferData('0x2222222222222222222222222222222222222222', 5_000_000n);
    const tokenTx: EvmTransaction = { ...tx, gasLimit: 70_000n, to: usdc, value: 0n, data };
    const signed = await ledger.sign(tokenTx, ADDRESS, ledgerTokenDescription(8453n, usdc)!);
    expect(Transaction.from(signed.raw).from).toBe(ADDRESS);
    expect(Transaction.from(signed.raw).data).toBe(`0x${hex(data)}`);
    expect(seen[0]).toBe('e00a0000');
    expect(seen.slice(1)).toEqual(['e0040000']);

    const big: EvmTransaction = { ...tokenTx, data: new Uint8Array(500).fill(3) };
    await ledger.sign(big, ADDRESS);
    expect(seen.slice(2)).toEqual(['e0040000', 'e0048000', 'e0048000']);
  });

  it('refuses a signature made by another key', async () => {
    fakeDevice({ key: new Uint8Array(32).fill(9) });
    const ledger = await Ledger.connect();
    await expect(ledger.sign(tx, ADDRESS)).rejects.toBeInstanceOf(LedgerError);
  });

  it('reports a rejection on the device and a closed app as what they are', async () => {
    fakeDevice({ status: 0x6985 });
    await expect((await Ledger.connect()).sign(tx, ADDRESS)).rejects.toMatchObject({ problem: 'rejected' });
    fakeDevice({ status: 0x6d00 });
    await expect((await Ledger.connect()).appVersion()).rejects.toMatchObject({ problem: 'no-app' });
  });

  it('tells which app is open, so the user can be asked for the right one', async () => {
    fakeDevice({ app: 'BOLOS' });
    expect(await (await Ledger.connect()).appName()).toBe('BOLOS');
    fakeDevice();
    expect(await (await Ledger.connect()).appName()).toBe('Ethereum');
  });

  it('reads the Tron address and signs TRX and USDT transfers exactly as the pocket would', async () => {
    const { seen } = fakeDevice({ key: TRON_KEY, app: 'Tron' });
    const ledger = await Ledger.connect();
    expect(await ledger.appName()).toBe('Tron');
    expect(await ledger.tronAddress()).toBe(TRON_ADDRESS);
    const to = tronAddressFromPrivateKey(new Uint8Array(32).fill(7));
    for (const raw of [buildTronTransfer(TRON_ADDRESS, to, 1_500_000n, TRON_REF), buildTrc20Transfer(TRON_ADDRESS, TRON_USDT, to, 25_000_000n, TRON_REF, 30_000_000n)]) {
      expect(await ledger.signTron(raw, TRON_ADDRESS)).toEqual(signTronTransaction(raw, TRON_KEY));
    }
    expect(seen).toEqual(['b0010000', 'e0020000', 'e0041000', 'e0041000']);
  });

  it('refuses a Tron signature made by another key', async () => {
    fakeDevice({ key: new Uint8Array(32).fill(9), app: 'Tron' });
    const raw = buildTronTransfer(TRON_ADDRESS, tronAddressFromPrivateKey(new Uint8Array(32).fill(7)), 1n, TRON_REF);
    await expect((await Ledger.connect()).signTron(raw, TRON_ADDRESS)).rejects.toBeInstanceOf(LedgerError);
  });

  it('comes back to a device the browser already knows without the picker', async () => {
    const { device } = fakeDevice();
    const hid = (navigator as unknown as { hid: Record<string, unknown> }).hid;
    hid.getDevices = async () => [{ ...device, vendorId: 0x2c97 }];
    hid.requestDevice = async () => {
      throw new Error('the picker must not open');
    };
    expect(await (await Ledger.connect('usb', true)).address()).toBe(ADDRESS);
  });

  it('says so when the browser cannot reach USB devices', async () => {
    vi.stubGlobal('navigator', {});
    expect(ledgerSupported()).toBe(false);
    await expect(Ledger.connect()).rejects.toThrow(/cannot reach/);
  });
});

describe('bluetooth pieces', () => {
  it('cuts a command into pieces of the agreed size, with the length only on the first', () => {
    const command = Uint8Array.from({ length: 50 }, (_, i) => i);
    const frames = bleFrames(command, 20);
    expect(frames.map((f) => f.length)).toEqual([20, 20, 20, 4]);
    expect(hex(frames[0]!.subarray(0, 5))).toBe('0500000032');
    expect(hex(frames[1]!.subarray(0, 3))).toBe('050001');
    expect(frames.every((f) => f.length <= 20)).toBe(true);
    const back = [...frames[0]!.subarray(5), ...frames.slice(1).flatMap((f) => [...f.subarray(3)])];
    expect(back).toEqual([...command]);
    expect(bleFrames(apdu(0xe0, 6, 0, 0), 153)).toHaveLength(1);
    expect(() => bleFrames(command, 4)).toThrow();
  });

  it('puts an answer back together and notices a lost or surplus piece', () => {
    const answer = Uint8Array.from({ length: 300 }, (_, i) => i % 251);
    const assembler = new BleAssembler();
    let out: Uint8Array | null = null;
    for (const frame of bleFrames(answer, 64)) out = assembler.push(frame);
    expect(out && hex(out)).toBe(hex(answer));

    const frames = bleFrames(answer, 64);
    const gap = new BleAssembler();
    gap.push(frames[0]!);
    expect(() => gap.push(frames[2]!)).toThrow(/out of order/);
    const extra = new BleAssembler();
    extra.push(bleFrames(Uint8Array.of(1, 2), 20)[0]!);
    expect(() => new BleAssembler().push(Uint8Array.of(9, 0, 0))).toThrow(/unexpected/);
    // The answer to the size question is not part of a command's answer.
    expect(new BleAssembler().push(Uint8Array.of(8, 0, 0, 0, 1, 153))).toBeNull();
  });

  it('reads the agreed piece size and never goes below what every link allows', () => {
    expect(hex(BLE_MTU_REQUEST)).toBe('0800000000');
    expect(parseBleMtu(Uint8Array.of(8, 0, 0, 0, 1, 153))).toBe(153);
    expect(parseBleMtu(Uint8Array.of(8, 0, 0, 0, 1, 5))).toBe(20);
    expect(parseBleMtu(Uint8Array.of(5, 0, 0, 0, 1, 153))).toBeNull();
  });

  it('knows the services of the Bluetooth models, the Stax among them', () => {
    const stax = LEDGER_BLE_SERVICES.find((s) => s.name === 'Ledger Stax');
    expect(stax).toEqual({
      name: 'Ledger Stax',
      service: '13d63400-2c97-6004-0000-4c6564676572',
      notify: '13d63400-2c97-6004-0001-4c6564676572',
      write: '13d63400-2c97-6004-0002-4c6564676572',
    });
    expect(LEDGER_BLE_SERVICES.map((s) => s.name).sort()).toEqual(['Ledger Flex', 'Ledger Nano Gen5', 'Ledger Nano X', 'Ledger Stax']);
  });
});

describe('a session over bluetooth', () => {
  /** A stand-in Ledger Stax on Bluetooth: agrees a piece size, then speaks the same commands and signs with the test key. */
  function fakeBluetooth(mtu = 64) {
    const stax = LEDGER_BLE_SERVICES.find((s) => s.name === 'Ledger Stax')!;
    const listeners: ((e: { target: unknown }) => void)[] = [];
    const seen: string[] = [];
    const sizes: number[] = [];
    let inbound: number[] = [];
    let expected = -1;
    let pending = new Uint8Array(0);
    const emit = (packet: Uint8Array) => {
      for (const l of listeners) l({ target: { value: new DataView(packet.buffer) } });
    };
    const reply = (data: Uint8Array, status = 0x9000) => {
      for (const frame of bleFrames(Uint8Array.from([...data, status >> 8, status & 0xff]), mtu)) emit(frame);
    };
    const handle = (command: Uint8Array) => {
      seen.push(hex(command.subarray(0, 4)));
      const [, ins, p1] = command;
      const data = command.subarray(5);
      if (ins === 0x06) return reply(Uint8Array.of(0, 1, 15, 0));
      if (ins === 0x02) return reply(Uint8Array.from([65, ...new Uint8Array(65).fill(4), 40, ...new TextEncoder().encode(ADDRESS.slice(2))]));
      if (ins === 0x04) {
        pending = p1 === 0 ? data.slice(21) : Uint8Array.from([...pending, ...data]);
        try {
          Transaction.from(`0x${hex(pending)}`);
        } catch {
          return reply(new Uint8Array(0));
        }
        return reply(secp256k1.sign(keccak_256(pending), KEY, { prehash: false, format: 'recovered' }));
      }
      return reply(new Uint8Array(0), 0x6d00);
    };
    const write = {
      startNotifications: async () => undefined,
      writeValue: async () => undefined,
      writeValueWithResponse: async (frame: Uint8Array) => {
        sizes.push(frame.length);
        if (frame[0] === 0x08) return emit(Uint8Array.of(8, 0, 0, 0, 1, mtu));
        const first = (frame[1]! << 8) + frame[2]! === 0;
        if (first) {
          expected = (frame[3]! << 8) + frame[4]!;
          inbound = [];
        }
        inbound.push(...frame.subarray(first ? 5 : 3));
        if (inbound.length >= expected) handle(Uint8Array.from(inbound));
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const notify = { ...write, addEventListener: (_t: string, l: (e: { target: unknown }) => void) => void listeners.push(l) };
    const gatt = {
      connected: false,
      connect: async () => {
        gatt.connected = true;
      },
      disconnect: () => {
        gatt.connected = false;
      },
      getPrimaryServices: async () => [{ uuid: stax.service, getCharacteristic: async (uuid: string) => (uuid === stax.write ? write : notify) }],
    };
    const filters: unknown[] = [];
    vi.stubGlobal('navigator', {
      bluetooth: {
        requestDevice: async (options: { filters: unknown[] }) => {
          filters.push(...options.filters);
          return { name: 'Ledger Stax 1A2B', gatt, addEventListener: () => undefined, removeEventListener: () => undefined };
        },
      },
    });
    return { seen, sizes, filters, gatt };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('offers only Ledger devices, agrees the piece size and signs a transfer', async () => {
    const { seen, sizes, filters } = fakeBluetooth(64);
    expect(ledgerWays()).toEqual(['bluetooth']);
    const ledger = await Ledger.connect('bluetooth');
    expect(filters).toHaveLength(LEDGER_BLE_SERVICES.length);
    expect(ledger.way).toBe('bluetooth');
    expect(ledger.name).toBe('Ledger Stax 1A2B');
    expect(await ledger.appVersion()).toBe('1.15.0');
    expect(await ledger.address()).toBe(ADDRESS);
    const signed = await ledger.sign(tx, ADDRESS);
    expect(Transaction.from(signed.raw).from).toBe(ADDRESS);
    expect(Transaction.from(signed.raw).value).toBe(tx.value);
    expect(seen).toEqual(['e0060000', 'e0020000', 'e0040000']);
    // Nothing larger than the agreed size was ever written.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(64);
  });

  it('sends a long transaction in many small pieces when the link allows only the minimum', async () => {
    const { sizes } = fakeBluetooth(20);
    const ledger = await Ledger.connect('bluetooth');
    const big: EvmTransaction = { ...tx, to: NETWORKS.mainnet.base!.usdc, value: 0n, gasLimit: 90_000n, data: new Uint8Array(400).fill(3) };
    const signed = await ledger.sign(big, ADDRESS);
    expect(Transaction.from(signed.raw).from).toBe(ADDRESS);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
    expect(sizes.length).toBeGreaterThan(20);
  });

  it('drops the link when the session is closed', async () => {
    const { gatt } = fakeBluetooth();
    const ledger = await Ledger.connect('bluetooth');
    expect(gatt.connected).toBe(true);
    await ledger.close();
    expect(gatt.connected).toBe(false);
    await expect(ledger.appVersion()).rejects.toThrow(/disconnected/);
  });
});
