import { AbiCoder, Interface } from 'ethers';
import { describe, expect, it } from 'vitest';
import { abiDecode, abiEncode, address, array, bool, bytes, bytes32, int, tuple, uint } from '../src/core/abi.ts';
import { checkSwap, decodeSwap, SWAP_NATIVE, SWAP_ROUTER, type SwapExpectation } from '../src/core/swap.ts';

const coder = AbiCoder.defaultAbiCoder();
const toBytes = (hex: string) => Uint8Array.from(hex.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
const ME = '0x0011eaa39468412f260c45397a30790e42260ded';
const FEE = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const THIEF = '0x1111111111111111111111111111111111111111';

/** The router's interface, written out from its verified source and encoded by an independent library. */
const router = new Interface([
  'function swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256, uint256)',
  'function swapSimpleMode(address caller, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes executorData, bytes clientData) returns (uint256, uint256)',
  'function rescueFunds(address token, uint256 amount)',
]);
const desc = (over: Record<string, unknown> = {}) => ({
  srcToken: SWAP_NATIVE,
  dstToken: USDC,
  srcReceivers: [THIEF],
  srcAmounts: [1n],
  feeReceivers: [FEE],
  feeAmounts: [50n],
  dstReceiver: ME,
  amount: 500_000_000_000_000n,
  minReturnAmount: 1_018_535n,
  flags: 0x2c0n,
  permit: '0x',
  ...over,
});
const built = (over: Record<string, unknown> = {}) =>
  router.encodeFunctionData('swap', [{ callTarget: THIEF, approveTarget: THIEF, targetData: `0x${'ab'.repeat(77)}`, desc: desc(over), clientData: `0x${'cd'.repeat(300)}` }]);
const want: SwapExpectation = {
  to: SWAP_ROUTER,
  value: 500_000_000_000_000n,
  srcToken: SWAP_NATIVE,
  dstToken: USDC,
  receiver: ME,
  amount: 500_000_000_000_000n,
  minReturn: 1_018_535n,
  feeReceiver: FEE,
  feeBps: 50n,
};

describe('abi decoder', () => {
  it('reads back what an independent encoder wrote, nested and dynamic', () => {
    const types = [uint, tuple(address, bytes, int, array(bytes32)), array(array(tuple(bool, bytes))), bytes];
    const hex = coder.encode(
      ['uint256', 'tuple(address,bytes,int16,bytes32[])', 'tuple(bool,bytes)[][]', 'bytes'],
      [7n, [ME, '0x010203', -5, [`0x${'ab'.repeat(32)}`]], [[[true, '0x']], [], [[false, `0x${'09'.repeat(33)}`]]], `0x${'01'.repeat(64)}`],
    );
    const values = abiDecode(types, toBytes(hex));
    expect(values).toEqual([7n, [ME, Uint8Array.of(1, 2, 3), -5n, [`0x${'ab'.repeat(32)}`]], [[[true, new Uint8Array(0)]], [], [[false, new Uint8Array(33).fill(9)]]], new Uint8Array(64).fill(1)]);
    // And encoding it again gives the same bytes.
    expect(abiEncode(types, values)).toEqual(toBytes(hex));
  });

  it('refuses data that lies about its own shape', () => {
    const good = toBytes(coder.encode(['bytes'], ['0x010203']));
    expect(() => abiDecode([bytes], good.subarray(0, 40))).toThrow();
    const hugeOffset = good.slice();
    hugeOffset.set(new Uint8Array(32).fill(255), 0);
    expect(() => abiDecode([bytes], hugeOffset)).toThrow();
    const hugeLength = good.slice();
    hugeLength[63] = 200;
    expect(() => abiDecode([bytes], hugeLength)).toThrow();
    expect(() => abiDecode([array(uint)], toBytes(coder.encode(['uint256', 'uint256'], [32n, 1000n])))).toThrow();
    expect(() => abiDecode([address], new Uint8Array(32).fill(1))).toThrow();
  });
});

describe('swap transaction check', () => {
  it('reads the order out of both of the router’s swap methods', () => {
    const order = { srcToken: SWAP_NATIVE, dstToken: USDC, receiver: ME, amount: 500_000_000_000_000n, minReturn: 1_018_535n, feeReceivers: [FEE], feeAmounts: [50n] };
    expect(decodeSwap(built())).toEqual(order);
    expect(decodeSwap(router.encodeFunctionData('swapSimpleMode', [THIEF, desc(), '0x1234', '0x']))).toEqual(order);
  });

  it('passes a swap that is exactly what was shown', () => {
    expect(checkSwap(built(), want).receiver).toBe(ME);
    // Swapping a token: nothing but the token moves, so the transaction carries no coin.
    expect(checkSwap(built({ srcToken: USDC, dstToken: SWAP_NATIVE }), { ...want, srcToken: USDC, dstToken: SWAP_NATIVE, value: 0n }).amount).toBe(want.amount);
    // No fee configured and none taken.
    expect(checkSwap(built({ feeReceivers: [], feeAmounts: [] }), { ...want, feeReceiver: null, feeBps: 0n }).feeReceivers).toEqual([]);
  });

  it('refuses every way a server could turn the swap against the user', () => {
    expect(() => checkSwap(built(), { ...want, to: THIEF })).toThrow(/unknown contract/);
    expect(() => checkSwap(built({ dstReceiver: THIEF }), want)).toThrow(/someone else/);
    expect(() => checkSwap(built({ minReturnAmount: 1n }), want)).toThrow(/less than was shown/);
    expect(() => checkSwap(built({ dstToken: THIEF }), want)).toThrow(/other coins/);
    expect(() => checkSwap(built({ srcToken: USDC }), want)).toThrow(/other coins/);
    expect(() => checkSwap(built({ amount: 900_000_000_000_000n }), want)).toThrow(/different amount/);
    expect(() => checkSwap(built(), { ...want, value: 900_000_000_000_000n })).toThrow(/wrong amount of coin/);
    expect(() => checkSwap(built({ srcToken: USDC }), { ...want, srcToken: USDC })).toThrow(/wrong amount of coin/);
    expect(() => checkSwap(built({ feeReceivers: [THIEF] }), want)).toThrow(/unknown address/);
    expect(() => checkSwap(built({ feeReceivers: [FEE, THIEF], feeAmounts: [25n, 25n] }), want)).toThrow(/unknown address/);
    expect(() => checkSwap(built({ feeAmounts: [5000n] }), want)).toThrow(/larger fee/);
    expect(() => checkSwap(built(), { ...want, feeReceiver: null, feeBps: 0n })).toThrow(/unknown address/);
    expect(() => checkSwap(built({ feeAmounts: [] }), want)).toThrow(/Unreadable swap fee/);
  });

  it('refuses a method it does not know and data it cannot read', () => {
    expect(() => checkSwap(router.encodeFunctionData('rescueFunds', [USDC, 1n]), want)).toThrow(/Unknown swap method/);
    expect(() => checkSwap('0x', want)).toThrow();
    expect(() => checkSwap(built().slice(0, 300), want)).toThrow();
    expect(() => checkSwap('not hex', want)).toThrow();
  });
});
