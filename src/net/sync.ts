import { signSync, type SyncKeys } from '../core/sync.ts';
import { SYNC_PATH } from './endpoints.ts';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function ask(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${SYNC_PATH}/${id}`, { ...init, signal: controller.signal });
    const body = (await res.json()) as unknown;
    if (typeof body !== 'object' || body === null) throw new Error('Malformed response');
    return body as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/** What the server keeps for this wallet: the version and the encrypted bytes, or version 0 and nothing. */
export async function pullSync(keys: SyncKeys): Promise<{ version: number; blob: Uint8Array | null }> {
  const body = await ask(keys.id);
  if (body.ok !== true || typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 0) throw new Error('sync unavailable');
  if (body.blob === null || body.version === 0) return { version: 0, blob: null };
  if (typeof body.blob !== 'string') throw new Error('Malformed response');
  return { version: body.version, blob: fromBase64(body.blob) };
}

/** Store encrypted bytes as a new version. Answers 'stale' when the server already holds that version or a later one. */
export async function pushSync(keys: SyncKeys, version: number, blob: Uint8Array): Promise<'stored' | 'stale'> {
  const body = await ask(keys.id, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version, blob: toBase64(blob), publicKey: keys.publicKey, signature: signSync(keys, version, blob) }),
  });
  if (body.ok === true) return 'stored';
  if (body.error === 'stale') return 'stale';
  throw new Error(`sync refused: ${String(body.error)}`);
}
