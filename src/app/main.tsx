import { render } from 'preact';
import { saveMode } from '../net/endpoints.ts';
import { App } from './App.tsx';
import './styles.css';

// On the developer's own machine only: /?testnet and /?mainnet switch the networks, for trying things with test coins.
// The built site has no such door.
if (import.meta.env.DEV && (location.search === '?testnet' || location.search === '?mainnet')) {
  saveMode(location.search === '?testnet' ? 'testnet' : 'mainnet');
  location.replace('/');
}

const root = document.getElementById('app');
if (root) {
  // The page arrives with a few lines of plain text for readers that run no scripts; the wallet takes their place.
  root.replaceChildren();
  render(<App />, root);
}
