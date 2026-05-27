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
  issue: <https://codeberg.org/jkaindl/perlin-studio/issues>.
- Browser bugs (Safari/Chrome/Firefox WebGL/WebM quirks with no security
  implication) — those belong with the vendors.
- General hardening suggestions without a concrete attack scenario —
  fine as a normal issue with the `enhancement` label.

## How to report

**Preferred:** private Codeberg issue in this repo, or DM via Codeberg
to [@jkaindl](https://codeberg.org/jkaindl). Codeberg supports private
issues — tick the privacy box when filing.

**Alternative:** email to the address listed on the
[Codeberg profile](https://codeberg.org/jkaindl).

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

- **No CSP header on the live demo.** Codeberg Pages serves pages
  without custom headers. Mitigation: no inline `<script>` constructs
  with user input, no `eval`.
- **WebM export size is unbounded.** Long captures can grow to several
  hundred MB; that's intentional. Not a DoS bug.
- **No update strategy for stored presets.** Users with presets in
  localStorage may not see new fields after an update — deliberate, to
  avoid migration complexity.
