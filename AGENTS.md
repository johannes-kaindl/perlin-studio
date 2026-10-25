# AGENTS.md — context for AI agents

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain. Dokumentierte Abweichungen siehe Abschnitt [Abweichungen von der Leitkonvention](#abweichungen-von-der-leitkonvention).

This file is aimed at AI assistants (Claude Code, Cursor, Aider, …) that work on this repo. Humans contributing here will find what they need in [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`docs/`](docs/).

## Project character

**Perlin Studio** is a single-page browser tool for parametric 3D/4D Perlin animations. Vanilla JS, no dependencies, no backend, no build step. Works by double-clicking `index.html` (`file://`) and on any static webhost.

Two native companions reuse the same noise: *Perlin Live Wallpaper* (`macos/`, Swift + Metal, public AppKit only) and *Perlin Live Photo* (`ios/`, SwiftUI + Metal, reuses the macOS portable core by file reference).

Zero-dependency / no-build is a **deliberate feature** (PROF-WEB-01): the tool must stay statically deployable and embeddable as a Web Component. Don't migrate to TypeScript, a bundler, or a framework without discussing it with the maintainer first — Vanilla-JS constancy is the point.

## Architecture principles

- **Five plain scripts, each attaching a `window` global, loaded in order** (`file://`-safe, no ES modules): `perlin.js` → `perlin-presets.js` → `perlin-engine.js` → the consumers `perlin-studio.js` and `perlin-element.js`; `perlin-export.js` is pure compositing math. `perlin-gl.js` is an optional WebGL2 port of the noise maths that `PerlinEngine` can route frames through.
- **Render/animation logic lives in `PerlinEngine`**, not duplicated in the studio or the `<perlin-noise>` element.
- **No dependencies** without a specific reason. A 12-KB library for one feature is OK, but discuss with the maintainer first.
- Defensive programming **only at external boundaries** (user input, file upload). Trust internal data flow.
- Comments explain **why**, not *what*. Code should be readable without comments; comments cover the non-obvious, edge cases, math background.
- **`_archiv/` is off-limits for active changes.** It documents the project's genealogy and may only be added to, never edited or deleted.

## Context index

- Before reading or changing `perlin*.js` (the GLSL port `perlin-gl.js` included) or `scripts/smoke-test.js`: read `.claude/rules/perlin-core.md` (math bug classes, animation step, worker rules, GPU parity). It also loads by itself in Claude Code.
- Before adding or moving a file, or when a term is unclear (fBm, loopProgress, safeProgress, scaleT): read `docs/internal/architecture.md` (module layering, file layout, glossary).
- Before asking why something is the way it is (zero-dep, deploy guards, `v` tag prefix, hero.png over budget, single remote): read `docs/internal/decisions.md`.
- Before changing the math, the worker pipeline or the loop mechanics: read `docs/explanation/architecture.md`.
- Before changing the UI: read `docs/internal/ui-spec.md`; for the embeddable element: `docs/internal/web-component-spec.md`.
- Before a macOS or iOS release or notarization: read `docs/how-to/install-the-macos-app.md`, `macos/README.md`, `ios/README.md`.
- Before writing or moving user documentation: read `docs/README.md` (the Diátaxis index: tutorial, how-to, reference, explanation — a page belongs in exactly one).
- Before changing what the repo delivers (export formats, example loops, the standalone bundle): read `ANGEBOT.md`.

## Commands

There is **no full test suite**. Instead:

1. **Syntax gate** — parses every deployable script (external `perlin*.js` plus inline `<script>` blocks in `index.html` / `examples/`) without executing it (PROF-WEB-03): `node scripts/check-syntax.mjs`
2. **Math smoke tests** for Perlin changes: `node scripts/smoke-test.js`. Covers permutation determinism, value range of `perlin3`/`perlin4`, loop identity at `progress=0` vs `progress=1` (bytewise and bit-exact), Z/W axis independence, and `colorize` range. For ad-hoc scripts the same pattern works (`global.window = {}` + require `perlin.js`).
3. **Path hygiene gate** — no absolute maintainer paths in tracked Markdown: `node scripts/check-no-abs-paths.mjs`
4. **GPU parity** (by hand, after touching `perlin-gl.js` or the maths in `perlin.js`; needs Playwright, see the script header): `node scripts/check-gl-parity.mjs` — renders each case on the CPU and the GPU path in a real browser and compares. Exit 2 = skipped.
5. **Manual browser test** — `python3 -m http.server` and click around. The permission setup may forbid starting an HTTP server from the repo's location; if so, ask the user to test it themselves.

**Deploy:** `bash scripts/deploy-page.sh` runs gates 1–3, snapshots committed `HEAD` via `git archive` and rsyncs it to `pages.jkaindl.de/perlin-studio/`. It needs real rsync 3.x (`brew install rsync`; macOS ships `openrsync`). The script carries four macOS deploy guards (CORE-OPS-01); don't remove them.

**macOS app:** `cd macos && swift build && swift run`, headless check `swift run PerlinLiveWallpaper --selftest`, package with `./scripts/build-app.sh [--notarize]`. Version bump from the repo root before tagging: `bash scripts/bump-version.sh X.Y.Z`.

## Conventions

- **Everything is English**: UI strings (including new buttons/sections), code comments, identifiers, commit messages, PR descriptions, issue templates, docs. Math terms (Octaves, Persistence, Lacunarity, fBm) keep their standard form. No emojis in code/docs unless the user explicitly asks.
- **Conventional Commits** (`feat/fix/docs/chore/refactor/test(scope): …`); commit body may be German (CORE-GIT-04).
- **One remote:** Forgejo (`origin` = `git@git.jkaindl.de:jkaindl/perlin-studio.git`), no mirror since 2026-09-05 (CORE-GIT-01).
- **Tags: SemVer with `v`-prefix** (`vX.Y.Z`), a documented deviation from CORE-GIT-03.
- Stage only touched files, **never `git add -A`** (CORE-GIT-06).
- AI-assisted commits carry the trailer `Co-Authored-By: Claude Opus <version> (1M context) <noreply@anthropic.com>` (CORE-GIT-05).
- **Update `CHANGELOG.md`** for every user-visible feature/fix (keep-a-changelog).
- **Mind the flow:** subtle math bugs look visually normal until the loop stops closing or edges start flickering (details in `.claude/rules/perlin-core.md`).

## Memory

- **Project memory:** `~/.claude/projects/-Users-johannes-Projects-jkaindl-apps-perlin-studio/memory/MEMORY.md` — the index loaded each session (CORE-AGENT-02).
- **Coding-Cockpit (SSOT):** `$VAULT/25_Coding/perlin-studio/perlin-studio.md` (CORE-META-14, maintainer-local; `$VAULT` = the maintainer's Obsidian vault) — status · tasks · decisions · history. Specs, plans and task reports live in its `_SDD/`, not in the repo.
- **Session handoff:** `.remember/` (gitignored, CORE-AGENT-03).
- **Specs, plans and design briefs** live in the cockpit `_SDD/`, never in `docs/` (the old `docs/superpowers/` and design docs moved there on 2026-10-26).
- **Never in the repo:** absolute paths outside the repo (`/Users/…`, vault paths) — use placeholders (`$VAULT/…`, `~/…`, repo-relative).

## Abweichungen von der Leitkonvention

Profile: **web-static · native** (+ KERN). Abgeglichen gegen `_docs/CONVENTIONS.md` (comply-or-explain). Das Warum steht in `docs/internal/decisions.md`.

- **PROF-NAT-02** *(adaptiert)* — Kein `package.json`: das Web-Frontend ist no-build/zero-dep (PROF-WEB-01), es gibt keine maschinenlesbare Web-Version (die Studio-Historie lebt im `CHANGELOG.md`). Die einzige versionierte native Artefakt-Quelle ist `macos/packaging/Info.plist`; `scripts/bump-version.sh` hält dort `CFBundleShortVersionString` + `CFBundleVersion` self-consistent. Es gibt keinen zweiten Versionsort, daher entfällt die package.json-Synchronisation.
- **image-budget (assets/hero.png)** *(bewusste Ausnahme)* — `hero.png` ist 1200×630, weil `index.html` es als `og:image` mit dieser Größe ausweist, und liegt damit bei ~563 KB über dem 400-KB-Budget (verlustfrei gemessen: 832 → 576 KB mit `oxipng -o max -Z`, mehr gibt das Rauschen nicht her). Die sechs Galeriebilder liegen unter dem Budget (560 px, `oxipng` im Render-Skript). Der Linter wiegt `assets/` heute nicht (`_images_dir()`); sobald er es tut, meldet er `hero.png` — dann ist diese Zeile der Grund.
- **PROF-WEB-04** *(N/A)* — Die installierbare PWA hat bewusst **keinen** Service-Worker / Offline-Cache; es existiert keine SW-Cache-Version zum Bumpen.
