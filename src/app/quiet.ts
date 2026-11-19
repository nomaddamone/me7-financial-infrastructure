/**
 * Addresses about which nothing may stay in this browser: those of an open vault.
 *
 * The wallet keeps small notes under an account's address (its history, its one-time addresses, what the
 * service said of it). For a vault that would be a trace: whoever opens the browser's storage would find an
 * address that is not the pocket's, and read its balance off the chain. So from the moment a vault is opened,
 * every note that names one of its addresses is kept in memory only. It serves the session as before, and is
 * gone when the page is.
 */
const quiet = new Set<string>();
const memory = new Map<string, string>();
let wrapped = false;

const mentions = (key: string): boolean => {
  const k = key.toLowerCase();
  for (const address of quiet) if (k.includes(address)) return true;
  return false;
};

export function hush(addresses: readonly string[]): void {
  for (const address of addresses) if (address.length >= 20) quiet.add(address.toLowerCase());
  if (!wrapped && typeof Storage !== 'undefined') {
    wrapped = true;
    const { getItem, setItem, removeItem } = Storage.prototype;
    Storage.prototype.getItem = function (key: string) {
      return mentions(String(key)) ? (memory.get(String(key)) ?? null) : getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (mentions(String(key))) memory.set(String(key), String(value));
      else setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string) {
      if (mentions(String(key))) memory.delete(String(key));
      else removeItem.call(this, key);
    };
    // What an earlier version left behind is taken out for good.
    const sweep = (store: Storage) => {
      try {
        for (let i = store.length - 1; i >= 0; i--) {
          const key = store.key(i);
          if (key && mentions(key)) removeItem.call(store, key);
        }
      } catch {
        /* no storage: nothing was kept */
      }
    };
    hush.sweep = () => (sweep(localStorage), sweep(sessionStorage));
  }
  hush.sweep?.();
}
hush.sweep = undefined as (() => void) | undefined;
