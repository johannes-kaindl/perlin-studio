# Perlin Studio — redesign rationale

Direction: **Signal Chamber**. One direction, committed. Grounded in the
Kuro Signal Protocol palette — which maps almost 1:1 onto the project's
existing brand hues (Phosphor ≙ `#39ff7a`, Spectre ≙ violet, Circuit ≙
cyan, Void ≙ near-black `#0a0a18`).

## Major design decisions

- **Dropped the canvas checker background.** A transparency-checker
  pattern fights with the noise output (Perlin frames are never
  transparent). Replaced with a flat void surface + 1px hairline frame
  + subtle inner vignette — the canvas now reads as "framed work", not
  "image asset behind a placeholder".

- **Numbered mono-caps section eyebrows (`01 · RESOLUTION`).** Gives
  the sidebar a tool-like, protocol-y rhythm without enlarging headers.
  The leading number gets the phosphor accent — the only place numbers
  get colour, so the eye learns to skim by them.

- **Preset chips become swatch+label pills.** Each chip carries a tiny
  gradient strip reflecting its signature look (lava = fire ramp,
  aurora = purple→cyan→green→amber, etc). Hand-crafted per-preset via a
  `--chip-grad` CSS variable on each button — no JS changes.

- **Canvas corner-tags.** A "FRAME" tag top-left and a pulsing "LIVE"
  badge top-right give the canvas a permanent identity even when blank
  or recording. Both are decorative — no JS hook required, fully CSS.

- **Transport bar is one unified strip.** Padded, bordered, mono-typed
  labels. The t-slider is the visual hero of the bar; fps/frames sit
  right as small numeric stubs. A `>` glyph prefixes the status line
  (terminal feel) and turns into `!` in error state.

- **FPS counter becomes a circuit-cyan pill.** Hidden when empty.
  Reads as a measurement readout, not a header.

- **Color sub-sections live inside an inset panel.** They appear right
  under the color-mode dropdown so the active subgroup feels "owned"
  by the selector. The existing `data-for` show/hide JS is untouched.

- **Light theme is bone + ink, not white + grey.** Warmer ground
  (`#f3f0e6`), darker phosphor (`#1ea84a`) for AA contrast, darker
  circuit + spectre for the same reason. Activated automatically via
  `prefers-color-scheme: light` — no toggle.

- **System fonts only.** The brief forbids external CDN calls; KSP's
  Google-Fonts substitutes can't ship. I used `ui-sans-serif` /
  `ui-monospace` stacks — the design's identity sits in the palette,
  layout, and mono-caps treatment, not in the typeface.

- **`color-scheme` + `accent-color: var(--accent)`.** This is what
  fixed range thumbs / checkboxes / number-spinners to phosphor across
  browsers without per-thumb pseudo-element overrides.

## What's preserved verbatim (per the brief's hard constraints)

- All 47 element IDs from §6, with original `type` attributes.
- All JS-managed classes: `hidden`, `ready`, `active`, `error`, `primary`.
- The 6 `.preset-chip` buttons with intact `data-preset` values, in
  original order.
- The 4 `.color-section` divs with their `data-for` attributes (the
  show/hide hook the JS reads).
- `#loop-controls` wrapper around the loop-duration/radius inputs.
- The `<canvas id="canvas-output">` + `<video id="anim-preview">` pair
  inside `#canvas-wrap`.
- No new dependencies, no build step, no JS edits. The pipeline is
  still `<link rel="stylesheet">` + the same two `<script defer>` tags.
- `file://` still works (no CDN, no service worker required).

## What I considered and deliberately did not do

- **A vertical transport strip beside the canvas on desktop.** Tried
  it on paper — looks tidy, but it shifts the canvas's vertical centre
  off-axis and steals horizontal space the canvas wants. The wide
  bottom bar reads better when the canvas's aspect varies (256×256
  vs 384×256).
- **`<details>` collapsing for sections.** The brief explicitly asks
  for "every parameter accessible without modal hide-and-seek"; nested
  disclosure would betray that.
- **Section reordering.** Resolution → Noise → Loop → Color → Presets
  → Export is the natural workflow; no reason to disturb it.
- **A gradient preview with mini-tick labels.** Added the labels
  (0.0/0.25/0.5/0.75/1.0) underneath the bar — informative without
  needing extra controls.

## Files changed

- `index.html` — restructured markup; same IDs, same script tags.
- `styles.css` — full rewrite.

## Files untouched

- `perlin.js`, `perlin-studio.js`, `manifest.webmanifest`, everything
  under `assets/`, `docs/`, `scripts/`, the licence, `README.md`.
