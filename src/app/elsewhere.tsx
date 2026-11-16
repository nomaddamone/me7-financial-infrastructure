import { useEffect, useState } from 'preact/hooks';
import { pocketOf } from '../core/rotation.ts';
import { formatUnits } from '../net/balances.ts';
import { loadRotation } from './addresses.ts';
import type { Dict } from './i18n.ts';
import type { Wallet } from './wallet.ts';

/**
 * A line for the screens that work from the main address only (swap, P2P
 * withdrawal): if part of the wallet's USDC sits on its other addresses, say
 * how much and where to bring it over. Shows nothing when there is none.
 */
export function UsdcElsewhere({ t, wallet }: { t: Dict; wallet: Wallet }) {
  const [amount, setAmount] = useState(0n);
  useEffect(() => {
    let live = true;
    loadRotation(wallet).then(
      // Stealth money is left out: it is not brought onto the main address, which would tie it to it.
      (r) => live && setAmount(r.holdings.reduce((sum, h) => (h.index === 0 || pocketOf(h) === 'stealth' ? sum : sum + h.balance), 0n)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wallet]);
  if (amount <= 0n) return null;
  return <p class="note">{t.gasless.elsewhere.replace('{sum}', formatUnits(amount, 6, 2))}</p>;
}
