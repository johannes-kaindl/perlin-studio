<!--
SPDX-FileCopyrightText: 2026 Johannes Kaindl
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Security reports

Perlin Studio is a **hobby project** with no security team, no SLA, and
no bug bounty. That said, I'm happy to receive reports about security-
relevant issues and try to address them promptly.

## In scope

- **Cross-site scripting** in any UI control (settings inputs, URL
  parameters, content rendered from `localStorage`).
- **Malformed WebM output** that `MediaRecorder` produces in such a way
  that opening it in a standard player could cause harm.
- **Worker isolation bypass** — the render worker exchanges buffers
  with the main thread; manipulated settings should never lead to code
  execution outside the sandbox.
- **CSP / same-origin bypass** when the live demo is embedded into
  third-party sites (e.g. iframe sandbox escapes).

If you're not sure whether something belongs here, please err on the
side of reporting.

## Out of scope

- General bug reports without security impact — please file a public
  issue: <https://git.jkaindl.de/jkaindl/perlin-studio/issues>.
- Browser bugs (Safari/Chrome/Firefox WebGL/WebM quirks with no security
  implication) — those belong with the vendors.
- General hardening suggestions without a concrete attack scenario —
  fine as a normal issue with the `enhancement` label.

## How to report

**Preferred:** email to **security@jkaindl.de**. Please don't open a
public issue for anything with security impact — the issue tracker on
`git.jkaindl.de` has no confidential mode, so a report filed there is
world-readable from the moment you submit it.

**There is no platform channel any more.** The GitHub mirror was removed on
2026-09-05 (GitHub now stays only where the Obsidian store chain requires it),
so email is the confidential route. If you would rather not use email, say so
in a normal issue without any detail and we will arrange something.

Machine-readable contact info:
[`.well-known/security.txt`](https://pages.jkaindl.de/perlin-studio/.well-known/security.txt)
(RFC 9116).

PGP isn't set up; for sensitive reports I can publish a key on request.

## What to expect

- **Acknowledgement** within 7 days.
- **First assessment** (reproduction, severity, planned approach)
  within 14 days.
- **Fix or documented workaround** as quickly as is realistic for a
  hobby project — critical: days, normal: weeks.
- **Credit** in `CHANGELOG.md` and release notes if you'd like.

## Scope and threat model

Perlin Studio is **fully client-side**:

- No backend, no server calls, no external API keys.
- No auth, no sessions, no multi-user data.
- Settings + presets in the browser's `localStorage`.
- WebM export runs entirely in the browser via `MediaRecorder`.

Reports that violate these assumptions (covert network calls, tracking,
synced data) are very much in scope and especially welcome.

## Known design decisions that aren't bugs

- **No CSP header on the live demo.** The site is served as static files
  by Caddy on `pages.jkaindl.de`, which currently sends no custom
  security headers. Unlike the previous Codeberg Pages hosting this is
  now a setting we control, so it may change; the code does not rely on
  it either way. Mitigation: no inline `<script>` constructs with user
  input, no `eval`.
- **WebM export size is unbounded.** Long captures can grow to several
  hundred MB; that's intentional. Not a DoS bug.
- **No update strategy for stored presets.** Users with presets in
  localStorage may not see new fields after an update — deliberate, to
  avoid migration complexity.
