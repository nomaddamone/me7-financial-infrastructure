import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateEntropy, wipe, type EntropyBits } from './entropy.ts';

/** New BIP39 phrase: 24 words for 256 bits (default), 12 words for 128 bits. */
export function createMnemonic(bits: EntropyBits = 256): string {
  const entropy = generateEntropy(bits);
  try {
    return entropyToMnemonic(entropy, wordlist);
  } finally {
    wipe(entropy);
  }
}

/**
 * The account's 32-byte master secret and its 24-word phrase are two spellings of
 * the same thing: the key file stores the bytes, the paper backup stores the words.
 */
export function entropyToPhrase(entropy: Uint8Array): string {
  if (entropy.length !== 32) throw new RangeError('entropyToPhrase: expected 32 bytes');
  return entropyToMnemonic(entropy, wordlist);
}

export function phraseToEntropy(mnemonic: string): Uint8Array {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) throw new Error('Invalid recovery phrase');
  const entropy = mnemonicToEntropy(normalized, wordlist);
  if (entropy.length !== 32) throw new Error('A me7 account needs a 24-word phrase');
  return entropy;
}

/** Trim, lowercase and collapse whitespace so pasted phrases compare equal. */
export function normalizeMnemonic(input: string): string {
  return input.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidMnemonic(input: string): boolean {
  return validateMnemonic(normalizeMnemonic(input), wordlist);
}

/**
 * BIP39 seed (64 bytes). A different passphrase yields a different, equally valid
 * wallet — this is what the decoy wallet is built on.
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid recovery phrase');
  }
  return mnemonicToSeedSync(normalized, passphrase);
}
