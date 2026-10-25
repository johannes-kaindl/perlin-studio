# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.18.0] — 2026-10-26

### Added
- **Cellular noise types** (web) — a *Noise type* select next to Perlin: `cells` (distance to the nearest point), `borders` (cell edges) and `smooth` (a smooth minimum, soft blobs), with a cell-jitter slider. The hash is the same permutation table as Perlin, so `base` seeds it and tiling wraps the cells; time moves each point on a circle inside its own cell, which makes the loop close exactly with a plain 3×3 search. Works with warp, tile, layer 2, relief lighting and every colour mode, on CPU and GPU (parity gate: six cases, a mutant on one hash constant turns all six red). The native apps ignore it and render Perlin.
- **Relief lighting** (web) — an overlay for the colour modes: the noise is read as a height field and lit (relief strength, light direction and height, ambient, highlight, shininess). The slope comes from the same three-point stencil as the flow mode, so it works with warp, tiling, layer 2 and the loop; flow and per-channel RGB ignore it. CPU and GPU render it identically (parity gate, five new cases); the worker copy of the CPU path is now checked bytewise against the main-thread path for every case. The native apps ignore it.
- **Cosine colour mode** (web) — a new colour mode `cosine`: `a + b·cos(2π(c·t+d))` per channel, seven built-in palettes (rainbow, dusk, rose, citrus, peach, neon, coral, after Inigo Quilez' *Simple color palettes*) and an editor for the twelve numbers with a live preview. Works on both renderers (the parity gate covers it); the native macOS and iOS apps do not know the mode yet and treat it as an unknown mode (they fall back to the gradient mode).
- **GPU renderer (WebGL2)** (web) — new `perlin-gl.js` and a *Renderer* select
  in the studio (CPU · worker / GPU · WebGL2, remembered per browser, CPU stays
  the default). The fragment shader is a line-by-line port of the maths in
  `perlin.js` and reads the same seeded permutation table, so a preset renders
  the same image on both renderers (float32 against float64: at most one colour
  level apart, measured by `scripts/check-gl-parity.mjs`). Loop closure stays
  bytewise on the GPU because the loop angle is computed in JS. Measured on an
  M5 Pro at 1080p, 6 octaves: about 1.2 s per frame on the CPU, a few
  milliseconds on the GPU. The flow and multi-channel RGB colour modes (and
  gradients with more than 16 stops) still render on the CPU, frame by frame; a
  GPU failure drops back to the CPU for good.
- **Video export bakes the mask + a background** (web) — the recorder now
  composites the active image mask and a chosen background (solid color,
  imported image with cover/contain, or best-effort transparent) into the
  exported frames, at a chosen export resolution (presets + custom) decoupled
  from the on-screen canvas. New zero-dependency `perlin-export.js` holds the
  compositing math.
- **macOS companion app** (`macos/`) — *Perlin Live Wallpaper*, a native
  menu-bar app that renders the studio's noise live as an animated desktop
  background on the GPU via Metal. It uses only public AppKit (a desktop-level
  window behind the icons — no private APIs; macOS has no third-party live-
  wallpaper API), renders on all displays via its own frame timer, and follows
  the power source (30 fps on AC; paused on battery, or 10 fps via "Animate on
  battery"). Noise *parameters* stay single-source in `perlin-presets.js`
  (exported to JSON); the noise *algorithm* is ported to Metal Shading Language,
  covering every studio colour mode except tile / image-mask (gradient /
  posterize / hsv / rgb incl. per-channel nebula / flow + domain warp + layer2),
  with 10 bundled presets.
- **Embedded editor** (macOS app) — "Open Editor…" runs the full Perlin Studio
  in a `WKWebView`; an injected bridge live-drives the wallpaper from the
  studio's parameters (the web source is untouched). The last-applied look is
  remembered across launches. An **image mask** set in the editor now drives the
  wallpaper too: the window goes non-opaque so the real desktop wallpaper shows
  through where the mask hides the noise (premultiplied alpha; alpha-or-luminance
  matching the studio; invert supported; aspect-preserving **fit or fill** via a
  menu toggle — never stretched). The mask is per-session: it is not restored on
  relaunch (so it never "ghosts" on the wallpaper with the editor unaware of it),
  but it is saved inside named custom presets.
- **Custom-preset library** (macOS app) — "Save Current as…" stores the current
  look (params + mask) under a name; saved looks appear in the menu and apply as
  a complete look on click (hold Option to remove). Stored as UUID-named JSON
  under Application Support.
  Separate artifact — the zero-build, `file://`-safe web studio is unchanged.
  See `macos/README.md` and the design specs that were under `docs/superpowers/specs/` (moved out of the repo on 2026-10-26; see the git history).
- **Live Photo export** (macOS app) — "Export Live Photo…" renders the current
  preset to an Apple Live Photo (HEIC still + paired H.264 `.mov` with the
  QuickTime content-identifier + still-image-time markers) and adds it to Photos
  (syncs to iPhone via iCloud) or exports the pair to a folder for AirDrop. The
  Live Photo animates in Photos; the *still* works as a lock-screen wallpaper
  (iOS blocks *animated* Live Photo wallpapers for synthetic, non-camera
  captures — see the native iOS app entry). Headless
  `--export-livephoto <preset> <out>` + a `--selftest` check that the pair is
  structurally valid.
- **Native iOS/iPadOS app** (`ios/`) — *Perlin Live Photo*, a SwiftUI editor
  that generates Live Photos on-device: a live Metal preview, the **full
  parameter set** (noise, warp, layer 2, every colour-mode sub-parameter), a
  **custom gradient editor** (visual colour wells, hex input, paste-a-palette),
  **image masking** (noise inside a picked shape, composited over black or the
  source image), **named saved looks**, and export to Photos as a **Live Photo,
  plain video, or still image** with configurable resolution / duration / fps.
  Reuses the macOS app's portable Metal renderer + the
  `AVAssetWriter` Live Photo exporter by file reference (single-sourced); built
  via xcodegen, signed to a device with a Developer account. See `ios/README.md`.

### Fixed
- **Recording now works on Safari and iOS.** The recorder only ever offered
  WebM, which Safari records only from 18.4 on and iOS not at all before then,
  so "Record animation" silently refused on Apple devices. It now prefers
  **MP4/H.264** (recorded by Safari/iOS and Chrome 126+) and falls back to WebM
  (Firefox, and Chrome builds without an H.264 encoder), picking the first the
  browser actually accepts. The download name and the in-app labels follow the
  real container, so a Chrome capture typically saves as `.mp4` (was `.webm`)
  while a Firefox capture stays `.webm`. This also produces the H.264 clip the planned
  iOS Live Photo path needs (it remuxes without re-encoding).

## [0.17.0] — 2026-06-02

### Changed
- **New home for the live demo and the repo.** The site now lives at
  <https://pages.jkaindl.de/perlin-studio/> and the repo at
  <https://git.jkaindl.de/jkaindl/perlin-studio> (self-hosted Forgejo);
  <https://github.com/johannes-kaindl/perlin-studio> stays as the mirror. All
  links, the canonical URL and the Open Graph tags were updated. The old
  `jkaindl.codeberg.page` deploy is frozen and no longer receives updates.
  The rendered WebM loops under `docs/examples/` are published on the new host
  as well, so existing embeds of those files keep working once they are
  repointed.
- **Security contact.** Reports now go to `security@jkaindl.de` or, if you
  prefer a platform channel, to the GitHub mirror's private advisory form —
  the new issue tracker has no confidential mode. Machine-readable contact
  info ships as `.well-known/security.txt` (RFC 9116).
- **Refreshed the built-in presets** for more impact and to better show off
  the tool's range: `flow` is now a visible, saturated vector field (was
  nearly black); `nebula` a vivid magenta per-channel field; `composite` a
  dramatic layered magma; `circuit` brighter with more structure; `default` a
  higher-contrast viridis; `clouds` more dramatic storm-grey; `terrain` more
  banded/topographic. Affects the studio preset chips and the embeddable
  `<perlin-noise preset="…">` element.

## [0.16.1] — 2026-06-02

### Changed
- Internal: consolidated the ad-hoc font sizes into a small type-scale of
  `--fs-*` tokens. A few near-duplicate sizes snapped to the nearest step
  (≤0.5px shifts, on minor chrome only); no functional change. (The full
  spacing-token ramp was intentionally deferred — see notes.)

## [0.16.0] — 2026-06-02

### Changed
- **Sidebar reorganised for first-run flow.** Presets now sit at the top (pick
  a look first), then the core parameters (Resolution, Noise, Color, Loop),
  then the advanced sections (Layer 2, Warp), then Mask and Export.
- **Recording length & rate live with the recorder.** The frames/fps fields
  moved out of the transport bar into the Export section, next to the WebM
  button they drive — they never affected live playback.
- **Progressive disclosure.** The Layer-2 controls appear only when Layer 2 is
  enabled, and the Warp scale appears only when Warp strength is above 0, so
  the panel stays uncluttered until a feature is in use.

## [0.15.0] — 2026-06-02

### Added
- **Visible transport state.** The canvas corner tag now reflects the real
  state — **LIVE** (green, pulsing), **PAUSED** (dim), or **REC** (red) —
  instead of always reading "LIVE" with a forever-pulsing dot.
- A **first-paint loading** indicator shows until the first frame actually
  renders (the status no longer claims "Ready" before the canvas has pixels).
- A persistent **"main thread"** badge appears when the compute worker can't
  start, instead of a transient suffix shown only during playback.

### Changed
- **One clear primary action.** The Play button no longer wears the glowing
  primary treatment; it fills with accent only while running and is neutral
  when idle, leaving WebM export as the single primary call-to-action.
- Unified the sidebar dividers — the lone dashed rule is now solid, and nested
  switch rows inside colour sections drop their redundant inner box.

### Fixed
- A compute worker that starts but then dies (e.g. CSP under `file://`) now
  repaints on the main thread instead of leaving the canvas blank, and the
  first-paint indicator clears reliably.

## [0.14.2] — 2026-06-02

### Changed
- **Accessibility contrast pass (round 2, slice 1).** Faint informational text
  (`--text-faint`) now meets WCAG AA (≥4.5:1) in both themes. Small accent text
  (section numbers, the time readout, the status prefix, the custom-palette
  button) uses a deeper green in the **light** theme via a new `--accent-text`
  token, and the light primary-button label now sits on a deeper green so the
  white text passes AA. Resting field/section borders are lifted for low-vision
  visibility — a middle ground that keeps the hairline look, with the focus
  ring remaining the fully WCAG-compliant indicator. Dark-theme accents are
  unchanged.

## [0.14.1] — 2026-06-02

### Added
- A visible **"Custom hex palette →"** button under the Color-mode selector
  that jumps straight to the custom gradient editor (switches to
  Gradient + "Custom" and reveals it). The palette was previously reachable
  only via Color mode → Gradient → "Custom …", two dropdowns deep.

## [0.14.0] — 2026-06-02

### Added
- **Custom colours by hex value.** In the custom gradient editor each colour
  stop now has a `#rrggbb` text field, synced both ways with the swatch
  (type/paste a hex or pick visually). Liberal parsing (`#rrggbb`, `rrggbb`,
  3-digit `#rgb`); invalid input reverts on blur.
- **Paste a whole palette.** A "Paste palette" box turns a pasted list of hex
  codes (any separator, with or without `#`) into an evenly-spread gradient
  in one go — for matching a brand/design spec exactly (≥2 colours, capped
  at 16).
- **Custom palettes in Posterize mode** too, via a new "Custom …" option —
  previously custom stops were only reachable in Gradient mode.

## [0.13.0] — 2026-06-02

### Added
- **Low-resolution pixel-block look.** The output canvas now fills its frame
  with nearest-neighbour upscaling, so a small Width/Height (e.g. 64×64)
  renders as crisp, deliberate pixel blocks instead of a tiny image at native
  size. Aspect ratio is preserved (matte bars where it doesn't match the
  frame), and WebM playback scales the same way. Display-only — exported
  PNG/WebM still use the native render resolution.
- **Live value readout beside every parameter slider** (the transport time
  slider already had one); custom-gradient stops show their position too.
- **Stop control for WebM recording** — the Export button becomes "Stop
  recording" during a capture and yields the partial clip, instead of locking
  the UI until every frame is done.
- A hint at the Export controls noting that WebM is RGB-only and ignores an
  active mask.

### Changed
- **Accessibility:** `#status` is now a polite live region (assertive on
  error), the progress bar exposes `role=progressbar` with `aria-valuenow`
  (per-frame announcements throttled so assistive tech isn't flooded), the
  Color-mode select and gradient-stop inputs are labelled, number fields
  carry their `min`/`max` bounds, and Layer-2 sub-fields are disabled while
  Layer 2 is off.
- **Mobile / touch:** 24 px touch targets and 16 px form inputs on coarse
  pointers (no more iOS zoom-and-stick), and the canvas area uses `dvh` with
  a floor so the transport stays on-screen on short viewports.
- PNG export now confirms in the status line, matching every other action.

### Fixed
- The live canvas could remain hidden behind the WebM `<video>` preview after
  an export — any later edit repainted a hidden canvas and only a reload
  recovered. Any render now restores the live canvas.
- The "Clear mask" button was permanently disabled (it toggled a mis-named
  element reference).
- Number fields could show an un-clamped value (e.g. `9999`) while the engine
  rendered the clamped one (`1024`), and a saved preset recorded the
  visible-but-wrong number. Fields now snap into range on commit.
- A worker crash during recording could hang the app indefinitely; pending
  frame requests are now rejected so it falls back to the main thread.

### Tests
- Made the `perlin3`/`perlin4` value-range smoke check deterministic
  (seeded sampling) so it can no longer intermittently block the deploy.

## [0.12.0] — 2026-05-28

### Added
- **`<perlin-noise>` web component** — a renderer-only custom element for
  embedding a looping Perlin animation on any page. Configure with a
  built-in preset name (`preset="lava"`), a JSON preset exported from the
  studio (`src="…"`), or the `params` JS property. Responsive: the render
  resolution tracks the displayed size × devicePixelRatio, capped at
  `max-resolution` (default 1280); the preset's declared size acts as a
  reference composition so the look is resolution-independent. Respects
  `prefers-reduced-motion` (renders one still frame) and pauses while
  off-screen. Plain script, file://-safe (except `src`, which needs HTTP).
- **`examples/embed.html`** — embedding demo: a full-bleed hero, preset
  tiles, and a JSON-`src` tile.
- Seven smoke assertions for `resolveParams` (named gradient → stops,
  custom-stop passthrough, no input mutation, viridis fallback). Total
  smoke battery: 39 → 46.

### Changed
- **`perlin-engine.js`** — the worker lifecycle, RAF loop, and FPS
  smoothing were extracted from the studio controller into a reusable
  headless `PerlinEngine` class consumed by both the studio and the new
  element. No behavioural change to the studio; the worker source and
  skip/stale logic are reused verbatim.
- **`perlin-presets.js`** — gradients and built-in presets moved out of
  the controller into a shared module with a `resolveParams` helper, so
  the studio and the element resolve presets identically.

## [0.11.0] — 2026-05-27

### Added
- **Image mask** — load a PNG / JPG / WebP file as a per-pixel mask.
  PNG alpha is used directly; opaque files fall back to Rec. 709
  luminance so a black-on-white silhouette also works. The mask is
  rasterised to canvas resolution on first use and cached. Apply
  toggle, Invert toggle, Clear button. PNG export keeps the
  transparency; WebM is RGB-only and renders masked regions onto
  the canvas background.
- **Layer compositing** — a second noise field ("Layer 2") with its
  own scale, octaves, and seed can be blended on top of the main
  one. Six blend modes: multiply, add, screen, darken, lighten,
  difference. A mix slider linearly interpolates between Layer 1
  alone and the full blend. Skipped in flow mode and per-channel
  RGB mode (both already take 3 samples per pixel; layering would
  6× the cost).
- **`composite` preset** — Layer-2 showcase with a slow rolling
  base and a finer second layer in multiply blend on the `ice`
  gradient.
- Six new smoke assertions for layer blends (algebra at known
  points for each mode), three for the layer render path (off =
  baseline, on with mix=1 diverges, mix=0 short-circuits), three
  for the mask byte arithmetic. Total smoke battery: 25 → 39.

### Changed
- Sidebar renumbered: Layer 2 = 03 (slots between Noise and Warp),
  Warp = 04, Loop = 05, Color = 06, Mask = 07 (new), Presets = 08,
  Export = 09.
- Docs sync: `USAGE.md` gains Layer 2 and Mask sections plus
  workflow examples. `ARCHITECTURE.md` gains a Layer compositing
  section (math, render path, restrictions, smoke guarantees) and
  an Image mask section (lifecycle, luminance fallback, resolution
  coupling, export behaviour). README features and roadmap updated;
  GIF export explicitly deferred with rationale.

## [0.10.0] — 2026-05-27

### Fixed
- `savePreset` now keeps the `gradient` field in the JSON when the
  active gradient is `Custom …` — previously it stripped the stops
  unconditionally, so custom gradients couldn't actually be saved
  and restored. Discovered while updating the user guide. (Strictly
  this fix shipped in the v0.10.x post-release docs commit, but
  rolled into v0.11.0's release notes because v0.10 stable users
  see the fix the moment they pull v0.11.)

### Added
- **Tileable noise** — new `Tile X` and `Tile Y` inputs in the
  Resolution section (in noise cells, `0` = off). The X and Y axes of
  `perlin3` / `perlin4` wrap modulo the tile period, so the output
  seamlessly repeats and is usable as a background texture, wallpaper,
  game-engine asset, etc. Octave wrap scales with frequency (with
  integer lacunarity = 2 by default, every octave lands on an integer
  cell). The Z axis (3D mode) and W axis (4D loop) stay infinite so
  seamless looping still works.
- Tile + warp interplay: when both are active, `warpScale` is rounded
  to the nearest non-zero integer for the warp's internal wrap period
  to coincide with the main field's tile period — otherwise the warp
  displacement would slip the seam by a fractional cell. Documented
  in the Warp section hint.

### Changed
- `perlin3` and `perlin4` gained `repeatX` / `repeatY` parameters
  (default `0` = infinite noise = bit-identical to pre-tileable).
  Same for `fbm3` / `fbm4` / `warpedFbm3` / `warpedFbm4`.

### Tests
- Smoke battery grew to 25: tile-X seam, tile-Y seam, perlin4 tile
  seam, fbm3 tile seam across octaves, warpedFbm3 tile seam (which
  caught a real bug during development — the warp displacement field
  needed its own wrap period of `tile * warpScale`, not `tile`), and
  bit-identity regression when `repeat=0`.

## [0.9.0] — 2026-05-27

### Added
- **Per-channel noise** for RGB colour mode. A new checkbox at the
  bottom of the RGB sub-section turns single-sample RGB into three
  independent samples (at offset positions in noise space, same
  permutation table). Channels drift independently — film-grain,
  nebula, stellar-cloud looks become reachable. Default off, no
  behaviour change for existing users.
- **Flow-field colour mode** — fifth option in the colour-mode
  dropdown. Renders the noise as a vector field: a 3-point stencil per
  pixel computes the local gradient (∂noise/∂x, ∂noise/∂y), atan2
  maps the angle to hue, and the magnitude tints brightness. Tunable
  hue shift, saturation, gain, floor, stencil ε. Looks like a wind
  map / storm front instead of a noise pattern. Compatible with the
  loop and warp pipelines.
- **`nebula` preset** showcases per-channel noise with a gentle warp.
- **`flow` preset** showcases flow-field mode on a high-octave field.
- Smoke tests grew from 15 to 19: range invariants for
  `colorizeRgbMulti` and `colorizeFlow`, plus divergence checks that
  confirm `rgbMultiChannel=true` and `colorMode='flow'` actually reach
  different render paths.

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
  <https://git.jkaindl.de/jkaindl/perlin-studio>, live at
  <https://pages.jkaindl.de/perlin-studio/>.
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
