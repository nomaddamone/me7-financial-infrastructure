import { formatUnits } from '../net/balances.ts';
import type { AssetDef } from './assets.ts';
import './swapform.css';

/** One side of a swap: the coin chosen, as a button that opens the list to choose another. */
export function CoinButton({ asset, open, label, onToggle }: { asset: AssetDef; open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" class="swapf-coin" aria-expanded={open} aria-label={label} onClick={onToggle}>
      <span class="swapf-coin-name">{asset.ticker}</span>
      <span class="swapf-coin-net">{asset.net}</span>
      <span class="swapf-coin-mark" aria-hidden="true">
        {open ? '▴' : '▾'}
      </span>
    </button>
  );
}

/** The list a coin is chosen from: in groups, each coin with its network and what the wallet holds of it. */
export function CoinList({
  groups,
  chosen,
  balances,
  onPick,
}: {
  groups: { title: string; list: AssetDef[] }[];
  chosen: string;
  balances: Record<string, bigint>;
  onPick: (a: AssetDef) => void;
}) {
  return (
    <div class="swapf-list">
      {groups
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.title} class="swapf-group">
            {g.title && <span class="field-label">{g.title}</span>}
            <ul class="rows swapf-rows">
              {g.list.map((a) => (
                <li key={a.id}>
                  <button type="button" class="swapf-row" aria-pressed={a.id === chosen} onClick={() => onPick(a)}>
                    <span class="swapf-row-name">
                      {a.ticker} <span class="dim">{a.net}</span>
                    </span>
                    <span class="swapf-row-sum">{balances[a.id] !== undefined ? formatUnits(balances[a.id] as bigint, a.decimals, a.shown) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
