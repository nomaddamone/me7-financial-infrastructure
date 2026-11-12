import type { Dict } from './i18n.ts';
import './cta.css';

/**
 * A mark for the Ledger entry: corner brackets, the shape people know the
 * device's maker by, drawn here in the app's own line style.
 */
function LedgerMark() {
  return (
    <svg class="lmark" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 9V3h6M13 3h6v6M19 13v6h-6M9 19H3v-6" />
      <path d="M9 8v6h5" />
    </svg>
  );
}

/**
 * The actions on the start page: `new` and `login` as plain terminal lines,
 * and under them a quiet link for those who sign in with a Ledger.
 */
export function Cta({
  t,
  onCreate,
  onImport,
  onLedger,
}: {
  t: Dict;
  onCreate: () => void;
  onImport: () => void;
  onLedger: () => void;
}) {
  return (
    <div class="cta">
      <div class="term">
        <button class="cmd" onClick={onCreate}>
          <span class="cmd-name">new</span>
          <span class="cmd-desc">{t.create}</span>
        </button>
        <button class="cmd" onClick={onImport}>
          <span class="cmd-name">login</span>
          <span class="cmd-desc">{t.import}</span>
        </button>
      </div>
      <button class="lbtn" onClick={onLedger}>
        <LedgerMark />
        {t.ledger.entry}
      </button>
    </div>
  );
}
