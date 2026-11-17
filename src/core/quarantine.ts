/**
 * Quarantine of one address.
 *
 * Nobody can stop money from arriving: an address is public, and anyone may pay to it. What me7
 * can do is decline to carry what came from a bad source. So every payment that arrived on an
 * address of the wallet is looked at: who sent it. If the sender is under sanctions, frozen by
 * the coin's issuer, or on a public list of thieves, that one address goes into quarantine: me7's
 * service is not used from it, and its owner moves the money out by their own means. The wallet's
 * other addresses are untouched.
 *
 * What this sees is the direct sender only, and only the public lists. Money that passed through
 * someone else on its way is not seen. So an address without a mark is not "clean": it is an
 * address with no direct payment from a listed sender.
 */
export type Taint = 'sanctioned' | 'frozen' | 'scam';

/** One payment that arrived: on which address of the wallet, from whom, how much (in the coin's units). */
export interface Incoming {
  to: string;
  from: string;
  amount: bigint;
  block?: number;
  tx?: string;
}

export interface Mark {
  /** The wallet's address that is quarantined. */
  address: string;
  why: Taint;
  /** The listed sender, how much came from it in all, and one of the transactions that brought it. */
  from: string;
  amount: bigint;
  tx: string;
}

/**
 * Less than this from a listed sender is not counted (a dollar of a six-decimal coin). Without a
 * floor, anyone could switch off another person's address by sending it a cent.
 */
export const QUARANTINE_MIN = 1_000_000n;

/** Sanctions weigh most, then a freeze, then a list of thieves: an address listed twice is named by the gravest. */
const WEIGHT: Record<Taint, number> = { sanctioned: 3, frozen: 2, scam: 1 };

/**
 * Which of the wallet's addresses go into quarantine. Addresses are compared as written, so the
 * caller gives them in one spelling (lower case on EVM chains). What one sender paid to one
 * address in several payments is added up before it is held against the floor.
 */
export function quarantineMarks(incoming: readonly Incoming[], flagged: ReadonlyMap<string, Taint>, min: bigint = QUARANTINE_MIN): Mark[] {
  const sums = new Map<string, Mark>();
  for (const p of incoming) {
    const why = flagged.get(p.from);
    if (!why || p.amount <= 0n || p.from === p.to) continue;
    const key = `${p.to}<${p.from}`;
    const had = sums.get(key);
    sums.set(key, { address: p.to, why, from: p.from, amount: (had?.amount ?? 0n) + p.amount, tx: had?.tx || p.tx || '' });
  }
  const marks = new Map<string, Mark>();
  for (const m of sums.values()) {
    if (m.amount < min) continue;
    const had = marks.get(m.address);
    if (!had || WEIGHT[m.why] > WEIGHT[had.why] || (WEIGHT[m.why] === WEIGHT[had.why] && m.amount > had.amount)) marks.set(m.address, m);
  }
  return [...marks.values()];
}

/** The senders worth asking the lists about: those whose payments to one address reach the floor. */
export function sendersToScreen(incoming: readonly Incoming[], min: bigint = QUARANTINE_MIN): string[] {
  const sums = new Map<string, bigint>();
  for (const p of incoming) if (p.amount > 0n && p.from !== p.to) sums.set(`${p.to}<${p.from}`, (sums.get(`${p.to}<${p.from}`) ?? 0n) + p.amount);
  return [...new Set([...sums].filter(([, sum]) => sum >= min).map(([key]) => key.slice(key.indexOf('<') + 1)))];
}

/** keccak256("Transfer(address,address,uint256)"): the event every ERC-20 token leaves when it moves. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const topicOf = (address: string) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;

/** The question to a node: which transfers of `token` arrived on any of `owners` in this one block. */
export function incomingLogsFilter(token: string, owners: readonly string[], block: number): Record<string, unknown> {
  const at = `0x${block.toString(16)}`;
  return { address: token, topics: [TRANSFER_TOPIC, null, owners.map(topicOf)], fromBlock: at, toBlock: at };
}

/**
 * Read a node's answer to that question. Transfers between the wallet's own addresses are left
 * out: they bring nothing in. Throws on an answer that is not a list of transfer events.
 */
export function readIncomingLogs(answer: unknown, token: string, owners: readonly string[]): Incoming[] {
  if (!Array.isArray(answer)) throw new Error('Malformed response');
  const mine = new Set(owners.map((o) => o.toLowerCase()));
  const out: Incoming[] = [];
  for (const raw of answer as Record<string, unknown>[]) {
    const topics = raw?.topics;
    const data = raw?.data;
    if (!Array.isArray(topics) || topics.length !== 3 || topics[0] !== TRANSFER_TOPIC || typeof data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(data)) throw new Error('Malformed response');
    if (typeof raw.address !== 'string' || raw.address.toLowerCase() !== token.toLowerCase()) throw new Error('Malformed response');
    const [, fromTopic, toTopic] = topics as unknown[];
    if (typeof fromTopic !== 'string' || typeof toTopic !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(fromTopic) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(toTopic)) throw new Error('Malformed response');
    const from = `0x${fromTopic.slice(26).toLowerCase()}`;
    const to = `0x${toTopic.slice(26).toLowerCase()}`;
    if (!mine.has(to) || mine.has(from)) continue;
    const block = typeof raw.blockNumber === 'string' && /^0x[0-9a-fA-F]+$/.test(raw.blockNumber) ? Number(BigInt(raw.blockNumber)) : undefined;
    const tx = typeof raw.transactionHash === 'string' ? raw.transactionHash : undefined;
    out.push({ to, from, amount: BigInt(data), ...(block === undefined ? {} : { block }), ...(tx ? { tx } : {}) });
  }
  return out;
}
