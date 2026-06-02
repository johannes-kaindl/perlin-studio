# Custom colours by hex value

**Status:** approved design, ready for implementation
**Target version:** v0.14.0
**Companion doc:** [`UI-PASS-2026-06.md`](UI-PASS-2026-06.md)

## Context

The custom-gradient editor (Color mode → Gradient → "Custom …") lets you
build a palette from colour stops, but each stop is edited only through the
native OS colour picker — there is no way to type or paste an exact hex code.
For matching a specific design/brand spec, where the colours come as a list
of hex values, that is the missing piece.

The plumbing is already there: stops are stored as `{pos, color:[r,g,b]}`,
the `rgbToHex`/`hexToRgb` helpers exist, and `gatherParams` already reads
`state.customStops` for **both** gradient and posterize modes. Only the
input affordances (and the posterize dropdown option) are missing.

## Goals

- Enter exact colours by hex, per stop, synced with the existing swatch.
- Paste a whole brand palette at once and have it become the gradient.
- Make custom palettes available in Posterize mode too, not just Gradient.

## Hard constraints (unchanged)

Vanilla HTML/CSS/JS, no dependencies, no build, no ES modules, `file://`-safe,
dark/light theming preserved. Defensive parsing only at the new user-input
boundary (per `AGENTS.md`).

## Design

### 1. Per-stop hex field

Each custom-stop row gains a compact `#rrggbb` text input next to its colour
swatch. The two stay in sync both ways:

- Typing/pasting a valid hex → updates the stop colour, the swatch, the
  gradient preview, and the live render.
- Picking via the swatch → updates the hex text.
- Invalid text is ignored while typing and **normalised back** to the stop's
  current colour on blur, so it can never corrupt state.

Row layout stays a single line (5 columns):

```
[───── pos slider ─────] 0.50  [▣]  #1ea84a  ×
```

### 2. Paste-palette box

At the top of the custom editor: a small `<textarea>` + an **Apply palette**
button. Paste a list of hex codes in any common form
(`#1ea84a, #4ac8d8, #a878ff`, newline- or space-separated, with or without
`#`, 3- or 6-digit). Apply → the stops are **replaced** by those colours,
spread evenly across `0…1`.

- Requires ≥2 colours (fewer → a status hint, no change).
- Caps at 16 colours; if more are pasted, applies the first 16 and says so
  (no silent truncation).

### 3. Custom palettes in Posterize mode

Posterize already resolves `state.customStops` when its gradient name is
`custom` (`gatherParams`), so this is UI-only:

- Add a `Custom …` option to the posterize gradient `<select>`.
- **Relocate** the shared `#custom-stops` editor out of the gradient
  `color-section` to a sibling at the end of the Color-mode section, so it
  can be shown in **either** gradient-custom or posterize-custom (a child of
  a `display:none` section can't be revealed otherwise). Its visibility
  condition becomes `(gradient || posterize) && name === "custom"`.

### Parsing helpers

- `parseHex(str)` → `[r,g,b] | null`. Liberal: optional `#`, 3- or 6-digit.
  `hexToRgb` is refactored to `parseHex(hex) || [0,0,0]` to keep one parser.
- `parseHexList(str)` → `[[r,g,b], …]`. Scans the text for hex tokens via a
  bounded global regex; ignores anything that isn't a hex colour.

## Data model & round-trip

Unchanged: stops remain `{pos, color:[r,g,b]}`; hex is purely an
input/display layer. Preset save/load (`savePreset`/`applyParamsToUi`) keeps
working as-is, including a saved posterize-custom palette (the new `custom`
option means `els.posterGradient.value = "custom"` now sticks).

## Out of scope

A live gradient-preview strip inside the Posterize section (the live canvas
plus the stop swatches are feedback enough); a colour-from-image picker.

## Files

- `index.html` — paste box + Apply button markup; `Custom …` option in the
  posterize select; move `#custom-stops` to a section-level sibling.
- `perlin-studio.js` — `parseHex`/`parseHexList`/`applyPalette`; per-stop hex
  input in `renderCustomStops`; widen the custom-stops visibility condition;
  wire the Apply button; add els refs.
- `styles.css` — `.stop-hex` column + 5-column `.custom-stop` grid; paste-box
  / textarea styling.
- `CHANGELOG.md` — v0.14.0.

Not touched: `perlin.js`, `perlin-presets.js`, `perlin-engine.js`,
`perlin-element.js`, and therefore `dist/perlin-noise.js` — no regeneration
needed.

## Tests

- `node --check` on the JS; `node scripts/smoke-test.js` (math untouched,
  stays green).
- Manual: type a hex into a stop (swatch follows) and pick via the swatch
  (hex follows); paste a 3- and a 6-colour palette (stops spread evenly);
  switch Posterize → Custom and confirm the editor appears and renders;
  save a custom (gradient and posterize) preset and reload it (round-trip);
  paste garbage / 1 colour (rejected cleanly).

## Risks

- Five columns make the stop row tight on a narrow sidebar; the hex field is
  kept compact. If it reads cramped in QA, fall back to a two-line stop row.
- Relocating `#custom-stops` must not break `renderCustomStops`
  (`#custom-stops-list` id) or the visibility toggle (`#custom-stops` id) —
  both are id-based, so location-independent.

---

## Addendum (v0.14.1) — discoverability

The custom palette was reachable only two dropdowns deep (Color mode →
Gradient → "Custom …"), so it was easy to miss entirely. An always-visible
**"Custom hex palette →"** button now sits directly under the Color-mode
select. Clicking it (`goToCustomPalette`) switches to Gradient + "Custom",
reveals the editor, and scrolls it into view — from any colour mode. Pure UI
sugar over the existing controls (no new state, no backend/bundle change); the
gradient preset dropdown keeps its own "Custom …" entry too.
