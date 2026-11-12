import './logo.css';

/**
 * The me7 logo: outlined letters. The outline is drawn once when the page opens,
 * then a streak of light keeps running along it.
 */
export function Logo() {
  return (
    <h1 class="lg" aria-label="me7">
      <svg viewBox="0 0 230 104" aria-hidden="true">
        <text x="2" y="80">me7</text>
        <text x="2" y="80" class="lg-run">
          me7
        </text>
        <text x="2" y="80" class="lg-draw">
          me7
        </text>
      </svg>
    </h1>
  );
}
