import { render } from 'preact';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('app');
if (root) {
  // The page arrives with a few lines of plain text for readers that run no scripts; the wallet takes their place.
  root.replaceChildren();
  render(<App />, root);
}
