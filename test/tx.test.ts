import { hexToBytes } from '@noble/hashes/utils.js';
import * as btc from '@scure/btc-signer';
import { Interface as EthersInterface, Transaction as EthersTransaction, Wallet as EthersWallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  bitcoinPath,
  BitcoinSendError,
  decodeUint256,
  deriveKey,
  dustLimit,
  erc20BalanceOfData,
  erc20TransferData,
  evmAddressFromPrivateKey,
  evmPath,
  EVM_TRANSFER_GAS,
  isValidBitcoinAddress,
  mnemonicToSeed,
  p2wpkhAddress,
  parseUnits,
  planBitcoinSend,
  rlpEncode,
  signBitcoinSend,
  signEvmTransaction,
  type EvmTransaction,
  type Utxo,
} from '../src/core/index.ts';

const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = mnemonicToSeed(ABANDON);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('RLP', () => {
  it('matches the reference examples from the Ethereum wiki', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(hex(rlpEncode(text('dog')))).toBe('83646f67');
    expect(hex(rlpEncode([text('cat'), text('dog')]))).toBe('c88363617483646f67');
    expect(hex(rlpEncode(new Uint8Array(0)))).toBe('80');
    expect(hex(rlpEncode([]))).toBe('c0');
    expect(hex(rlpEncode(Uint8Array.of(0x0f)))).toBe('0f');
    expect(hex(rlpEncode(Uint8Array.of(0x04, 0x00)))).toBe('820400');
    expect(hex(rlpEncode([[], [[]], [[], [[]]]]))).toBe('c7c0c1c0c3c0c1c0');
    const long = text('Lorem ipsum dolor sit amet, consectetur adipisicing elit');
    expect(hex(rlpEncode(long)).startsWith('b838')).toBe(true);
  });
});

describe('EVM transaction signing', () => {
  const key = deriveKey(seed, evmPath(0));
  const from = evmAddressFromPrivateKey(key.privateKey);
  const tx: EvmTransaction = {
    chainId: 11155111n,
    nonce: 7n,
    maxPriorityFeePerGas: 1_500_000_000n,
    maxFeePerGas: 32_000_000_000n,
    gasLimit: EVM_TRANSFER_GAS,
    to: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    value: 12_345_000_000_000_000n,
  };

  it('produces exactly what ethers produces for the same key and fields', async () => {
    const ours = signEvmTransaction(tx, key.privateKey);
    const theirs = await new EthersWallet(`0x${hex(key.privateKey)}`).signTransaction({
      type: 2,
      chainId: tx.chainId,
      nonce: Number(tx.nonce),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      maxFeePerGas: tx.maxFeePerGas,
      gasLimit: tx.gasLimit,
      to: tx.to,
      value: tx.value,
    });
    expect(ours.raw).toBe(theirs);
  });

  it('is read back by an independent parser with the right sender and fields', () => {
    const { raw, hash } = signEvmTransaction(tx, key.privateKey);
    const parsed = EthersTransaction.from(raw);
    expect(parsed.from).toBe(from);
    expect(parsed.to).toBe(tx.to);
    expect(parsed.value).toBe(tx.value);
    expect(parsed.nonce).toBe(7);
    expect(parsed.chainId).toBe(tx.chainId);
    expect(parsed.gasLimit).toBe(21000n);
    expect(parsed.maxFeePerGas).toBe(tx.maxFeePerGas);
    expect(parsed.maxPriorityFeePerGas).toBe(tx.maxPriorityFeePerGas);
    expect(parsed.hash).toBe(hash);
  });

  it('handles zero values, which RLP encodes as empty strings', () => {
    const zero = { ...tx, nonce: 0n, value: 0n, maxPriorityFeePerGas: 0n };
    const parsed = EthersTransaction.from(signEvmTransaction(zero, key.privateKey).raw);
    expect(parsed.from).toBe(from);
    expect(parsed.nonce).toBe(0);
    expect(parsed.value).toBe(0n);
  });

  it('refuses a bad recipient and a tip above the cap', () => {
    expect(() => signEvmTransaction({ ...tx, to: '0x123' }, key.privateKey)).toThrow(/recipient/);
    expect(() => signEvmTransaction({ ...tx, to: tx.to.replace('5aA', '5aa') }, key.privateKey)).toThrow(/recipient/);
    expect(() => signEvmTransaction({ ...tx, maxPriorityFeePerGas: tx.maxFeePerGas + 1n }, key.privateKey)).toThrow(/Tip/);
  });
});

describe('ERC-20 calls', () => {
  const key = deriveKey(seed, evmPath(0));
  const token = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';
  const to = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  const erc20 = new EthersInterface([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address owner) view returns (uint256)',
  ]);

  it('encodes transfer and balanceOf exactly like ethers', () => {
    expect(`0x${hex(erc20TransferData(to, 1_500_000n))}`).toBe(erc20.encodeFunctionData('transfer', [to, 1_500_000n]));
    expect(`0x${hex(erc20TransferData(to, 0n))}`).toBe(erc20.encodeFunctionData('transfer', [to, 0n]));
    const max = (1n << 256n) - 1n;
    expect(`0x${hex(erc20TransferData(to, max))}`).toBe(erc20.encodeFunctionData('transfer', [to, max]));
    expect(erc20BalanceOfData(to)).toBe(erc20.encodeFunctionData('balanceOf', [to]));
  });

  it('refuses bad input', () => {
    expect(() => erc20TransferData('0x123', 1n)).toThrow(/address/);
    expect(() => erc20TransferData(to, -1n)).toThrow(RangeError);
    expect(() => erc20TransferData(to, 1n << 256n)).toThrow(RangeError);
    expect(() => decodeUint256('0x')).toThrow();
    expect(() => decodeUint256('0x01')).toThrow();
    expect(decodeUint256(`0x${'0'.repeat(63)}7`)).toBe(7n);
  });

  it('signs a token transfer exactly like ethers and it reads back as a transfer', async () => {
    const tx: EvmTransaction = {
      chainId: 11155111n,
      nonce: 3n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 20_000_000_000n,
      gasLimit: 65_000n,
      to: token,
      value: 0n,
      data: erc20TransferData(to, 2_500_000n),
    };
    const ours = signEvmTransaction(tx, key.privateKey);
    const theirs = await new EthersWallet(`0x${hex(key.privateKey)}`).signTransaction({
      type: 2,
      chainId: tx.chainId,
      nonce: 3,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      maxFeePerGas: tx.maxFeePerGas,
      gasLimit: tx.gasLimit,
      to: token,
      value: 0n,
      data: `0x${hex(tx.data!)}`,
    });
    expect(ours.raw).toBe(theirs);
    const parsed = EthersTransaction.from(ours.raw);
    const call = erc20.parseTransaction({ data: parsed.data });
    expect(parsed.to).toBe(token);
    expect(call?.name).toBe('transfer');
    expect(call?.args[0]).toBe(to);
    expect(call?.args[1]).toBe(2_500_000n);
  });
});

describe('parseUnits', () => {
  it('parses decimals exactly', () => {
    expect(parseUnits('1', 18)).toBe(10n ** 18n);
    expect(parseUnits('0.015', 18)).toBe(15_000_000_000_000_000n);
    expect(parseUnits('0,5', 8)).toBe(50_000_000n);
    expect(parseUnits('.5', 8)).toBe(50_000_000n);
    expect(parseUnits('12.', 8)).toBe(1_200_000_000n);
    expect(parseUnits('0.00000001', 8)).toBe(1n);
    expect(parseUnits('0', 8)).toBe(0n);
  });

  it('rejects junk and too many decimals', () => {
    for (const bad of ['', '.', 'abc', '1e5', '-1', '1.2.3', '0.000000001', ' ', '1 000']) {
      expect(parseUnits(bad, 8)).toBeNull();
    }
  });
});

describe('Bitcoin send planning', () => {
  const coin = (value: bigint, n = 0): Utxo => ({ txid: `${n}`.padStart(64, 'a'), vout: n, value });
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof BitcoinSendError ? e.code : `other: ${String(e)}`;
    }
    return 'no error';
  };

  it('spends one coin and returns change', () => {
    const plan = planBitcoinSend([coin(100_000n)], 30_000n, 2);
    expect(plan.inputs).toHaveLength(1);
    expect(plan.vsize).toBe(11 + 68 + 62);
    expect(plan.fee).toBe(282n);
    expect(plan.change).toBe(100_000n - 30_000n - 282n);
  });

  it('adds coins, largest first, until the amount is covered', () => {
    const plan = planBitcoinSend([coin(5_000n, 1), coin(40_000n, 2), coin(20_000n, 3)], 55_000n, 1);
    expect(plan.inputs.map((u) => u.value)).toEqual([40_000n, 20_000n]);
    expect(plan.amount + plan.fee + plan.change).toBe(60_000n);
  });

  it('gives a tiny leftover to the fee instead of making a dust output', () => {
    const plan = planBitcoinSend([coin(10_000n)], 9_700n, 1);
    expect(plan.change).toBe(0n);
    expect(plan.fee).toBe(300n);
    expect(plan.vsize).toBe(11 + 68 + 31);
  });

  it('sends everything with "max"', () => {
    const plan = planBitcoinSend([coin(659n)], 'max', 1);
    expect(plan.fee).toBe(110n);
    expect(plan.amount).toBe(549n);
    expect(plan.change).toBe(0n);
  });

  it('never loses or invents satoshi', () => {
    for (const rate of [1, 1.5, 3, 25]) {
      for (const amount of [600n, 1_000n, 25_000n, 90_000n]) {
        const coins = [coin(30_000n, 1), coin(70_000n, 2), coin(900n, 3)];
        const plan = planBitcoinSend(coins, amount, rate);
        const spent = plan.inputs.reduce((n, u) => n + u.value, 0n);
        expect(plan.amount + plan.fee + plan.change).toBe(spent);
        expect(plan.fee).toBeGreaterThanOrEqual(BigInt(Math.ceil(plan.vsize * rate)));
      }
    }
  });

  it('reports what is wrong', () => {
    expect(code(() => planBitcoinSend([coin(1_000n)], 5_000n, 1))).toBe('insufficient-funds');
    expect(code(() => planBitcoinSend([coin(1_000n)], 950n, 1))).toBe('insufficient-funds');
    expect(code(() => planBitcoinSend([], 'max', 1))).toBe('insufficient-funds');
    expect(code(() => planBitcoinSend([coin(100n)], 'max', 1))).toBe('insufficient-funds');
    expect(code(() => planBitcoinSend([coin(600n)], 'max', 1))).toBe('dust');
    expect(code(() => planBitcoinSend([coin(10_000n)], 300n, 1))).toBe('dust');
    expect(code(() => planBitcoinSend([coin(10_000n)], 0n, 1))).toBe('bad-input');
    expect(code(() => planBitcoinSend([coin(10_000n)], 1_000n, 0))).toBe('bad-input');
  });
});

describe('Bitcoin signing', () => {
  const key = deriveKey(seed, bitcoinPath('testnet', 0));
  const address = p2wpkhAddress(key.publicKey, 'testnet');
  const utxo: Utxo = { txid: '9793669bcfa004ec3aee4efeecc9c0b5f4d824b5b4f59f99fa26c88558576060', vout: 1, value: 100_000n };
  const to = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

  it('builds a transaction an independent parser reads back correctly', () => {
    const plan = planBitcoinSend([utxo], 30_000n, 2);
    const signed = signBitcoinSend(plan, to, address, key.privateKey, 'testnet');
    const parsed = btc.Transaction.fromRaw(hexToBytes(signed.hex));
    expect(parsed.id).toBe(signed.txid);
    expect(parsed.inputsLength).toBe(1);
    expect(parsed.outputsLength).toBe(2);
    expect(parsed.getOutput(0).amount).toBe(30_000n);
    expect(parsed.getOutput(1).amount).toBe(plan.change);
    expect(btc.Address(btc.TEST_NETWORK).encode(btc.OutScript.decode(parsed.getOutput(0).script!))).toBe(to);
    expect(btc.Address(btc.TEST_NETWORK).encode(btc.OutScript.decode(parsed.getOutput(1).script!))).toBe(address);
    // The estimate must not undershoot the real size, or the fee rate would be too low.
    expect(parsed.vsize).toBeLessThanOrEqual(plan.vsize);
    expect(plan.vsize - parsed.vsize).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    const plan = planBitcoinSend([utxo], 'max', 1);
    const a = signBitcoinSend(plan, to, address, key.privateKey, 'testnet');
    const b = signBitcoinSend(plan, to, address, key.privateKey, 'testnet');
    expect(a).toEqual(b);
  });

  it('knows the dust limit of each address type', () => {
    expect(dustLimit(to, 'testnet')).toBe(294n);
    expect(dustLimit('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', 'mainnet')).toBe(330n);
    expect(dustLimit('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'mainnet')).toBe(546n);
    expect(planBitcoinSend([utxo], 300n, 1, dustLimit(to, 'testnet')).amount).toBe(300n);
    expect(() => planBitcoinSend([utxo], 300n, 1)).toThrow(BitcoinSendError);
  });

  it('validates addresses per network', () => {
    expect(isValidBitcoinAddress(to, 'testnet')).toBe(true);
    expect(isValidBitcoinAddress(address, 'testnet')).toBe(true);
    expect(isValidBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'mainnet')).toBe(true);
    expect(isValidBitcoinAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'testnet')).toBe(false);
    expect(isValidBitcoinAddress(to, 'mainnet')).toBe(false);
    expect(isValidBitcoinAddress(`${to.slice(0, -1)}q`, 'testnet')).toBe(false);
    expect(isValidBitcoinAddress('', 'testnet')).toBe(false);
    expect(isValidBitcoinAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'testnet')).toBe(false);
  });
});
