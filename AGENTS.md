# AGENTS.md — context for AI agents

This file is aimed at AI assistants (Claude Code, Cursor, Aider, …) that
work on this repo. Humans contributing here will find what they need in
[`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and
[`docs/`](docs/).

## TL;DR

**Perlin Studio** is a single-page browser tool for parametric 3D/4D
Perlin animations. Vanilla JS, no dependencies, no backend, no build
step. Works by double-clicking `index.html` (`file://`) and on any
static webhost.

## Important conventions

### Language

- **Everything is English**: UI strings, code comments, identifiers,
  commit messages, PR descriptions, issue templates, docs. Matches the
  rest of the author's Codeberg repos.
- Math terms (Octaves, Persistence, Lacunarity, fBm) keep their standard
  form.

### Style

- **No dependencies** without a specific reason. Rationale: the tool
  must stay statically deployable and embeddable as a Web Component.
  A 12-KB library for one feature is OK, but discuss with the
  maintainer first.
- **No tooling migration** (TypeScript, bundler, framework) without
  discussion. Vanilla-JS constancy is a feature.
- Defensive programming **only at external boundaries** (user input,
  file upload). Trust internal data flow.
- Comments explain **why**, not *what*. Code should be readable without
  comments; comments cover the non-obvious, edge cases, math background.
- No emojis in code/docs unless the user explicitly asks.

### File layout

```
.
├── index.html             # UI markup
├── styles.css             # all styling (dark + light, system-following with toggle override)
├── perlin.js              # math/API (noise, color modes, worker source)
├── perlin-studio.js       # controller (RAF loop, recording, presets, UI bindings)
├── manifest.webmanifest   # PWA manifest (installable)
├── assets/                # static assets (favicon.svg, icon-{192,512}.png,
│                          #   apple-touch-icon.png, hero.png, gallery-*.png
│                          #   + legacy default-atlas.webp for the archive)
├── scripts/
│   ├── render-readme-images.js  # renders assets/*.png from perlin.js
│   └── render-readme-videos.js  # renders docs/examples/*.webm (Node → ffmpeg)
├── _archiv/               # historical predecessors (READ-ONLY!)
│   ├── perlin_noise/      # Python original
│   ├── texturizer.ipynb   # Texturizer notebook
│   └── old_texturizer_combined/   # first browser version
├── docs/
│   ├── ARCHITECTURE.md    # technical docs
│   ├── USAGE.md           # full user guide
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
├── LICENSE                # AGPL-3.0
└── AGENTS.md              # this file
```

**`_archiv/` is off-limits for active changes.** These files document
the project's genealogy and may only be added to (e.g. when another
snapshot is preserved), never edited or deleted.

## Glossary

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

## Workflow notes

### Tests

There is **no test suite**. Instead:

1. **Syntax check both JS files** after every change:
   ```bash
   node --check perlin.js && node --check perlin-studio.js
   ```
2. **Math sanity** for Perlin changes — write a temporary Node script,
   set `global.window = {}`, require `perlin.js`, check the expected
   properties (reproducibility, value range, loop identity). See
   historical examples in the commit history.
3. **Manual browser test** — `python3 -m http.server` and click around.

Sandbox note: the permission setup may forbid starting an HTTP server
from `/Users/Shared/`. If you hit that, ask the user to test it themselves.

### Common pitfalls

#### Math bug class 1: float rounding at loop endpoints

`Math.sin(2π)` is not `0` but about `-2.4e-16`. `Math.floor(-1.7e-16)`
is `-1`, which masks to `255` in the hash lookup — a *completely
different* image. Fix: `safeProgress = ((p % 1) + 1) % 1`.

#### Math bug class 2: Z/W axis swap in `perlin4`

In the 4D hash tree, `AAB` and `AAA+1` are different constructs:
`AAB = perm[AA+1]+W` is a **Z shift**, `AAA+1 = perm[AA]+W+1` is a
**W shift**. The offsets must line up: `AAB` uses `z-1`, `AAA+1` uses
`w-1`. The outer lerp is over `tt` (W), not `s` (Z).

#### Animation bug: `t` progress too fast

The initial implementation had `t += fps` per second — 30× too fast.
The correct version is `t += 1` per second, and `scaleT` scales that
in noise space. So the per-frame step is ~`scaleT / fps` ≈ 0.005 —
a soft ripple instead of a flicker.

#### Worker CSP

Under `file://`, some browsers block the worker. The code automatically
falls back to main-thread rendering (see `initWorker` / `renderInMain`).
While debugging, watch whether the FPS counter says "(main)" — if so,
the fallback is active.

### Worker communication patterns

- **Never queue frames.** `requestFrame` skips if `state.workerBusy`
  is still `true`. Recordings use `renderFrameAndWait`, which
  synchronizes via `state.pendingResolves`.
- **Use transferables.** `postMessage({ ..., buffer: buf.buffer }, [buf.buffer])`
  → zero-copy back.

## When you change something

1. **Mind the flow.** Don't commit performance tweaks in `perlin3`/`perlin4`
   without sanity checks. Subtle math bugs look visually normal until
   the loop stops closing or edges start flickering.
2. **Keep UI strings English.** Including any new buttons/sections.
3. **Update `CHANGELOG.md`** for every user-visible feature/fix.
4. **No cosmetic changes in `_archiv/`.**

## Extension roadmap (nice-to-have)

See `README.md` section **Roadmap**. If you're interested in any of
these, sync with the maintainer first so scope and approach are clear:

- Gradient editor (custom color stops)
- Tileable noise (`repeatx`/`repeaty`/`repeatz`)
- GIF export (`gif.js`, ~12 KB)
- Obsidian plugin port
- Web Component variant
