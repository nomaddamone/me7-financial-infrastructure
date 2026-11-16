import { ANNOUNCEMENT_TOPIC, matchAnnouncement, readAnnouncement, STEALTH_ANNOUNCER, type StealthKeys } from '../core/stealth.ts';
import { evmRpc } from './send.ts';

/**
 * Finding one's own stealth payments. Every payment leaves a note with the announcer; the notes
 * are public and say nothing to anyone but the receiver. So the wallet reads all of them, a
 * stretch of blocks at a time, and keeps the ones its viewing key answers to. Nothing about the
 * account is sent anywhere: the nodes are asked for everybody's notes, never for "mine".
 */

/** How many blocks are asked for at once: the public nodes refuse longer stretches. */
const SPAN = 45_000;
const MIN_SPAN = 2_000;

export interface StealthFind {
  address: string;
  /** The once-used public key from the note, 0x-hex: with the viewing key it gives the address's key again. */
  ephemeralPubKey: string;
  block: number;
}

const hexOf = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

export async function fetchHeadBlock(rpc: readonly string[]): Promise<number> {
  const head = await evmRpc(rpc, 'eth_blockNumber', []);
  if (typeof head !== 'string' || !/^0x[0-9a-f]+$/i.test(head)) throw new Error('Malformed response');
  return Number(BigInt(head));
}

interface Log {
  topics?: unknown;
  data?: unknown;
  blockNumber?: unknown;
}

/**
 * Read the notes of blocks `from`..`to` (both included) and return the payments that are this
 * account's. Stretches are shortened when a node will not take them; if no node answers, this
 * throws and the caller keeps its place, so nothing is ever skipped.
 */
export async function scanStealth(
  rpc: readonly string[],
  keys: Pick<StealthKeys, 'view' | 'spendPub'>,
  from: number,
  to: number,
  onProgress?: (done: number, total: number) => void,
): Promise<StealthFind[]> {
  const found: StealthFind[] = [];
  let span = SPAN;
  let at = from;
  while (at <= to) {
    const end = Math.min(to, at + span - 1);
    let logs: unknown;
    try {
      logs = await evmRpc(rpc, 'eth_getLogs', [{ address: STEALTH_ANNOUNCER, topics: [ANNOUNCEMENT_TOPIC], fromBlock: `0x${at.toString(16)}`, toBlock: `0x${end.toString(16)}` }]);
      if (!Array.isArray(logs)) throw new Error('Malformed response');
    } catch (e) {
      if (span <= MIN_SPAN) throw e;
      span = Math.max(MIN_SPAN, Math.floor(span / 4));
      continue;
    }
    for (const log of logs as Log[]) {
      if (!Array.isArray(log.topics) || typeof log.data !== 'string') continue;
      const note = readAnnouncement(log.topics as string[], log.data);
      if (!note) continue;
      const mine = matchAnnouncement(keys, note.ephemeralPubKey, note.viewTag);
      // The note names the address it was left for; one that names another address is somebody's mistake or a trick.
      if (!mine || mine.address !== note.stealthAddress) continue;
      found.push({ address: mine.address, ephemeralPubKey: hexOf(note.ephemeralPubKey), block: typeof log.blockNumber === 'string' ? Number(BigInt(log.blockNumber)) : end });
    }
    at = end + 1;
    onProgress?.(at - from, to - from + 1);
  }
  return found;
}
