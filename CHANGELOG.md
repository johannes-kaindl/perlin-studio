# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] — 2026-05-27

### Added
- **Domain warping** — new `Warp` section in the sidebar with
  `strength` and `scale` controls. The classical Inigo-Quilez technique:
  before each fbm sample, the `(x, y)` coordinate is displaced by a
  smoother, single-octave noise field. Perlin output stops looking
  like Perlin and starts looking like marble veins, ink in water,
  alien terrain. Implemented as new top-level `warpedFbm3` / `warpedFbm4`
  that auto-flow into the worker source via the existing `.toString()`
  interpolation pattern. `warpStrength=0` is a fast path that returns
  bit-identical output to plain fbm — smoke-tested as a regression guard.
- **`marble` preset** showcasing domain warp on a warm sunset gradient
  — chunky low-octave field pulled into stone-vein swirls.
- **Custom gradient editor** — pick `Custom …` in the gradient-mode
  preset dropdown and an inline stops editor appears: each stop has a
  position slider and a colour picker, with add and remove buttons.
  Stops are re-sorted on release. JSON preset save/load round-trips
  the custom gradient through the existing `gradient` field. Default
  seed is the viridis stops, so first activation has something
  editable.
- `scripts/smoke-test.js` — math invariants for `perlin.js`. Covers
  permutation determinism, `perlin3`/`perlin4` value range, loop
  identity at `progress=0` vs `progress=1` (bytewise and bit-exact at
  the float level), Z/W axis independence, domain-warp regression
  (warpStrength=0 bit-identical to fbm) + activation, and `colorize`
  range. The Forgejo deploy workflow gates on this — a regression in
  any of these stops the site from being republished.

### Changed
- Sidebar section numbering: Loop becomes `04`, Color mode `05`,
  Presets `06`, Export `07` — Warp slots in at `03`.
- PWA / address-bar `theme-color` meta tag now tracks the theme toggle
  too. Previously the two static `prefers-color-scheme`-keyed metas
  fell out of sync with explicit light/dark overrides on PWA install.
  Single tag, kept in sync by the inline `<head>` FOUC script and by
  `initThemeToggle`.

## [0.7.0] — 2026-05-27

### Added
- **Theme toggle.** A sun/moon button in the topbar lets users override
  the OS theme. The default still follows `prefers-color-scheme`; once
  the toggle is clicked, the explicit choice is persisted to
  `localStorage` and survives reload. A small inline `<head>` script
  applies the override before stylesheet paint to avoid a flash of the
  wrong theme.
- **New logo.** Three layered Bézier-noise waves (Spectre / Circuit /
  Phosphor) on a void ground — replaces the previous radial-blob mark.
  Used inline in the header SVG, in `assets/favicon.svg`, and rendered
  out to `apple-touch-icon`, `icon-192.png`, `icon-512.png`. PWA install
  icons shrunk dramatically (icon-512 from ~260 KB to ~24 KB).
- `docs/UI-SPEC.md` — the design brief that fed the redesign (written
  for a design-focused AI agent; full element-ID inventory, hard vs
  soft constraints, current design tokens).
- `docs/UI-REDESIGN.md` — the designer's rationale for the iteration
  that landed here (companion to UI-SPEC.md).

### Changed
- **Major UI refresh — "Signal Chamber" direction.** Full rewrite of
  `styles.css` (320 → 845 lines) and restructure of `index.html`
  (200 → 265 lines). Highlights:
  - Numbered mono-caps section eyebrows (`01 · RESOLUTION`, …) give
    the sidebar a tool-like, protocol-y rhythm.
  - Preset chips carry per-preset gradient strips reflecting their
    signature look (lava = fire ramp, aurora = purple→cyan→green→amber,
    etc.) — pure CSS, no JS change.
  - Canvas gets a flat void surface with hairline frame + inner
    vignette and decorative `FRAME` / `LIVE` corner tags (replaces the
    transparency-checker background, which fought with the noise output).
  - Transport bar is one unified strip with mono-typed labels; the
    t-slider is the visual hero, fps/frames sit right as small numeric
    stubs. Status line uses a `>` terminal-prompt glyph that flips to
    `!` on error.
  - FPS counter becomes a circuit-cyan pill, hidden when empty.
  - Color sub-sections live inside an inset panel under the colour-mode
    dropdown.
  - Light theme reworked to bone (`#f3f0e6`) + ink, with darker accent
    hues for AA contrast on the warm ground.
- All JS-managed IDs, classes (`hidden`, `ready`, `active`, `error`,
  `primary`), `data-preset` values, and `data-for` hooks preserved
  verbatim — no JS changes were required for the redesign itself.
  System fonts only (`ui-sans-serif` / `ui-monospace`), no external CDN.

## [0.6.1] — 2026-05-27

### Fixed
- **`aurora` built-in preset** now matches the README gallery image
  (green → cyan → blue → violet). The previous values produced a
  monotone cyan that diverged from the documented gallery render.

### Changed
- All README/OG images recompressed with `pngquant --quality=65-90`.
  Total `assets/*.png` shrunk from ~1.4 MB to ~370 KB with no visible
  quality loss (Perlin noise compresses well through palette
  quantisation).

## [0.6.0] — 2026-05-27

### Changed
- **Full translation to English.** UI strings, code comments, docs,
  config files, commit-message conventions — everything aligned with
  the rest of the author's Codeberg repos. The "Time scale" parameter
  (previously "Wabern-Geschwindigkeit") still maps to the same internal
  `scaleT` value; no behaviour change.

## [0.5.0] — 2026-05-27

### Added
- **`docs/examples/{lava,aurora,terrain}-loop.webm`** — three seamless
  2.5-second loops (VP9, 480×270, ~150 KB each). Directly embeddable
  in any docs via the Codeberg Pages URL using
  `<video src="…" autoplay loop muted playsinline>`.
- **`scripts/render-readme-videos.js`** — Node renderer that produces
  frames in Node and pipes them to `ffmpeg` (libvpx-vp9). Reproducible.
- **PWA setup**: `manifest.webmanifest` + icons (192px, 512px,
  Apple-Touch). The site is now installable on iOS/Android home
  screens and on desktop.
- README: new "Live loops" section embedding all three videos.

### Changed
- Forgejo Actions workflow: `concurrency:` block added. On fast push
  sequences only the newest deploy runs, older in-flight runs are
  cancelled.

### Fixed
- Forgejo workflow: removed the redundant `if:` condition and switched
  the repo-owner interpolation to `forge.event.repository.owner.username`.
  Before, the workflow was always marked as "skipped".

## [0.4.0] — 2026-05-27

### Added
- Open-source publication on Codeberg:
  <https://codeberg.org/jkaindl/perlin-studio>, live at
  <https://jkaindl.codeberg.page/perlin-studio/>.
- Open-source base files: `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`,
  `AGENTS.md`, `CHANGELOG.md`, `.gitignore`.
- `docs/ARCHITECTURE.md` and `docs/USAGE.md` with detailed technical
  and user-facing documentation.
- JSDoc blocks on the public API functions in `perlin.js` and
  `perlin-studio.js`.
- README showcase: hero image (Lava preset) + gallery of 4 examples
  (Aurora, Ocean, Terrain, Circuit) — all rendered by the tool itself.
- `scripts/render-readme-images.js` — pure-Node (zlib + crc32) PNG
  encoder that uses the real `perlin.js` module. Reproducible via
  documented parameter sets in the script.
- `og:image` and `twitter:image` meta tags now point at `hero.png` →
  link-preview cards show the hero image.
- `.forgejo/workflows/deploy.yml` — Forgejo Actions workflow,
  publishes every push on `main` to Codeberg Pages.
- `assets/favicon.svg` — SVG favicon in the project accent colors
  (cyan/violet/green).
- `<head>` meta tags in `index.html`: `description`, Open Graph,
  Twitter Card, `canonical`, `theme-color` — for link-preview cards
  on social shares.
- `SECURITY.md` with threat model (client-side only, no backend) and
  reporting channels.
- `.gitea/issue_template/` — structured bug-report and feature-request
  forms, plus a config with contact links.
- `.editorconfig` for consistent indentation/encoding/EOL across IDEs.

### Changed
- License switched from MIT to **GNU AGPL-3.0** — consistency with the
  author's other repos; network-use copyleft fits a web-deployed tool.
- README/AGENTS/CONTRIBUTING updated to reflect the new license,
  Codeberg launch badge added.

## [0.3.0] — 2026-05-20

### Added
- 4D Perlin noise (`perlin4`, `fbm4`) for seamless loops via a circular
  orbit in `(z, w)`.
- **Seamless loop** toggle (default on) with configurable duration and
  radius.
- Correct animation speed: `t` advances by 1 unit per second instead
  of `fps` units per second — soft ripple instead of flicker.

### Changed
- UI label `scale t` → **Time scale**, default `0.5` → `0.15`.
- All 6 built-in presets now use loop mode with adjusted `scaleT`.

## [0.2.0] — 2026-05-20

### Added
- Web Worker (inline via Blob URL) for the Perlin computation — main
  thread stays free for the UI.
- Four color modes: **RGB** (per channel), **Gradient** (8 presets),
  **HSV**, **Posterize**.
- Preset system: 6 built-in chips + save/load as JSON.
- WebM export via `MediaRecorder` + `canvas.captureStream`.
- Play/pause control (button + spacebar) with wall-clock time so
  animation is framerate-independent.

### Changed
- Reduced to a pure Perlin Studio; the Texturizer mode lives on as a
  snapshot in `_archiv/old_texturizer_combined/`.

## [0.1.0] — 2026-05-20

### Added
- First browser version with the Texturizer (image → Minecraft block
  mosaic) and a Perlin preview.
- Default texture atlas embedded as a base64 fallback in JS.
- Drag-and-drop for the input image and the atlas.

## Sources

The project grew out of two older hobby projects, preserved as reference
in the `_archiv/` directory:
- `_archiv/texturizer.ipynb` (January 2023) — atlas-tile analysis as a Jupyter notebook
- `_archiv/perlin_noise/` (May 2023, updates 2024) — Python +
  `noise` library + matplotlib for GIF export
