import { computeAddress, getBytes, Interface, keccak256, SigningKey, TypedDataEncoder, verifyTypedData, Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import { evmAddressFromPrivateKey } from '../src/core/evm.ts';
import {
  ANNOUNCEMENT_TOPIC,
  announceData,
  matchAnnouncement,
  metaAddressOfData,
  parseStealthCode,
  readAnnouncement,
  registerOnBehalfData,
  registryEntryDigest,
  signRegistryEntry,
  STEALTH_ANNOUNCER,
  STEALTH_REGISTRY,
  stealthAddressFor,
  stealthCode,
  stealthKeys,
  stealthMetaAddress,
  stealthPrivateKey,
  tokenMetadata,
} from '../src/core/stealth.ts';

const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytes = (h: string) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16));

const SEED = new Uint8Array(64).fill(7);
const EPHEMERAL = new Uint8Array(32).fill(9);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// From the reference implementation's own tests (ScopeLift/stealth-address-sdk): a pair of private keys and the meta-address they make.
const REF_SPEND = `0x${'363721eb9e981558c748b824cb32a840da2b3e8957c2fc3bcb8d9c86cb87456'.padStart(64, '0')}`;
const REF_VIEW = '0xb52a0555f6a8663d89f00365893b1ef9e38eaf2e8bc48a63319c9ea5cb4a27c5';
const REF_META = '0x033404e82cd2a92321d51e13064ec13a0fb0192a9fdaaca1cfb47b37bd27ec13970390ad5eca026c05ab5cf4d620a2ac65241b11df004ddca360e954db1b26e3846e';

/** The same sums done by another library, the way the reference does them. */
function byEthers(spendPub: string, viewPub: string, ephemeral: string) {
  const shared = SigningKey.computePublicKey(new SigningKey(ephemeral).computeSharedSecret(viewPub), true);
  const h = keccak256(shared);
  const stealthPub = SigningKey.addPoints(spendPub, SigningKey.computePublicKey(h, false), false);
  return { address: computeAddress(stealthPub), viewTag: parseInt(h.slice(2, 4), 16), h };
}

describe('stealth addresses', () => {
  it('builds a meta-address the way the reference implementation does', () => {
    const meta = stealthMetaAddress({ spendPub: bytes(SigningKey.computePublicKey(REF_SPEND, true)), viewPub: bytes(SigningKey.computePublicKey(REF_VIEW, true)) });
    expect(meta).toBe(REF_META);
    expect(stealthCode(meta, 'eth')).toBe(`st:eth:${REF_META}`);
  });

  it('pays to the address another implementation of the standard arrives at', () => {
    const target = parseStealthCode(`st:eth:${REF_META}`);
    expect(target).not.toBeNull();
    for (const e of [EPHEMERAL, new Uint8Array(32).fill(0xab), bytes(`0x${'01'.padStart(64, '0')}`)]) {
      const mine = stealthAddressFor(target!, e);
      const theirs = byEthers(hex(target!.spendPub), hex(target!.viewPub), hex(e));
      expect(mine.address).toBe(theirs.address);
      expect(mine.viewTag).toBe(theirs.viewTag);
      expect(hex(mine.ephemeralPubKey)).toBe(SigningKey.computePublicKey(hex(e), true));
    }
  });

  it('lets the receiver find the payment and spend it, and nobody else', () => {
    const keys = { spend: bytes(REF_SPEND), view: bytes(REF_VIEW), spendPub: bytes(REF_META.slice(0, 68)), viewPub: bytes(`0x${REF_META.slice(68)}`) };
    const paid = stealthAddressFor(keys, EPHEMERAL);
    const found = matchAnnouncement(keys, paid.ephemeralPubKey, paid.viewTag);
    expect(found?.address).toBe(paid.address);
    // The key made from the spending key and the tweak is the key of that very address.
    expect(evmAddressFromPrivateKey(stealthPrivateKey(keys.spend, found!.tweak))).toBe(paid.address);
    expect(new Wallet(hex(stealthPrivateKey(keys.spend, found!.tweak))).address).toBe(paid.address);
    // Another account's viewing key finds nothing in it.
    const other = stealthKeys(SEED);
    expect(matchAnnouncement(other, paid.ephemeralPubKey, paid.viewTag)?.address ?? null).not.toBe(paid.address);
    // A wrong view tag is thrown out at once; without a tag the match is still made.
    expect(matchAnnouncement(keys, paid.ephemeralPubKey, (paid.viewTag + 1) % 256)).toBeNull();
    expect(matchAnnouncement(keys, paid.ephemeralPubKey)?.address).toBe(paid.address);
    // Junk in place of a key is not an error, just not ours.
    expect(matchAnnouncement(keys, new Uint8Array(33).fill(5), 1)).toBeNull();
  });

  it('gives every payment its own address', () => {
    const keys = stealthKeys(SEED);
    const seen = new Set<string>();
    for (let i = 1; i <= 20; i++) seen.add(stealthAddressFor(keys, new Uint8Array(32).fill(i)).address);
    expect(seen.size).toBe(20);
  });

  it('never changes: these values are what money already sent depends on', () => {
    const keys = stealthKeys(SEED);
    expect(stealthMetaAddress(keys)).toBe(PINNED.meta);
    const paid = stealthAddressFor(keys, EPHEMERAL);
    expect(paid.address).toBe(PINNED.address);
    expect(paid.viewTag).toBe(PINNED.viewTag);
    expect(hex(stealthPrivateKey(keys.spend, matchAnnouncement(keys, paid.ephemeralPubKey)!.tweak))).toBe(PINNED.key);
  });

  it('reads only a whole, valid code', () => {
    const meta = stealthMetaAddress(stealthKeys(SEED));
    expect(parseStealthCode(`st:base:${meta}`)).toMatchObject({ chain: 'base', meta });
    expect(parseStealthCode(`  ${meta.toUpperCase().replace('0X', '0x')} `)).toMatchObject({ chain: null, meta });
    expect(parseStealthCode(meta.slice(0, 68))).toBeNull(); // one key for both uses
    expect(parseStealthCode(`${meta}00`)).toBeNull();
    expect(parseStealthCode(`st:base:0x${('02' + 'ff'.repeat(32)).repeat(2)}`)).toBeNull(); // not points of the curve
    expect(parseStealthCode(`st:base:${meta.slice(0, 68)}${'05' + 'ab'.repeat(32)}`)).toBeNull(); // a key with a prefix no key has
    expect(parseStealthCode('0x2191AAdA5B32A6A76a0D945B4C16b62ef34Ec5F8')).toBeNull();
    expect(parseStealthCode(`sx:base:${meta}`)).toBeNull();
  });

  it('writes the note the announcer expects and reads it back from the log', () => {
    const iface = new Interface([
      'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
      'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
    ]);
    const paid = stealthAddressFor(stealthKeys(SEED), EPHEMERAL);
    const metadata = tokenMetadata(paid.viewTag, USDC, 12_340_000n);
    expect(hex(metadata)).toBe(`0x${paid.viewTag.toString(16).padStart(2, '0')}a9059cbb${USDC.slice(2).toLowerCase()}${(12_340_000n).toString(16).padStart(64, '0')}`);
    expect(hex(announceData(paid, metadata))).toBe(iface.encodeFunctionData('announce', [1n, paid.address, paid.ephemeralPubKey, metadata]));
    expect(iface.getEvent('Announcement')!.topicHash).toBe(ANNOUNCEMENT_TOPIC);

    const log = iface.encodeEventLog('Announcement', [1n, paid.address, STEALTH_ANNOUNCER, paid.ephemeralPubKey, metadata]);
    const read = readAnnouncement(log.topics, log.data);
    expect(read).toMatchObject({ stealthAddress: paid.address, viewTag: paid.viewTag });
    expect(hex(read!.ephemeralPubKey)).toBe(hex(paid.ephemeralPubKey));
    expect(matchAnnouncement(stealthKeys(SEED), read!.ephemeralPubKey, read!.viewTag)?.address).toBe(paid.address);
    // Other schemes, short keys and broken data are not ours to read.
    expect(readAnnouncement(iface.encodeEventLog('Announcement', [2n, paid.address, STEALTH_ANNOUNCER, paid.ephemeralPubKey, metadata]).topics, log.data)).toBeNull();
    const short = iface.encodeEventLog('Announcement', [1n, paid.address, STEALTH_ANNOUNCER, '0x1234', metadata]);
    expect(readAnnouncement(short.topics, short.data)).toBeNull();
    expect(readAnnouncement(log.topics, '0x1234')).toBeNull();
  });

  it('signs a registry entry the registry on Base will accept', () => {
    const domain = { name: 'ERC6538Registry', version: '1.0', chainId: 8453, verifyingContract: STEALTH_REGISTRY };
    // What the registry on Base answers to DOMAIN_SEPARATOR() (read from the chain on 2026-11-15).
    const SEPARATOR = '0x91aeb40543c57dd3db1639ed66390eeb210515b56472d1ea6e08e28e3a0d5adf';
    expect(TypedDataEncoder.hashDomain(domain)).toBe(SEPARATOR);
    const types = { Erc6538RegistryEntry: [{ name: 'schemeId', type: 'uint256' }, { name: 'stealthMetaAddress', type: 'bytes' }, { name: 'nonce', type: 'uint256' }] };
    const owner = new Wallet(`0x${'11'.repeat(32)}`);
    const meta = stealthMetaAddress(stealthKeys(SEED));
    const value = { schemeId: 1n, stealthMetaAddress: meta, nonce: 3n };
    expect(hex(registryEntryDigest(SEPARATOR, meta, 3n))).toBe(TypedDataEncoder.hash(domain, types, value));
    const signature = signRegistryEntry(SEPARATOR, meta, 3n, getBytes(owner.privateKey));
    expect(verifyTypedData(domain, types, value, hex(signature))).toBe(owner.address);

    const iface = new Interface([
      'function registerKeysOnBehalf(address registrant, uint256 schemeId, bytes signature, bytes stealthMetaAddress)',
      'function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)',
    ]);
    expect(hex(registerOnBehalfData(owner.address, signature, meta))).toBe(iface.encodeFunctionData('registerKeysOnBehalf', [owner.address, 1n, signature, meta]));
    expect(hex(metaAddressOfData(owner.address))).toBe(iface.encodeFunctionData('stealthMetaAddressOf', [owner.address, 1n]));
  });
});

// Worked out once from SEED and EPHEMERAL above. If any of these ever differs, the derivation has changed and money is lost.
const PINNED = {
  meta: '0x02f20ed0df8f82de6b3fd36533bda440e992183e68f01fa3b59069efc5fd1beb16025cf0508b43e5169f58aa57bc7d0fc58dffc36fb81b451aa2b60bb9c1b80f5a65',
  address: '0xcE03C380644EfA649d91f886791A58bdDFD4A65E',
  viewTag: 217,
  key: '0x4cd735ce4740c6a2efa90629d3e4d7113e09f4b642e34cdee58e205a81e6d62a',
};
