import { describe, expect, it } from 'vitest';
import { buildEthGasPair, ethGasNeed, readEthGasTerms, readSignedTokenTransfer, type EthGasLimits } from '../src/core/ethgas.ts';
import { evmAddressFromPrivateKey } from '../src/core/evm.ts';
import { readSignedEvmTransaction, rlpDecode, rlpEncode, signEvmTransaction } from '../src/core/tx-evm.ts';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const ME = evmAddressFromPrivateKey(KEY);
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TO = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const RECEIVER = '0x7f054A2016C9ceC7Cd5c4A2D21E650a2767AF737';
const LIMITS: EthGasLimits = { service: 1_000_000n, maxFee: 20_000_000n, receiver: RECEIVER, maxGasPrice: 60_000_000_000n, maxGas: 150_000n };
const wire = { nonce: '7', maxFeePerGas: '300000000', maxPriorityFeePerGas: '1000000', gasMain: '70000', gasFee: '60000', fee: '1250000', receiver: RECEIVER };

describe('reading RLP and signed transactions back', () => {
  it('reads what it wrote', () => {
    const item = [new Uint8Array(0), Uint8Array.of(1), Uint8Array.of(0x80), new Uint8Array(60).fill(7), [Uint8Array.of(2), []]];
    expect(rlpDecode(rlpEncode(item))).toEqual(item);
  });

  it('refuses RLP no careful encoder writes', () => {
    for (const bad of [[0x81, 0x05], [0xb8, 0x01, 0x05], [0xc1], [0x80, 0x00], [0xb9, 0x00, 0x38]]) expect(() => rlpDecode(Uint8Array.from(bad))).toThrow();
  });

  it('reads a signed transaction and names its signer', () => {
    const tx = { chainId: 1n, nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gasLimit: 21000n, to: TO, value: 5n };
    const signed = signEvmTransaction(tx, KEY);
    expect(readSignedEvmTransaction(signed.raw)).toEqual({ tx, from: ME, hash: signed.hash });
    expect(() => readSignedEvmTransaction(`${signed.raw}00`)).toThrow();
    expect(() => readSignedEvmTransaction(signed.raw.replace('0x02', '0x01'))).toThrow();
  });
});

describe('a token on Ethereum without ETH', () => {
  const terms = readEthGasTerms(wire, LIMITS);

  it('reads the service’s terms and refuses absurd ones', () => {
    expect(terms).toEqual({ nonce: 7n, maxFeePerGas: 300_000_000n, maxPriorityFeePerGas: 1_000_000n, gasMain: 70_000n, gasFee: 60_000n, fee: 1_250_000n, receiver: RECEIVER });
    expect(() => readEthGasTerms({ ...wire, receiver: TO }, LIMITS)).toThrow('elsewhere');
    expect(() => readEthGasTerms({ ...wire, fee: '999999' }, LIMITS)).toThrow('fee');
    expect(() => readEthGasTerms({ ...wire, fee: '20000001' }, LIMITS)).toThrow('fee');
    expect(() => readEthGasTerms({ ...wire, maxFeePerGas: '60000000001' }, LIMITS)).toThrow('gas price');
    expect(() => readEthGasTerms({ ...wire, maxPriorityFeePerGas: '300000001' }, LIMITS)).toThrow('gas price');
    expect(() => readEthGasTerms({ ...wire, gasMain: '150001' }, LIMITS)).toThrow('gas');
    expect(() => readEthGasTerms({ ...wire, nonce: -1 }, LIMITS)).toThrow('malformed');
  });

  it('makes the fee the first of the two transfers and the payment the second', () => {
    const pair = buildEthGasPair(1n, USDT, TO, 25_000_000n, terms);
    expect(pair.fee.nonce).toBe(7n);
    expect(pair.main.nonce).toBe(8n);
    const fee = readSignedTokenTransfer(signEvmTransaction(pair.fee, KEY).raw);
    const main = readSignedTokenTransfer(signEvmTransaction(pair.main, KEY).raw);
    expect(fee).toMatchObject({ from: ME, to: RECEIVER, token: USDT, amount: 1_250_000n, nonce: 7n, gasLimit: 60_000n, chainId: 1n });
    expect(main).toMatchObject({ from: ME, to: TO, token: USDT, amount: 25_000_000n, nonce: 8n, gasLimit: 70_000n, maxFeePerGas: 300_000_000n });
  });

  it('refuses anything that is not a bare token transfer', () => {
    const base = { chainId: 1n, nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gasLimit: 60_000n, to: USDT };
    const pair = buildEthGasPair(1n, USDT, TO, 1n, terms);
    expect(() => readSignedTokenTransfer(signEvmTransaction({ ...base, value: 1n, data: pair.main.data as Uint8Array }, KEY).raw)).toThrow('Not a token transfer');
    expect(() => readSignedTokenTransfer(signEvmTransaction({ ...base, value: 0n }, KEY).raw)).toThrow('Not a token transfer');
    expect(() => readSignedTokenTransfer(signEvmTransaction({ ...base, value: 0n, data: Uint8Array.from([...(pair.main.data as Uint8Array), 0]) }, KEY).raw)).toThrow('Not a token transfer');
  });

  it('counts the ETH the two transfers can burn at most', () => {
    expect(ethGasNeed(terms)).toBe(130_000n * 300_000_000n);
  });
});
