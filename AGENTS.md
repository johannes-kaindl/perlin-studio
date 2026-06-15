# AGENTS.md — context for AI agents

> **Workspace-Standards:** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> (am Workspace-Root `/Users/Shared/code/`), Modell comply-or-explain. Dokumentierte
> Abweichungen + erledigte/offene Punkte siehe Abschnitt
> [Abweichungen von der Leitkonvention](#abweichungen-von-der-leitkonvention).

This file is aimed at AI assistants (Claude Code, Cursor, Aider, …) that
work on this repo. Humans contributing here will find what they need in
[`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and
[`docs/`](docs/).

## Project character

**Perlin Studio** is a single-page browser tool for parametric 3D/4D
Perlin animations. Vanilla JS, no dependencies, no backend, no build
step. Works by double-clicking `index.html` (`file://`) and on any
static webhost.

A native macOS companion app (`macos/`) — *Perlin Live Wallpaper* — renders the
same noise live as an animated desktop background (Swift + Metal, public AppKit
only). See [`macos/README.md`](macos/README.md) and the distribution guide
[`docs/MACOS-APP.md`](docs/MACOS-APP.md).

Zero-dependency / no-build is a **deliberate feature** (PROF-WEB-01): the tool
must stay statically deployable and embeddable as a Web Component. Don't migrate
to TypeScript, a bundler, or a framework without discussing it with the
maintainer first — Vanilla-JS constancy is the point.

## Architecture principles

### Module layering

Five plain scripts, each attaching a `window` global, loaded in order
(`file://`-safe, no ES modules):

1. `perlin.js` → `MTPerlin` — math + `WORKER_SOURCE`.
2. `perlin-presets.js` → `MTPerlinPresets` — `GRADIENTS`, `BUILTIN_PRESETS`,
   `resolveParams` (named gradient → concrete stops).
3. `perlin-engine.js` → `PerlinEngine` — headless renderer: owns the worker,
   the RAF loop, and FPS smoothing. Consumers pass `onTick` / `onFrame` /
   `transformFrame` callbacks.
4. `perlin-studio.js` and `perlin-element.js` are **consumers** of the engine.
   The studio is the full editor; `<perlin-noise>` is the embeddable
   renderer-only element. Keep render/animation logic in the engine, not
   duplicated in either consumer.

### Style boundaries

- **No dependencies** without a specific reason. A 12-KB library for one feature
  is OK, but discuss with the maintainer first.
- Defensive programming **only at external boundaries** (user input, file
  upload). Trust internal data flow.
- Comments explain **why**, not *what*. Code should be readable without comments;
  comments cover the non-obvious, edge cases, math background.

### File layout

```
.
├── index.html             # UI markup
├── styles.css             # all styling (dark + light, system-following with toggle override)
├── perlin.js              # math/API (noise, color modes, worker source)
├── perlin-presets.js      # gradients, built-in presets, resolveParams (shared)
├── perlin-engine.js       # headless render engine (worker lifecycle + RAF loop)
├── perlin-studio.js       # controller (UI bindings, recording, presets) — consumes the engine
├── perlin-element.js      # <perlin-noise> embeddable renderer-only custom element
├── manifest.webmanifest   # PWA manifest (installable)
├── assets/                # static assets (favicon.svg, icon-{192,512}.png,
│                          #   apple-touch-icon.png, hero.png, gallery-*.png
│                          #   + legacy default-atlas.webp for the archive)
├── examples/
│   ├── embed.html         # <perlin-noise> embedding demo
│   └── marble.json        # resolved preset export for the src demo
├── scripts/
│   ├── check-syntax.mjs        # syntax gate (external perlin*.js + inline <script>), gates CI deploy
│   ├── smoke-test.js           # math + resolveParams invariants, gates CI deploy
│   ├── bump-version.sh         # native version bump (macos/packaging/Info.plist)
│   ├── render-readme-images.js # renders assets/*.png from perlin.js
│   ├── render-guide-images.js  # renders docs/images/*.png for USAGE.md
│   ├── render-readme-videos.js # renders docs/examples/*.webm (Node → ffmpeg)
│   └── build-standalone.js     # inlines the studio into a single HTML file
├── macos/                 # native companion app (Swift + Metal); see macos/README.md
├── _archiv/               # historical predecessors (READ-ONLY!)
│   ├── perlin_noise/      # Python original
│   ├── texturizer.ipynb   # Texturizer notebook
│   └── old_texturizer_combined/   # first browser version
├── docs/
│   ├── ARCHITECTURE.md    # technical docs
│   ├── USAGE.md           # full user guide
│   ├── MACOS-APP.md       # native app distribution + Gatekeeper guide
│   └── examples/          # rendered WebM loops (for README + embedding)
├── .editorconfig          # consistent indentation/encoding/EOL
├── .forgejo/
│   └── workflows/         # Codeberg Pages auto-deploy
├── .gitea/
│   └── issue_template/    # bug report + feature request forms
├── README.md              # quickstart + entry point
├── CONTRIBUTING.md        # developer workflow
├── SECURITY.md            # threat model + reporting
├── CHANGELOG.md
├── LICENSE                # AGPL-3.0 (code)
├── LICENSE-DOCS           # CC BY-SA 4.0 (documentation)
└── AGENTS.md              # this file
```

**`_archiv/` is off-limits for active changes.** These files document the
project's genealogy and may only be added to (e.g. when another snapshot is
preserved), never edited or deleted.

### Glossary

| Term | Meaning |
|------|---------|
| **fBm** | Fractal Brownian Motion — sum of Perlin octaves with decreasing amplitude and increasing frequency |
| **Octave** | A frequency level in fBm. More octaves = more detail, more compute |
| **Persistence** | Amplitude factor between octaves (typically 0.5) |
| **Lacunarity** | Frequency factor between octaves (typically 2.0) |
| **scaleT** | UI label **"Time scale"** — scales the time axis of the noise. Default 0.15 |
| **loop** | When `true`: 4D path with a circular orbit in `(z, w)`. When `false`: 3D path with linear `t` |
| **loopProgress** | Current position on the circular orbit in `[0, 1)`. Becomes `α = 2π·progress` |
| **loopRadius** | How far the image travels over one full rotation |
| **safeProgress** | `((p % 1) + 1) % 1` — protects the loop identity against the float-rounding of `Math.sin(2π)` |
| **Worker source** | The full `perlin.js` code as a string in `MTPerlin.WORKER_SOURCE`. Loaded into an inline Blob worker — `file://`-compatible |

## Commands

There is **no full test suite**. Instead:

1. **Syntax gate** — parses every deployable script (the external `perlin*.js`
   plus inline `<script>` blocks in `index.html` / `examples/`) without executing
   it (PROF-WEB-03):
   ```bash
   node scripts/check-syntax.mjs
   ```
   The Forgejo deploy workflow runs this before publishing.
2. **Math smoke tests** for Perlin changes:
   ```bash
   node scripts/smoke-test.js
   ```
   Covers permutation determinism, value range of `perlin3`/`perlin4`, loop
   identity at `progress=0` vs `progress=1` (both bytewise and bit-exact at the
   float level), Z/W axis independence, and `colorize` range. The Forgejo deploy
   workflow gates on this — if smoke tests fail, the site does not get
   republished. For deeper investigations the same pattern
   (`global.window = {}` + require `perlin.js`) works for ad-hoc scripts.
3. **Manual browser test** — `python3 -m http.server` and click around.

> Sandbox note: the permission setup may forbid starting an HTTP server from
> `/Users/Shared/`. If you hit that, ask the user to test it themselves.

### macOS app

```bash
cd macos
swift build && swift run                          # build + run the live wallpaper
swift run PerlinLiveWallpaper --selftest          # headless render-all-presets check
./scripts/build-app.sh [--notarize]               # package signed (+ notarized) .app
```

Native release version bump (from the **repo root**, before tagging):
`bash scripts/bump-version.sh X.Y.Z`. Full distribution guide:
[`docs/MACOS-APP.md`](docs/MACOS-APP.md).

## Conventions

### Language

- **Everything is English**: UI strings, code comments, identifiers, commit
  messages, PR descriptions, issue templates, docs. Matches the rest of the
  author's Codeberg repos.
- Math terms (Octaves, Persistence, Lacunarity, fBm) keep their standard form.
- No emojis in code/docs unless the user explicitly asks.

### Git

- **Conventional Commits** (`feat/fix/docs/chore/refactor/test(scope): …`);
  commit body may be German (CORE-GIT-04).
- **Codeberg primary** (`codeberg` remote = `codeberg.org/jkaindl/perlin-studio`),
  **GitHub mirror** (`github` = `github.com/johannes-kaindl/perlin-studio`) for
  the public repo (CORE-GIT-01). Push both on release.
- **Tags: SemVer without `v`-prefix** for new tags (`0.2.0`); existing `v`-tags
  stay (CORE-GIT-03).
- Stage only touched files, **never `git add -A`** (CORE-GIT-06).
- AI-assisted commits carry the trailer
  `Co-Authored-By: Claude Opus <version> (1M context) <noreply@anthropic.com>`
  (CORE-GIT-05).

### When you change something

1. **Mind the flow.** Don't commit performance tweaks in `perlin3`/`perlin4`
   without sanity checks. Subtle math bugs look visually normal until the loop
   stops closing or edges start flickering.
2. **Keep UI strings English.** Including any new buttons/sections.
3. **Update `CHANGELOG.md`** for every user-visible feature/fix (keep-a-changelog).
4. **No cosmetic changes in `_archiv/`.**

## Gotchas

### Math bug class 1: float rounding at loop endpoints

`Math.sin(2π)` is not `0` but about `-2.4e-16`. `Math.floor(-1.7e-16)` is `-1`,
which masks to `255` in the hash lookup — a *completely different* image. Fix:
`safeProgress = ((p % 1) + 1) % 1`.

### Math bug class 2: Z/W axis swap in `perlin4`

In the 4D hash tree, `AAB` and `AAA+1` are different constructs:
`AAB = perm[AA+1]+W` is a **Z shift**, `AAA+1 = perm[AA]+W+1` is a **W shift**.
The offsets must line up: `AAB` uses `z-1`, `AAA+1` uses `w-1`. The outer lerp is
over `tt` (W), not `s` (Z).

### Animation bug: `t` progress too fast

The initial implementation had `t += fps` per second — 30× too fast. The correct
version is `t += 1` per second, and `scaleT` scales that in noise space. So the
per-frame step is ~`scaleT / fps` ≈ 0.005 — a soft ripple instead of a flicker.

### Worker CSP

Under `file://`, some browsers block the worker. The code automatically falls
back to main-thread rendering (see `initWorker` / `renderInMain`). While
debugging, watch whether the FPS counter says "(main)" — if so, the fallback is
active.

### Worker communication patterns

- **Never queue frames.** `requestFrame` skips if `state.workerBusy` is still
  `true`. Recordings use `renderFrameAndWait`, which synchronizes via
  `state.pendingResolves`.
- **Use transferables.**
  `postMessage({ ..., buffer: buf.buffer }, [buf.buffer])` → zero-copy back.

## Memory

- **Project memory (Daemon pointer layer):**
  `~/.claude/projects/-Users-Shared-code-perlin-studio/memory/MEMORY.md` — the
  index loaded each session (CORE-AGENT-02).
- **Coding-Cockpit (SSOT):** `10_Pallas/25_Coding/perlin-studio/perlin-studio.md`
  in the Obsidian vault — status · tasks · decisions · history. The Daemon memory
  points here.
- **Session handoff:** `.remember/` (gitignored, CORE-AGENT-03) — `remember.md`
  handoff + `now.md` / `recent.md` / `archive.md` buffers.
- **Specs & plans:** `docs/superpowers/{specs,plans}/` (CORE-AGENT-04).

## Abweichungen von der Leitkonvention

Profile: **web-static · native** (+ KERN). Abgeglichen gegen
`_docs/CONVENTIONS.md` (comply-or-explain).

- **PROF-NAT-02** *(adaptiert)* — Kein `package.json`: das Web-Frontend ist
  no-build/zero-dep (PROF-WEB-01), es gibt keine maschinenlesbare Web-Version
  (die Studio-Historie lebt im `CHANGELOG.md`). Die einzige versionierte native
  Artefakt-Quelle ist `macos/packaging/Info.plist`; `scripts/bump-version.sh`
  hält dort `CFBundleShortVersionString` + `CFBundleVersion` self-consistent. Es
  gibt keinen zweiten Versionsort, daher entfällt die package.json-Synchronisation.
- **PROF-WEB-04** *(N/A)* — Die installierbare PWA hat bewusst **keinen**
  Service-Worker / Offline-Cache; es existiert keine SW-Cache-Version zum Bumpen.

### Erledigte Konventions-Punkte (vormals offen)

- [x] CORE-META-08 — `LICENSE-DOCS` (CC BY-SA 4.0) für Text/Doku angelegt.
- [x] CORE-GIT-01 — GitHub-Mirror-Remote (`github`) eingerichtet.
- [x] CORE-AGENT-01 — Kanonisches Sektions-Skelett (diese Datei).
- [x] PROF-WEB-03 — `node --check`-Syntax-Gate (`scripts/check-syntax.mjs`) + CI-Step.
- [x] PROF-NAT-02 — `scripts/bump-version.sh` (siehe Abweichung oben).
- [x] PROF-NAT-03 — `docs/MACOS-APP.md` (Signing/Notarization/Gatekeeper).

## Extension roadmap (nice-to-have)

Shipped since the original roadmap: gradient editor (custom color stops),
tileable noise, per-channel noise, flow field, domain warp, mask + layers, the
`<perlin-noise>` Web Component, and the macOS companion app. Still open ideas
(sync with the maintainer first on scope/approach):

- GIF export (`gif.js`, ~12 KB)
- Obsidian plugin port
