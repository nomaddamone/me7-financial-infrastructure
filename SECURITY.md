# Security

me7 holds people's money, so reports of weaknesses are welcome and taken seriously.

## Reporting

Please report privately, not in a public issue:

**[Report a vulnerability](https://github.com/nomaddamone/me7-financial-infrastructure/security/advisories/new)** (GitHub's private reporting; only the maintainers see it).

Say what you found, how to reproduce it, and what an attacker could do with it. We answer as soon as we can and tell you when the fix is live.

Please do not test against other people's wallets or funds, and do not load the service at me7.network to prove a point.

## What matters most

- Anything that could expose a recovery phrase, a private key, a key file's contents or a vault password.
- Anything that makes the wallet sign something other than what the screen shows.
- Anything that sends money to an address the user did not choose (address substitution, QR or payment-link parsing).
- A way around the Content-Security-Policy, or a way to load foreign code.
- A difference between this source and what https://me7.network serves (`sh verify.sh`).

## What is out of scope

- Phishing copies of the site on other domains. The only official address is https://me7.network.
- A device or browser that is already compromised (malware, a hostile extension with full page access).
- Denial of service against third-party nodes and APIs the wallet reads from.

## Why the code is public

So that anyone can check it. If you have looked through a part of it carefully, tell us what you found, even if it was nothing.
