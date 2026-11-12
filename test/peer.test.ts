import { AbiCoder, Interface, id } from 'ethers';
import { describe, expect, it } from 'vitest';
import { abiEncode, address, array, bool, bytes, bytes32, encodeCall, int, keccakText, tuple, uint } from '../src/core/abi.ts';
import {
  PEER_ESCROW,
  PEER_GATING_SERVICE,
  PEER_INTENT_GUARDIAN,
  PEER_ORACLE_ADAPTER,
  PEER_PLATFORMS,
  decodeBytes,
  decodeBytes32Array,
  decodePeerDeposit,
  decodePeerRate,
  erc20AllowanceData,
  erc20ApproveData,
  peerCreateDepositData,
  peerCurrencyByHash,
  peerDepositIdFromLogs,
  peerFeedConfig,
  peerGetCurrenciesCall,
  peerGetDepositCall,
  peerGetMethodsCall,
  peerMethodByHash,
  peerMethodId,
  peerRateCall,
  peerValidateFeedCall,
  peerWithdrawData,
} from '../src/core/peer.ts';

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const coder = AbiCoder.defaultAbiCoder();
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ME = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const PAYEE = `0x${'ab'.repeat(32)}`;

/** The contract's interface, written out from its published source, encoded by an independent library. */
const escrow = new Interface([
  'function createDeposit((address token, uint256 amount, (uint256 min, uint256 max) intentAmountRange, bytes32[] paymentMethods, (address intentGatingService, bytes32 payeeDetails, bytes data)[] paymentMethodData, (bytes32 code, uint256 minConversionRate, (address adapter, bytes adapterConfig, int16 spreadBps, uint32 maxStaleness) oracleRateConfig)[][] currencies, address delegate, address intentGuardian, bool retainOnEmpty) params)',
  'function withdrawDeposit(uint256 depositId)',
  'function getDeposit(uint256 depositId) view returns ((address depositor, address delegate, address token, (uint256 min, uint256 max) intentAmountRange, bool acceptingIntents, uint256 remainingDeposits, uint256 outstandingIntentAmount, address intentGuardian, bool retainOnEmpty))',
  'function getDepositPaymentMethods(uint256 depositId) view returns (bytes32[])',
  'function getDepositCurrencies(uint256 depositId, bytes32 paymentMethod) view returns (bytes32[])',
  'event DepositReceived(uint256 indexed depositId, address indexed depositor, address indexed token, uint256 amount, (uint256 min, uint256 max) intentAmountRange, address delegate, address intentGuardian)',
]);
const erc20 = new Interface(['function approve(address spender, uint256 amount)', 'function allowance(address owner, address spender) view returns (uint256)']);
const adapter = new Interface(['function validateConfig(bytes rawConfig) view returns (bytes)', 'function getRate(bytes normalizedConfig) view returns (bool, uint256, uint256)']);

describe('abi encoder', () => {
  it('matches an independent encoder on nested dynamic structures', () => {
    const types = [uint, tuple(address, bytes, int, array(bytes32)), array(array(tuple(bool, bytes))), bytes];
    const values = [
      7n,
      [ME, Uint8Array.of(1, 2, 3), -5n, [PAYEE, PAYEE]],
      [[[true, new Uint8Array(0)]], [], [[false, new Uint8Array(33).fill(9)], [true, Uint8Array.of(255)]]],
      new Uint8Array(64).fill(1),
    ];
    const expected = coder.encode(
      ['uint256', 'tuple(address,bytes,int16,bytes32[])', 'tuple(bool,bytes)[][]', 'bytes'],
      [7n, [ME, '0x010203', -5, [PAYEE, PAYEE]], [[[true, '0x']], [], [[false, `0x${'09'.repeat(33)}`], [true, '0xff']]], `0x${'01'.repeat(64)}`],
    );
    expect(hex(abiEncode(types, values))).toBe(expected);
  });

  it('hashes names like the chain does and refuses bad values', () => {
    expect(keccakText('revolut')).toBe(id('revolut'));
    expect(hex(encodeCall('transfer(address,uint256)', [address, uint], [ME, 1n])).slice(0, 10)).toBe('0xa9059cbb');
    expect(() => abiEncode([uint], [-1n])).toThrow();
    expect(() => abiEncode([address], ['0x123'])).toThrow();
    expect(() => abiEncode([bytes32], ['0x00'])).toThrow();
    expect(() => abiEncode([uint, uint], [1n])).toThrow();
  });
});

describe('peer deposit', () => {
  it('builds exactly the call an independent library builds for the same deposit', () => {
    for (const platform of PEER_PLATFORMS) {
      const amount = 250_000_000n;
      const data = peerCreateDepositData({ token: USDC, amount, platform: platform.id, currencies: platform.currencies, payeeHash: PAYEE });
      const expected = escrow.encodeFunctionData('createDeposit', [
        {
          token: USDC,
          amount,
          intentAmountRange: { min: 1_000_000n, max: amount },
          paymentMethods: [id(platform.id)],
          paymentMethodData: [{ intentGatingService: PEER_GATING_SERVICE, payeeDetails: PAYEE, data: '0x' }],
          currencies: [
            platform.currencies.map((c) => ({
              code: id(c),
              minConversionRate: 1n,
              oracleRateConfig: { adapter: PEER_ORACLE_ADAPTER, adapterConfig: hex(peerFeedConfig(c)), spreadBps: 0, maxStaleness: 86400 },
            })),
          ],
          delegate: '0x0000000000000000000000000000000000000000',
          intentGuardian: PEER_INTENT_GUARDIAN,
          retainOnEmpty: false,
        },
      ]);
      expect(hex(data)).toBe(expected);
    }
  });

  it('prices the dollar at par and the others from an inverted feed', () => {
    expect(hex(peerFeedConfig('USD'))).toBe(coder.encode(['address', 'bool'], ['0x0000000000000000000000000000000000000000', false]));
    expect(hex(peerFeedConfig('EUR'))).toBe(coder.encode(['address', 'bool'], ['0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F', true]));
    expect(hex(peerFeedConfig('GBP'))).toBe(coder.encode(['address', 'bool'], ['0xCceA6576904C118037695eB71195a5425E69Fa15', true]));
  });

  it('lets a deposit under one USDC be taken only whole', () => {
    const data = peerCreateDepositData({ token: USDC, amount: 400_000n, platform: 'venmo', currencies: ['USD'], payeeHash: PAYEE });
    const [params] = escrow.decodeFunctionData('createDeposit', hex(data));
    expect(params.intentAmountRange.min).toBe(400_000n);
    expect(params.intentAmountRange.max).toBe(400_000n);
  });

  it('refuses a deposit that could not be what the user meant', () => {
    const ok = { token: USDC, amount: 1_000_000n, platform: 'revolut', currencies: ['EUR'] as const, payeeHash: PAYEE };
    expect(() => peerCreateDepositData({ ...ok, amount: 0n })).toThrow();
    expect(() => peerCreateDepositData({ ...ok, platform: 'paypal' })).toThrow(/Unknown/);
    expect(() => peerCreateDepositData({ ...ok, platform: 'venmo' })).toThrow(/does not pay/);
    expect(() => peerCreateDepositData({ ...ok, currencies: [] })).toThrow();
    expect(() => peerCreateDepositData({ ...ok, currencies: ['EUR', 'EUR'] })).toThrow();
    expect(() => peerCreateDepositData({ ...ok, payeeHash: `0x${'00'.repeat(32)}` })).toThrow(/payee/);
  });

  it('builds the other calls the same way an independent library does', () => {
    expect(hex(erc20ApproveData(PEER_ESCROW, 5n))).toBe(erc20.encodeFunctionData('approve', [PEER_ESCROW, 5n]));
    expect(erc20AllowanceData(ME, PEER_ESCROW)).toBe(erc20.encodeFunctionData('allowance', [ME, PEER_ESCROW]));
    expect(hex(peerWithdrawData(42n))).toBe(escrow.encodeFunctionData('withdrawDeposit', [42n]));
    expect(peerGetDepositCall(42n)).toBe(escrow.encodeFunctionData('getDeposit', [42n]));
    expect(peerGetMethodsCall(42n)).toBe(escrow.encodeFunctionData('getDepositPaymentMethods', [42n]));
    expect(peerGetCurrenciesCall(42n, id('revolut'))).toBe(escrow.encodeFunctionData('getDepositCurrencies', [42n, id('revolut')]));
    expect(peerValidateFeedCall('EUR')).toBe(adapter.encodeFunctionData('validateConfig', [hex(peerFeedConfig('EUR'))]));
    expect(peerRateCall(Uint8Array.of(1, 2, 3))).toBe(adapter.encodeFunctionData('getRate', ['0x010203']));
  });

  it('reads back what the contract answers', () => {
    const answer = escrow.encodeFunctionResult('getDeposit', [
      [ME, '0x0000000000000000000000000000000000000000', USDC, [1_000_000n, 244_000_000n], true, 200_000_000n, 44_000_000n, PEER_INTENT_GUARDIAN, false],
    ]);
    expect(decodePeerDeposit(answer)).toEqual({ depositor: ME, token: USDC, accepting: true, remaining: 200_000_000n, reserved: 44_000_000n });
    expect(decodePeerDeposit(`0x${'00'.repeat(320)}`)).toBeNull();
    expect(() => decodePeerDeposit('0x00')).toThrow();

    expect(decodeBytes32Array(escrow.encodeFunctionResult('getDepositPaymentMethods', [[id('revolut'), id('venmo')]]))).toEqual([id('revolut'), id('venmo')]);
    expect(decodeBytes32Array(escrow.encodeFunctionResult('getDepositPaymentMethods', [[]]))).toEqual([]);
    expect(hex(decodeBytes(adapter.encodeFunctionResult('validateConfig', [`0x${'07'.repeat(22)}`])))).toBe(`0x${'07'.repeat(22)}`);
    expect(decodePeerRate(adapter.encodeFunctionResult('getRate', [true, 895788458623875975n, 1790000000n]))).toEqual({
      valid: true,
      rate: 895788458623875975n,
      updatedAt: 1790000000n,
    });
  });

  it('finds the new deposit number in a receipt, and only for our own deposit', () => {
    const log = escrow.encodeEventLog('DepositReceived', [8740n, ME, USDC, 5n, [1n, 5n], '0x0000000000000000000000000000000000000000', PEER_INTENT_GUARDIAN]);
    const mine = { address: '0x777777779d229cdF3110e9de47943791c26300Ef', topics: log.topics };
    expect(peerDepositIdFromLogs([{ address: USDC, topics: ['0x00'] }, mine], ME)).toBe(8740n);
    expect(peerDepositIdFromLogs([mine], '0x0011eaa39468412f260c45397a30790e42260ded')).toBeNull();
    expect(peerDepositIdFromLogs([{ ...mine, address: USDC }], ME)).toBeNull();
  });

  it('recognises its own methods and currencies by hash', () => {
    expect(peerMethodByHash(id('revolut'))?.id).toBe('revolut');
    expect(peerMethodByHash(id('paypal'))).toBeNull();
    expect(peerCurrencyByHash(id('EUR'))).toBe('EUR');
    expect(peerMethodId('monzo')).toBe(id('monzo'));
  });

  it('cleans up handles the way each payment app writes them', () => {
    const by = (name: string) => PEER_PLATFORMS.find((p) => p.id === name)!;
    expect(by('revolut').normalize(' @ivan1abc ')).toBe('ivan1abc');
    expect(by('cashapp').normalize('$ivan')).toBe('ivan');
    expect(by('chime').normalize('Ivan')).toBe('$ivan');
    expect(by('zelle').normalize('Ivan@Mail.com')).toBe('ivan@mail.com');
    expect(by('zelle').valid('not-an-email')).toBe(false);
    expect(by('revolut').valid('has space')).toBe(false);
    expect(by('revolut').valid('ivan1abc')).toBe(true);
  });
});
