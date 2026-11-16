<div align="center">

# me7

**financial infrastructure**

A self-custody web wallet. Your keys are created, kept and used in your browser and nowhere else.

[**me7.network**](https://me7.network) · [Русская версия](README.ru.md) · [Security](SECURITY.md) · [License](LICENSE.md)

[![tests](https://github.com/nomaddamone/me7-financial-infrastructure/actions/workflows/test.yml/badge.svg)](https://github.com/nomaddamone/me7-financial-infrastructure/actions/workflows/test.yml)

</div>

---

> Nobody guarantees your safety: not a bank, not an exchange, not me7. Your only guarantee is yourself. Don't take our word for it.

This repository is that sentence put into practice. It holds the complete source of the wallet that runs at [me7.network](https://me7.network): everything that touches your keys, builds your transactions and draws your screens. You can read it, run it, test it, and check that the site serves exactly this code.

The only official address of me7 is **https://me7.network**. Anything else that carries the name is not ours.

## What the wallet does

| | |
|---|---|
| **The key inside a file** | The account is a file and a password. The key can hide inside your own photo, PDF or song; the file still opens as usual. |
| **The vault** | A vault password is not compared with a stored one. It is turned by mathematics into a separate wallet. Another password opens another, empty vault. |
| **USDC without ETH** | You sign a USDC transfer on Base with your own key and me7 covers the network gas. One plain fee, shown before you confirm. |
| **USDT without TRX** | A USDT transfer on Tron from an address with no TRX: me7 pays the network, the fee is taken in USDT and shown before you confirm. |
| **Address rotation** | After every payment received the wallet hands out a new address. A payer sees their own transfer, not your whole balance. |
| **Stealth addresses** | One code that never changes (ERC-5564): the payer's wallet makes a new address from it for every USDC payment, and only the receiver can find and spend it. Such an address never needs ETH. |
| **Address selection** | Money sits on several addresses, like coins in a Bitcoin wallet. A payment takes as many as it needs and leaves the rest untouched. |
| **Transit address** | Money is gathered on a fresh one-time address and leaves from there, in one operation. |
| **Cold signing** | With a Ledger the key never leaves the device. Every transfer is read on its screen; nothing is signed blind. |
| **P2P cash-out** | USDC is sold straight to a person through the open Peer protocol. |
| **Encrypted contacts** | The address book is encrypted in the browser with a key from your phrase before it goes anywhere. A contact can be an address or a stealth code. |
| **Address screening** | Before USDC is sent, every address is checked against scam and sanctions lists. |
| **Look-alike and freeze warnings** | An address made to pass for one you already pay to is called out before you send and hidden from the history. Before USDT moves on Tron, the token's own freeze list is asked about both sides. |
| **Batch payment** | Several recipients in one operation: all of them are paid or none is. Stealth codes can be among them. |
| **Names** | Sending to a name such as anna.base.eth, and a name of your own for the main address, paid in USDC. |
| **Ten seconds to cancel** | After you confirm, a transfer waits ten seconds and can be cancelled; once sent, a receipt is shown. |
| **Branded QR and scanner** | A receiving code with an eight-digit address code to compare by eye or by voice; a scanner that acts only on addresses and payment links. |

Networks and coins: Base (USDC, ETH, cbBTC), Ethereum (ETH, USDT, USDC, DAI, LINK, WBTC), Tron (TRX, USDT), Bitcoin.

## How it is built

- **No third-party code near the keys.** Cryptography comes from the audited [noble](https://paulmillr.com/noble/) and [scure](https://github.com/paulmillr/scure-base) libraries, pinned to exact versions. The interface is [Preact](https://preactjs.com). There are no analytics, no trackers, no remote scripts, no web fonts.
- **A strict Content-Security-Policy.** The built site may run only its own code and talk only to the endpoints listed in [`src/net/endpoints.ts`](src/net/endpoints.ts).
- **Install scripts are off.** `.npmrc` sets `ignore-scripts=true`, so a dependency cannot run code at install time.
- **Signatures are checked against an independent implementation.** The tests compare what the wallet signs with [ethers](https://ethers.org), byte for byte. ethers is used in tests only and is not part of the site.
- **Signed releases.** Every release of the site is a list of files with their SHA-256, signed by a key that is not on the server. The server refuses anything unsigned and takes the site off the air if a file changes.

## Check that the site serves this code

Build the source and compare it with what me7.network sends to your browser:

```bash
npm ci
```

```bash
sh verify.sh
```

The script builds the site, downloads the live `index.html` and every script and style it refers to, and compares SHA-256 sums. `match` on every line means the site runs the code you are looking at.

Builds are compared with Node 26 and the versions in `package-lock.json`. If the site was released a few minutes ago and this repository has not caught up yet, the sums differ until the source of that release is pushed here.

## Run it yourself

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run typecheck
```

Sending USDC on Base without ETH, sending USDT on Tron without TRX and syncing contacts need me7's own service and work only on me7.network. Everything else works from a local copy.

## Where things are

| Path | What is there |
|---|---|
| [`src/core`](src/core) | Keys and signing, with no network access: entropy, recovery phrase, key file, vault, HD derivation, EVM / Tron / Bitcoin transactions, Ledger, signed USDC permissions, address rotation, stealth addresses, the look-alike check, contact encryption, QR payloads. |
| [`src/net`](src/net) | Everything that talks to the outside: nodes, balances, history, prices, swap, Peer. Every address the wallet may contact is in `endpoints.ts`. |
| [`src/app`](src/app) | The interface: screens, texts in Russian and English, styles. |
| [`test`](test) | Tests of all of the above. |

## What is not here

The configuration of our server, the release tooling, and the server side of the service that pays the gas and stores encrypted contacts are not published. They never see your keys: what leaves your browser is either a transaction you have signed or data you have encrypted, and this repository shows exactly how.

## Status

me7 is a program, and its code is here for anyone to check. Keep in it as much as you are prepared to trust to a program.

## Security

Found a weakness? Please report it privately: see [SECURITY.md](SECURITY.md).

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): you may read, run, study and change the code for any noncommercial purpose. Commercial use needs our permission.

The name "me7", the logo and the domain are not covered by the license. A copy must not present itself as me7.

Required Notice: Copyright me7 (https://me7.network)
