# Web Component Spec — `<perlin-noise>` + shared render engine

Status: approved design, ready for implementation.
Date: 2026-05-28.

## Goal

Ship an embeddable, renderer-only custom element `<perlin-noise>` that draws
a looping Perlin animation onto a canvas — no control panel. Primary use case:
a decorative hero / background on a third-party page. Configured via a small
set of HTML attributes plus a full JavaScript property.

To avoid duplicating the worker + animation orchestration that already lives in
`perlin-studio.js`, that logic is extracted into a shared headless engine
(`PerlinEngine`) consumed by both the studio controller and the new element.
This is a DRY refactor of working code, so the studio must stay behaviourally
identical.

## Hard constraints (from AGENTS.md)

- **Zero build step.** No bundler, no TypeScript, no framework.
- **`file://` must work.** Double-clicking `index.html` must keep working, so
  no ES modules (module scripts are subject to CORS under `file://`). Every
  layer is a plain script attaching to a `window` global, exactly like the
  current `MTPerlin` IIFE.
- **No new dependencies.**
- **UI strings / comments / identifiers stay English.**
- **`perlin.js` math stays byte-identical** — the smoke tests gate CI deploy.

## Architecture — five plain-script layers

```
perlin.js          → window.MTPerlin          math + WORKER_SOURCE        [unchanged]
perlin-presets.js  → window.MTPerlinPresets   GRADIENTS, BUILTIN_PRESETS,
                                               resolveParams()            [NEW]
perlin-engine.js   → window.PerlinEngine      headless renderer class     [NEW]
perlin-element.js  → customElements.define     <perlin-noise>             [NEW]
perlin-studio.js   → studio controller        consumes presets + engine  [CHANGED]
```

Load order in `index.html`: `perlin.js → perlin-presets.js → perlin-engine.js
→ perlin-studio.js`. The element script is **not** loaded by the studio page;
it is exercised by a standalone demo page (`examples/embed.html`).

### Why `perlin-presets.js`

The element supports `preset="lava"` (a built-in name). To render that it needs
both the preset definitions and gradient resolution: a preset with
`gradientName: "fire"` must be expanded to its concrete `[{pos,color}]` stops
before the params reach the worker. That resolution lives inline in
`perlin-studio.js` today (`gatherParams`). Extracting `GRADIENTS`,
`BUILTIN_PRESETS`, and a `resolveParams()` helper into a shared module lets the
studio and the element share one copy.

## Module: `perlin-presets.js`

Exposes `window.MTPerlinPresets = { GRADIENTS, BUILTIN_PRESETS, resolveParams }`.

- `GRADIENTS` — moved verbatim from `perlin-studio.js`.
- `BUILTIN_PRESETS` — moved verbatim, including the `LOOP_DEFAULTS` / `WARP_OFF`
  / `LAYER2_OFF` spread bases.
- `resolveParams(preset) → params` — returns a new, fully-resolved params object
  the engine/worker can consume directly:
  - Deep-ish clone (so the input is never mutated).
  - If `colorMode` is `gradient` or `posterize` and `params.gradient` is absent
    but `gradientName` is set: inject `GRADIENTS[gradientName]` (fallback
    `viridis`). If `gradientName === "custom"` and `params.gradient` is already
    a valid stop array, pass it through unchanged.
  - Leave all other fields as-is. No clamping here — clamping stays a studio/UI
    concern (the element trusts preset JSON authored by the studio).

This module must be `require()`-able under Node (guard the `window` assignment)
so the smoke test can import `resolveParams`. Mirror the perlin.js pattern:
```js
(function (root) {
  // … definitions …
  root.MTPerlinPresets = { GRADIENTS, BUILTIN_PRESETS, resolveParams };
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined") module.exports = { GRADIENTS, BUILTIN_PRESETS, resolveParams };
```

## Module: `perlin-engine.js`

`window.PerlinEngine` — a class that owns a canvas, the worker lifecycle, the
main-thread fallback, and the RAF animation loop. No DOM-id lookups, no UI
strings, no mask/recording/preset knowledge.

### Constructor

```js
new PerlinEngine(canvas, {
  onFrame,        // ({ position, fps, isMain }) => void   — after each painted frame
  transformFrame, // (imageData) => void                   — mutate pixels before paint (e.g. mask)
})
```

Both callbacks are optional.

### Public methods / properties

| Member | Behaviour |
|---|---|
| `setParams(params)` | Store the current (resolved) params. Does not render. |
| `renderOnce()` | Render the current params once at the current `position`. |
| `play()` | Start the RAF loop. No-op if already playing. |
| `pause()` | Stop the RAF loop. |
| `get playing` | Boolean. |
| `seek(value)` | Set the time position (loop progress in `[0,1)` when `params.loop`, else free `t`). Re-anchors the wall-clock origin so a running animation continues smoothly. |
| `get position` | Current time position. |
| `renderFrameAndWait(params)` | Promise resolving when that exact frame has painted (deterministic, for WebM recording). |
| `get fps` | Smoothed FPS (EMA). |
| `destroy()` | Terminate the worker, cancel RAF, drop pending resolves. |

### Internals (moved from `perlin-studio.js`, behaviour-preserving)

- Worker from `MTPerlin.WORKER_SOURCE` via Blob URL; `onerror` → null worker →
  main-thread fallback (`MTPerlin.generatePerlinImage`).
- `requestFrame`: skip if `workerBusy`; bump `latestJobId`; postMessage.
- `onWorkerMessage`: drop stale jobs (`id < latestJobId`); build `ImageData`;
  **call `transformFrame(imgData)` if provided** (this is the mask hook); resize
  canvas if needed; `putImageData`; update FPS EMA; resolve matching
  `pendingResolves`; fire `onFrame`.
- Main-thread fallback path likewise calls `transformFrame` before paint and
  fires `onFrame` with `isMain: true`.
- Wall-clock → position math (from `rafTick`): `animStartTime`,
  `animStartSlider`; loop mode uses `((start + elapsed/loopDuration) % 1 + 1) % 1`,
  linear mode uses `start + elapsed`. The engine writes `loopProgress`/`t` into
  the params it sends and reports the new `position` via `onFrame`; the consumer
  decides what to do with it (studio updates the slider; element ignores it).

The same `WORKER_SOURCE`, skip-if-busy, and stale-drop logic are reused
verbatim — that is the byte-equivalence (regression) guarantee.

## Module: `perlin-element.js` — `<perlin-noise>`

A renderer-only custom element. One `PerlinEngine` instance per element,
pointed at an internal shadow-DOM canvas.

### Configuration API

```html
<perlin-noise preset="lava" autoplay></perlin-noise>
<perlin-noise src="my-preset.json" autoplay max-resolution="1024"></perlin-noise>
```

- **Observed attributes:** `preset`, `src`, `autoplay`, `max-resolution`
  (default `1280`), `static` (force a single still frame).
- **Properties:** `el.params` (get/set, fully-resolved object), `el.play()`,
  `el.pause()`, `el.playing`.
- **Precedence:** explicitly-set `.params` > `src` JSON > `preset` built-in >
  internal default (the `default` built-in).
- `attributeChangedCallback` for `preset`/`src` re-resolves params and
  re-renders; `autoplay`/`static` are evaluated on connect and on change.

### Shadow DOM

```
:host { display: block; }
canvas { display: block; width: 100%; height: 100%; }
```
A single `<canvas>` filling the host box.

### Responsive sizing + resolution cap

- A `ResizeObserver` on the host computes the render resolution:
  `renderEdge = min(cssEdge × devicePixelRatio, maxResolution)` per axis.
  The canvas backing store is set to the capped pixel size; CSS scales it to
  fill the host. This prevents a full-viewport hero from saturating the CPU.
- **Resolution-independent composition.** The preset declares a reference
  `width`/`height`. The element scales the noise coordinates so the preset's
  look is preserved across resolutions: it sends `width = renderW`,
  `height = renderH`, and `scaleX' = scaleX × (refW / renderW)`,
  `scaleY' = scaleY × (refH / renderH)`. Feature size therefore tracks the
  composition, not the raw pixel count. `scaleT`, `loopRadius`, octaves, etc.
  are already resolution-independent and pass through unchanged.

### Accessibility & performance defaults

- **`prefers-reduced-motion: reduce`** → never autoplay; render one static
  frame. A `matchMedia` change listener pauses/resumes live if the user toggles
  the OS setting.
- **`IntersectionObserver`** → pause the engine when the element is fully
  off-screen, resume when visible — but only when the element is in its
  autoplay/playing state. Saves battery/CPU for below-the-fold heroes.
- **One worker per element instance** — simplest, isolated. Fine for a single
  hero; many instances spawn many workers (documented limitation, acceptable
  for v1).

### `file://` behaviour

- `preset` and `.params` work everywhere (no network).
- `src` JSON is fetched with `fetch()`, which may be blocked by CORS under
  `file://`. Documented: `src` is the HTTP(S) embedding path; under `file://`
  use `preset` or `.params`. On fetch failure the element falls back to the
  `default` built-in and logs a console warning.

## `perlin-studio.js` changes (consume engine + presets)

- Import `GRADIENTS` / `BUILTIN_PRESETS` from `MTPerlinPresets` instead of the
  local consts (delete the local copies).
- Replace the inline worker/RAF orchestration (`initWorker`, `renderInMain`,
  `onWorkerMessage`, `requestFrame`, `renderFrameAndWait`, `rafTick`, the
  `animStart*` vars, the worker fields on `state`) with a single
  `PerlinEngine` instance.
  - `onFrame: ({ position, fps }) =>` update the slider readout (`setTValue`)
    and the FPS counter (`els.fpsCounter`).
  - `transformFrame: (imgData) => applyMaskToImageData(imgData)` — the mask hook.
- `renderOnce()` → `engine.setParams(gatherParams-resolved); engine.renderOnce()`.
- `schedulePreview`, slider `input`, loop-mode change → drive `engine.seek` /
  `engine.renderOnce` / re-anchor.
- `play`/`pause`/`togglePlay` → delegate to `engine.play()`/`engine.pause()`.
- `recordWebm` → use `engine.renderFrameAndWait(params)` per frame; keep the
  MediaRecorder/`paramsForRecordingFrame`/progress UI in the studio.
- The studio passes **resolved** params to the engine. Today `gatherParams`
  already resolves the gradient inline; route that through
  `MTPerlinPresets.resolveParams` (or keep gatherParams' resolution and just
  hand the result to the engine) so studio and element resolve identically.

The studio's UI, presets UI, mask, recording, theme, and `gatherParams` DOM
reads all stay in `perlin-studio.js`.

## Demo page: `examples/embed.html`

A minimal standalone page (top-level `examples/`, separate from the media in
`docs/examples/`) demonstrating:
- `<perlin-noise preset="…">` declarative embed,
- a full-bleed responsive hero,
- `src="…"` JSON loading (works when served over HTTP),
- a note on reduced-motion behaviour,
- the four `<script>` includes in order (`perlin.js`, `perlin-presets.js`,
  `perlin-engine.js`, `perlin-element.js`).

## Standalone single-file build (final, delineated step)

`scripts/build-standalone.js` — a Node concatenation script in the style of the
existing `scripts/render-*.js` (no bundler). It concatenates `perlin.js`,
`perlin-presets.js`, `perlin-engine.js`, and `perlin-element.js` into a single
`dist/perlin-noise.js`, so third parties can embed with one `<script>` + one
`<perlin-noise>` tag. Drift risk is mitigated by regenerating in the Forgejo
deploy workflow (or at release time). This is a clearly separate final step,
not part of the core element work.

## Verification

The controller has no automated tests, so the refactor's safety net is manual
browser QA plus byte-equivalent reuse of the worker source.

1. `node --check` on every JS file.
2. `node scripts/smoke-test.js` — guards the math (perlin.js unchanged).
3. **New** `resolveParams` smoke check (pure logic, Node-importable): named
   gradient → correct stops; custom stops passed through; non-gradient modes
   untouched. Added as a new assertion block in `scripts/smoke-test.js`.
4. **Manual studio QA** (regression safety net): play/pause/Space; slider scrub
   in loop *and* linear mode; all five colour modes; custom-gradient editor;
   warp; layer 2; tile; mask load/apply/invert/clear; preset chips; preset JSON
   save/load round-trip; PNG export; WebM record + download; theme toggle;
   worker vs. main-thread fallback (FPS readout shows "(main)").
5. **Element QA:** `preset`, `src`, `.params`; autoplay; responsive resize;
   reduced-motion; off-screen pause; double-click under `file://`.

Sandbox note: `python3 -m http.server` may be blocked from `/Users/Shared/`.
If so, hand the QA checklist to the maintainer to run locally.

## Risks

- **Controller regression** (no automated controller tests) → mitigated by
  byte-equivalent engine internals (same `WORKER_SOURCE`, same skip/stale logic)
  and the manual QA checklist.
- **`src` blocked under `file://`** → documented; `preset`/`.params` are the
  `file://`-safe paths; graceful fallback to the default built-in.
- **Standalone drift** → deferred; regenerate in CI if built.

## Out of scope (v1)

- Full `<perlin-studio>` (controls-in-shadow-DOM) element.
- Per-attribute exposure of all ~40 params.
- Shared worker across multiple element instances.
- A `<perlin-noise>` instance on the studio page itself.

## Documentation touch-list

`CHANGELOG.md` (new feature), `README.md` (roadmap tick + embedding section),
`docs/ARCHITECTURE.md` (the five-layer split + engine/element), `docs/USAGE.md`
(embedding usage), `AGENTS.md` (file-layout table + element notes).
