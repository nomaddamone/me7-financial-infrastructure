import { useEffect, useState } from 'preact/hooks';
import { resolveName } from '../net/names.ts';

/**
 * The name an address is known to hold ("anna.base.eth"), as remembered on this device.
 * It is never taken on trust: before it is shown anywhere the blockchain is asked whether
 * the name still points at this very address.
 */
const keyOf = (address: string) => `me7.name.${address.toLowerCase()}`;
const CHANGED = 'me7:name';

/** Remember that `name` belongs to `address`, and let every place that shows it know. */
export function rememberOwnName(address: string, name: string): void {
  try {
    localStorage.setItem(keyOf(address), name);
  } catch {
    /* a browser that keeps nothing still works, it only forgets the name */
  }
  dispatchEvent(new Event(CHANGED));
}

export function useOwnName(address: string | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return setName(null);
    let live = true;
    const check = () => {
      let kept: string | null = null;
      try {
        kept = localStorage.getItem(keyOf(address));
      } catch {
        /* nothing kept */
      }
      if (!kept) return setName(null);
      resolveName(kept).then(
        (found) => live && setName(found && found.address.toLowerCase() === address.toLowerCase() ? found.name : null),
        () => undefined,
      );
    };
    check();
    addEventListener(CHANGED, check);
    return () => {
      live = false;
      removeEventListener(CHANGED, check);
    };
  }, [address]);
  return name;
}
