# Architecture notes for contributors and agents

Orientation only: where things live and what the terms mean. The math, the worker pipeline and the loop mechanics are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Module layering

Five plain scripts, each attaching a `window` global, loaded in order (`file://`-safe, no ES modules):

1. `perlin.js` → `MTPerlin` — math + `WORKER_SOURCE`.
2. `perlin-presets.js` → `MTPerlinPresets` — `GRADIENTS`, `BUILTIN_PRESETS`, `resolveParams` (named gradient → concrete stops).
3. `perlin-engine.js` → `PerlinEngine` — headless renderer: owns the worker, the RAF loop, and FPS smoothing. Consumers pass `onTick` / `onFrame` / `transformFrame` callbacks.
4. `perlin-studio.js` and `perlin-element.js` are **consumers** of the engine. The studio is the full editor; `<perlin-noise>` is the embeddable renderer-only element. Keep render/animation logic in the engine, not duplicated in either consumer.
5. `perlin-export.js` → `MTPerlinExport` — pure compositing helpers (`computeFitRect`, `compositeOverColor`, `hexToRgb`) used by the studio's video export. No DOM; Node-requirable (smoke-tested).

## File layout

```
.
├── index.html             # UI markup
├── styles.css             # all styling (dark + light, system-following with toggle override)
├── perlin.js              # math/API (noise, color modes, worker source)
├── perlin-presets.js      # gradients, built-in presets, resolveParams (shared)
├── perlin-engine.js       # headless render engine (worker lifecycle + RAF loop)
├── perlin-studio.js       # controller (UI bindings, recording, presets) — consumes the engine
├── perlin-element.js      # <perlin-noise> embeddable renderer-only custom element
├── perlin-export.js       # pure compositing math for video export (window.MTPerlinExport)
├── manifest.webmanifest   # PWA manifest (installable)
├── assets/                # static assets (favicon.svg, icon-{192,512}.png,
│                          #   apple-touch-icon.png, hero.png, gallery-*.png
│                          #   + legacy default-atlas.webp for the archive)
├── examples/
│   ├── embed.html         # <perlin-noise> embedding demo
│   └── marble.json        # resolved preset export for the src demo
├── scripts/
│   ├── check-syntax.mjs        # syntax gate (external perlin*.js + inline <script>), gates the deploy
│   ├── smoke-test.js           # math + resolveParams invariants, gates the deploy
│   ├── check-no-abs-paths.mjs  # CORE-META-14 gate: no absolute paths in tracked *.md
│   ├── deploy-page.sh          # publish committed HEAD to pages.jkaindl.de (rsync)
│   ├── bump-version.sh         # native version bump (macos/packaging/Info.plist)
│   ├── render-readme-images.js # renders assets/*.png from perlin.js (+ oxipng)
│   ├── render-guide-images.js  # renders docs/images/*.png for USAGE.md
│   ├── render-readme-videos.js # renders docs/examples/*.webm (Node → ffmpeg)
│   └── build-standalone.js     # concatenates the runtime scripts into dist/perlin-noise.js
├── macos/                 # native companion app (Swift + Metal); see macos/README.md
├── ios/                   # native iOS/iPadOS companion "Perlin Live Photo"; see ios/README.md
├── dist/
│   └── perlin-noise.js    # generated standalone bundle (scripts/build-standalone.js) — do not edit
├── _archiv/               # historical predecessors (READ-ONLY!)
│   ├── perlin_noise/      # Python original
│   ├── texturizer.ipynb   # Texturizer notebook
│   └── old_texturizer_combined/   # first browser version
├── docs/
│   ├── ARCHITECTURE.md    # technical docs (math, worker pipeline, loop mechanics)
│   ├── USAGE.md           # full user guide
│   ├── MACOS-APP.md       # native app distribution + Gatekeeper guide
│   ├── internal/          # architecture notes and decisions for contributors and agents
│   └── examples/          # rendered WebM loops (for README + embedding)
├── .claude/rules/         # path-triggered agent rules (perlin-core.md)
├── .editorconfig          # consistent indentation/encoding/EOL
├── .well-known/
│   └── security.txt       # RFC 9116 contact (deployed with the site)
├── .gitea/
│   └── issue_template/    # bug report + feature request forms
├── README.md              # quickstart + entry point
├── ANGEBOT.md             # what the repo delivers to others (PROF-MEDIA-01)
├── CONTRIBUTING.md        # developer workflow
├── SECURITY.md            # threat model + reporting
├── CHANGELOG.md
├── LICENSE                # AGPL-3.0 (code)
├── LICENSE-DOCS           # CC BY-SA 4.0 (documentation)
├── LICENSING.md           # licensing overview / dual-license option
├── CLA.md                 # contributor license agreement
└── AGENTS.md              # agent core and index
```

`_archiv/` documents the project's genealogy and may only be added to (e.g. when another snapshot is preserved), never edited or deleted.

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
