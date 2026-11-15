/**
 * Address poisoning: a stranger makes an address whose first and last characters match one
 * the user already pays to, and sends a small transfer from it, hoping the user will later
 * copy it from the history instead of the real one. Shortened on a screen the two look the
 * same. This tells such a twin from the address it imitates.
 */

/** What is left to compare once the part every address of the network shares is taken off. */
function body(address: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return address.slice(2).toLowerCase();
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return address.slice(1);
  return address;
}

/** True when the two addresses differ and yet would pass for each other at a glance. */
export function resembles(a: string, b: string): boolean {
  const x = body(a);
  const y = body(b);
  if (x === y || x.length !== y.length || x.length < 20) return false;
  let head = 0;
  while (head < x.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  // A chance match of six characters is one in millions; people compare far fewer than that.
  return (head >= 2 && tail >= 4) || tail >= 6 || head >= 7;
}

/** The known address this one imitates, if it is not itself among the known ones. */
export function lookalikeOf(address: string, known: readonly string[]): string | null {
  const me = body(address);
  if (known.some((k) => body(k) === me)) return null;
  return known.find((k) => resembles(address, k)) ?? null;
}
