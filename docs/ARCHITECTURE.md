# Architecture

In-depth technical documentation. Read the [README](../README.md) first
for the broad overview.

## Contents

1. [Code layout](#code-layout)
2. [Math: Perlin noise in 3D and 4D](#math-perlin-noise-in-3d-and-4d)
3. [fBm — Fractal Brownian Motion](#fbm--fractal-brownian-motion)
4. [Domain warping](#domain-warping)
5. [Tileable noise](#tileable-noise)
6. [Loop mechanics: circular orbit in 4D](#loop-mechanics-circular-orbit-in-4d)
7. [Worker pipeline](#worker-pipeline)
8. [Animation loop](#animation-loop)
9. [WebM recording](#webm-recording)
10. [Color modes](#color-modes)
11. [Smoke tests](#smoke-tests)
12. [Known edge cases](#known-edge-cases)

---

## Code layout

Two JS files share the responsibility:

```
perlin.js                          perlin-studio.js
├── Math (perlin3, perlin4)        ├── DOM bindings (els, $)
├── fBm (fbm3, fbm4)               ├── theme toggle + FOUC sync
├── Domain warp                    ├── worker setup + main-thread fallback
│   (warpedFbm3, warpedFbm4)       ├── RAF loop (play/pause)
├── Tile wrap helpers              ├── live-preview debounce
│   (wrapCell, nextCell)           ├── recording (MediaRecorder)
├── colorize()  + variants         ├── preset system (built-in + JSON)
│   (colorizeRgbMulti,             │     incl. custom gradient editor
│    colorizeFlow)                 └── transport bar wiring
├── generatePerlinImage()
└── WORKER_SOURCE (string)

scripts/
├── smoke-test.js                  ← math invariants, gates CI deploy
├── render-readme-images.js        ← regenerates assets/*.png
└── render-readme-videos.js        ← regenerates docs/examples/*.webm
```

`perlin.js` is **pure** — no globals, no DOM access. An IIFE exports
to `window.MTPerlin`. The entire module logic is also available as a
string in `MTPerlin.WORKER_SOURCE`; that's what the studio uses to
build a Blob worker. Important so the worker also runs under `file://`
(some browsers block external worker URLs).

The worker source is built by interpolating each top-level function via
`.toString()` into a template literal — so any new helper added to
`perlin.js` automatically becomes available in the worker as long as
it's listed in the interpolation block at the bottom of the file.

`perlin-studio.js` is the **controller** — it reads UI state, sends
frames to the worker, draws responses onto the canvas, drives the
animation, manages the theme override and the custom gradient editor,
and exports WebM.

`scripts/smoke-test.js` runs all the math invariants (currently 25
assertions across 7 groups). The Forgejo deploy workflow gates on
this — a regression stops the site from being republished.

---

## Math: Perlin noise in 3D and 4D

### Improved Noise (Ken Perlin, 2002)

The standard variant with:
- Permutation table of size 256, duplicated to 512 for lookup without modulo
- `fade(t) = 6t⁵ − 15t⁴ + 10t³` — enforces C² continuity
- Gradient function with 12 (3D) or 32 (4D) standard vectors

### Value properties

- **On grid points** (integer coordinates) → exactly 0. Not a bug —
  that's the definition: every gradient contribution vanishes at the
  corner.
- **Value range** roughly `[-0.88, 0.88]` for `perlin3`, `[-1.08, 1.08]`
  for `perlin4` (4D gradients are longer on average).
- **Continuity**: C² everywhere thanks to the `fade` polynomial.

### Permutation seeding

`makePermutation(base)` shifts the fixed standard permutation by
`base mod 256`:

```js
for (let i = 0; i < 256; i++) perm[i] = BASE_PERM[(i + offset) & 255];
```

Every integer seed is reproducible and produces visually distinct
patterns. **Not** cryptographically random.

### 4D hash convention

In the 4D code the 16 hypercube corners follow a consistent naming:

```
AAAA = (X,   Y,   Z,   W  ) → perm[AAA]      with offset (x,   y,   z,   w  )
AAAB = (X,   Y,   Z,   W+1) → perm[AAA + 1]  with offset (x,   y,   z,   w-1)
AABA = (X,   Y,   Z+1, W  ) → perm[AAB]      with offset (x,   y,   z-1, w  )
AABB = (X,   Y,   Z+1, W+1) → perm[AAB + 1]  with offset (x,   y,   z-1, w-1)
...
```

Important: `AAB = perm[AA+1]+W` is a **Z shift**, while `AAA+1` is a
**W shift**. The offsets in `grad4(...)` must line up — otherwise you
get a discontinuity at `w ≈ 0` (sign flip in `Math.floor`).

The lerp order from inside out is `u (X) → v (Y) → s (Z) → tt (W)`.
The outermost lerp is over the W axis, the middle one over Z.

---

## fBm — Fractal Brownian Motion

```
fBm(x, y, z) = Σ amp_i · perlin3(x · freq_i, y · freq_i, z · freq_i)
               normalised by Σ amp_i
               and mapped to [0, 1]

with  amp_i  = persistence^i
      freq_i = lacunarity^i
      i = 0 .. octaves-1
```

- **`octaves`** — number of frequency levels. More = more detail, more
  compute (linear).
- **`persistence`** — amplitude factor per octave. Small (0.3) ⇒ smooth
  clouds; large (0.7) ⇒ rough terrain.
- **`lacunarity`** — frequency factor per octave. Small (1.5) ⇒
  self-similar structures; large (3.0) ⇒ widely varied detail levels.

Normalising to `[0, 1]` keeps the downstream color computation simple:
`colorize(n)` always takes values in that range.

---

## Domain warping

Inigo-Quilez-style pre-displacement of the sample coordinate by a
second, smoother noise field:

```
warped_fbm(x, y, z) = fbm(x + s·perlin(x·k + ox₁, y·k + oy₁, z),
                          y + s·perlin(x·k + ox₂, y·k + oy₂, z),
                          z)
  with  s = warpStrength
        k = warpScale
        (ox₁, oy₁) = (137,  23)   ← arbitrary fixed offsets in noise
        (ox₂, oy₂) = (211, -53)     space, decorrelate dx from dy
```

The displacement field uses **single-octave** `perlin3` (not full
`fbm3`) — detail in the warp field doesn't help visually and the cost
matters when you sample at every pixel. The two fixed offsets
decorrelate the X-displacement from the Y-displacement so the warp
doesn't degenerate into diagonal streaking.

### Fast path: `warpStrength = 0`

The first line of `warpedFbm3` / `warpedFbm4`:

```js
if (!warpStrength) return fbm3(perm, x, y, z, octaves, persistence, lacunarity, repeatX, repeatY);
```

Bypasses the warp entirely so v0.7-era output is bit-identical when
warp is off. The smoke battery asserts this — `warpStrength=0` must
produce the same float at every sample point as plain `fbm3`.

### Cost

Two extra `perlin3` / `perlin4` calls per pixel when active. For a
256×256 canvas at 30 fps that's ~4M extra noise lookups/sec — fine in
the worker, noticeable in the main-thread fallback.

### Visual character

Domain warping turns Perlin from "Perlin" into:
- **Marble veins** — `strength ≈ 1.5`, `scale ≈ 0.5`, low octaves
- **Ink in water** — `strength ≈ 2`, `scale ≈ 0.3`, `persistence` 0.4
- **Alien terrain** — high strength, mid scale, terrain colour map

See the `marble` built-in preset for a tuned example.

---

## Tileable noise

`perlin3` and `perlin4` accept optional `repeatX` and `repeatY`
parameters. When `> 0`, the integer cell index for that axis wraps
modulo the tile period — both for the corner lookup *and* for the
`+ 1` neighbour lookup. The output then repeats seamlessly every
`repeat` cells in noise space.

```js
function wrapCell(v, period) {
  return period > 0 ? (((v % period) + period) % period) & 255 : v & 255;
}
function nextCell(v, period) {
  return period > 0 ? ((((v + 1) % period) + period) % period) & 255 : (v + 1) & 255;
}
```

Z (3D mode) and W (4D loop) **do not tile**. The loop traces a small
circle in `(z, w)` near the origin and doesn't benefit from spatial
tiling on the time axis. Keeping Z and W infinite preserves the
seamless loop closure on the time dimension.

### Octave scaling in `fbm`

`fbm3` and `fbm4` thread the tile period to each octave, scaled by
the octave frequency:

```js
const rx = repeatX > 0 ? Math.round(repeatX * freq) : 0;
const ry = repeatY > 0 ? Math.round(repeatY * freq) : 0;
sum += amp * perlin3(perm, x * freq, y * freq, z * freq, rx, ry);
```

With integer `lacunarity` (default 2) every octave lands on an
integer multiple of the base period and the tile closes exactly.
Fractional lacunarity produces a small per-octave wrap-slip that
the smoke test catches.

### Warp × tile coupling

The warp samples `perlin3` at *pre-multiplied* coordinates
`(x·s + 137, y·s + 23)`. For the warp's displacement to coincide at
the tile seam, the warp's own wrap period must be `tile · s`, not
`tile`. To keep that integer (perlin3 needs integer cell wrap),
`effectiveWarpScale` rounds `warpScale` to the nearest non-zero
integer whenever both warp and tile are active:

```js
function effectiveWarpScale(warpScale, repeatX, repeatY) {
  const s = warpScale || 1;
  if ((repeatX > 0 || repeatY > 0) && warpScale) return Math.max(1, Math.round(s));
  return s;
}
```

The slider in the UI still moves freely — only the rendered value is
rounded. The Warp section hint in the UI says this. The smoke test
`warpedFbm3 tile seam closes with warp on` caught a real bug here
during development (an earlier fix only rounded the tile period, not
the warp scale itself, leaving a sub-cell slip).

### Regression guarantee

`perlin3(perm, x, y, z, 0, 0)` is bit-identical to
`perlin3(perm, x, y, z)` — the smoke test asserts this across many
sample points so adding the tile feature can't drift the v0.7
rendering.

---

## Loop mechanics: circular orbit in 4D

Linear `t` progress is not loopable — at the end the image snaps back.
Classic trick: **two extra coordinates trace a circle in noise space**.

```
α = loopProgress · 2π
z = cos(α) · loopRadius · scaleT
w = sin(α) · loopRadius · scaleT
output = fbm4(perm, x·scaleX, y·scaleY, z, w, octaves, ...)
```

At `loopProgress = 0`, `(z, w) = (loopRadius·scaleT, 0)`.
At `loopProgress = 1`, `α = 2π` and `(cos, sin) = (1, 0)` — exactly the
starting value. → mathematically seamless.

### Float safety: `safeProgress`

`Math.sin(2 * Math.PI)` is not exactly `0` but about `-2.4·10⁻¹⁶`.
`Math.floor(-1.7·10⁻¹⁶)` is `-1`, which `& 255` indexes as `255` — a
totally different hash, i.e. a **completely different image** at that
one loop endpoint.

Fix:
```js
const safeProgress = ((p % 1) + 1) % 1;
```

→ `progress = 1` and `progress = 0` produce `α = 0` (exact), not
`α = 2π` (with rounding error). In practice the app never renders
`progress = 1` (the RAF loop wraps with `% 1` first), but a manual
slider or test code could hit the edge case.

### `loopRadius` and detail frequencies

In the highest fBm octave the circle has radius `loopRadius · scaleT ·
lacunarity^(octaves-1)`. With defaults `loopRadius=1`, `scaleT=0.15`,
`octaves=6`, `lacunarity=2`, that's `1 · 0.15 · 32 = 4.8` — the circle
traverses 4.8 Perlin cells in the finest detail.

The per-frame step is correspondingly small: `(2π/totalFrames) ·
loopRadius · scaleT` in the base octave, multiplied by the detail
frequency in the highest octave. At 120 frames per loop ≈ 0.005 per
frame in the base octave — a soft ripple.

---

## Worker pipeline

### Setup

```
Main thread                     Web Worker (inline Blob)
┌─────────────────────┐         ┌─────────────────────┐
│ initWorker()        │ blob:// │ const BASE_PERM=... │
│   new Worker(blob)  │────────▶│ const GRAD4=...     │
│                     │         │ (functions from     │
│                     │         │  perlin.js via      │
│                     │         │  .toString())       │
│                     │         │                     │
│ requestFrame(p)     │ params  │ self.onmessage      │
│   workerBusy=true   │────────▶│   perm = ...        │
│   postMessage({id,p})│         │   for x, y:         │
│                     │         │     fbm3/fbm4       │
│                     │         │     colorize        │
│                     │         │   buf = Uint8...    │
│ onWorkerMessage     │ buffer  │   postMessage(      │
│   ImageData(...)    │◀────────│     {id, buffer},   │
│   putImageData      │ transfer│     [buffer])       │
│   workerBusy=false  │         │                     │
└─────────────────────┘         └─────────────────────┘
```

### Idle tracking

```js
function requestFrame(params) {
  if (state.workerBusy) return;   // skip, no queue
  state.workerBusy = true;
  state.latestJobId = ++state.workerJobId;
  worker.postMessage({ id: state.workerJobId, params });
}
```

While the worker computes, further `requestFrame` calls are dropped.
This avoids latency buildup when computation is slower than the display
refresh rate.

### Ignoring stale replies

```js
function onWorkerMessage(e) {
  if (e.data.id < state.latestJobId) return;
  // ...
}
```

If the user changes parameters faster than the worker computes, older
frame responses arrive after a newer job has been requested. Those are
dropped to avoid flicker.

### Transferables for zero-copy

```js
self.postMessage({ id, width, height, buffer: buf.buffer }, [buf.buffer]);
```

The second argument is the **transferable list**: the `ArrayBuffer` is
*transferred* instead of copied. The worker loses ownership; the main
thread gets it instantly. At 256×256 this saves roughly 256 KB of
copying per frame.

### Main-thread fallback

`initWorker()` wraps worker creation in `try/catch`. If it fails (some
Safari versions under `file://`), `state.worker = null` and
`requestFrame` calls `renderInMain(params)` synchronously — that uses
`generatePerlinImage` directly from `perlin.js`.

Tell-tale: the FPS counter shows `... fps (main)`.

---

## Animation loop

### Wall-clock time as the basis

Instead of counting `frameIndex`, animation is anchored to
`performance.now()`:

```js
function rafTick(now) {
  const elapsedSec = (now - animStartTime) / 1000;
  if (params.loop) {
    params.loopProgress = (animStartSlider + elapsedSec / loopDuration) % 1;
  } else {
    params.t = animStartSlider + elapsedSec;
  }
  requestFrame(params);
  state.rafHandle = requestAnimationFrame(rafTick);
}
```

Whether the browser renders at 60 fps or only 15 fps — the animation
"continues" at the same wall-clock pace. At lower framerates there are
larger jumps between frames, but the perceived speed stays the same.

### Slider mode switch

The `t` slider has two modes:
- **Loop on**: range `[0, 1]` step `0.001` — displays `loopProgress`
- **Loop off**: range `[-200, 2000]` step `0.01` — displays free time

`updateLoopMode()` switches between the modes, adjusts min/max/step
and the label.

### Live preview (no play)

`schedulePreview()` runs on every parameter input, debounced
(`setTimeout` 20 ms). In play mode `schedulePreview` is a no-op — the
RAF loop renders anyway.

---

## WebM recording

### Pipeline

```
1. recordWebm():
   - pause() if live animation is running
   - canvas.captureStream(0) — manual mode if `track.requestFrame` exists
     otherwise captureStream(fps) — browser ticks itself
   - MediaRecorder with VP9 (fallback VP8)

2. For each frame i in [0, totalFrames):
   - params = paramsForRecordingFrame(...)
   - await renderFrameAndWait(params) — block on worker
   - track.requestFrame() — push frame into stream
   - setTimeout(frameDelayMs) — ensure browser repaint

3. recorder.stop() + await onstop:
   - chunks → Blob → <video>.src = URL.createObjectURL(blob)
   - enable btnWebmDownload
```

### Loop on: exactly N frames per loop

```js
params.loopProgress = (startSlider + i / totalFrames) % 1;
```

Frame `i = 0` has `progress = startSlider`. Frame `i = totalFrames - 1`
has `progress = startSlider + (N-1)/N`. Frame `N` would be `progress =
startSlider` again — and isn't rendered, because the player jumps back
to the first frame.

→ The exported WebM is exactly one loop, closing cleanly.

### Loop off: consistent with live

```js
params.t = startSlider + i / fps;
```

Live animation runs with `t += elapsedSec`. At `fps = 30`, one frame
= 1/30 second = `t += 1/30`. Recording speed matches the live speed
exactly.

### Codec selection

`chooseRecorderMime()` tries in this order:
1. `video/webm;codecs=vp9` — best quality, safe in Chrome/Edge
2. `video/webm;codecs=vp8` — Firefox-compatible
3. `video/webm` — browser default

If none is supported, recording aborts with an error.

---

## Color modes

`colorize(n, params)` maps a noise value `n ∈ [0, 1]` to RGB. Five
variants — `rgb`, `gradient`, `hsv`, `posterize`, `flow`. Two of
them (`rgb` with per-channel toggle, and `flow`) take **more than
one noise sample per pixel**, so the render loop branches on the
mode before calling the appropriate helper.

### `rgb` — per channel

Standard (single noise sample):
```
r = (rInvert ? 1-n : n) · rScale  · 255
g = (gInvert ? 1-n : n) · gScale  · 255
b = (bInvert ? 1-n : n) · bScale  · 255
```

When `rgbMultiChannel` is on, the render loop instead samples
**three independent noise fields** at offset positions (53 cells in
X for green, 71 cells in Y for blue) and feeds them to
`colorizeRgbMulti(nr, ng, nb, params)`:

```
r = (rInvert ? 1-nr : nr) · rScale · 255
g = (gInvert ? 1-ng : ng) · gScale · 255
b = (bInvert ? 1-nb : nb) · bScale · 255
```

The offsets are small enough to share the permutation table but
large enough that the three samples are visually decorrelated. Cost:
3× the fbm calls in RGB-multi mode.

### `gradient` — color stops

`gradientLookup(stops, n)` linearly interpolates over a stops list:
```js
[{ pos: 0.0, color: [68, 1, 84] },
 { pos: 0.5, color: [33, 145, 140] },
 { pos: 1.0, color: [253, 231, 37] }]
```

Nine palettes, including a user-defined **Custom** option:
`viridis`, `magma`, `fire`, `ocean`, `forest`, `grayscale`,
`sunset`, `ice`, `custom`.

The custom gradient is held in `state.customStops` (controller-side)
and edited through an inline UI editor that rebuilds itself from
the array on every change. Stops re-sort by position on slider
release. JSON preset save/load round-trips the stops through the
`gradient` field — `savePreset` keeps the field only when
`gradientName === "custom"`, otherwise it's dropped because named
presets can be reconstructed from the name alone.

### `hsv` — hue from noise

```
hue = (hsvHueShift + n · hsvHueRange) % 1
output = hsvToRgb(hue, hsvSat, hsvVal)
```

Saturation and value are constant, only the hue varies. Good for
aurora, plasma, and spectral effects.

### `posterize` — N steps + gradient

```
quantized = floor(n · steps) / (steps - 1)
output = gradientLookup(palette, quantized)
```

Reduces the noise to a few discrete levels, yielding cartoon-like
effects. Great for terrain height maps and stylisation. Uses the
same gradient palettes as the `gradient` mode (including custom
stops).

### `flow` — gradient direction

Visualises the noise as a **vector field**. The render loop takes a
3-point stencil per pixel:

```
n0 = noise(x,       y)
n1 = noise(x + ε,   y)
n2 = noise(x,       y + ε)
dx = n1 − n0,  dy = n2 − n0
```

and passes `(dx, dy)` to `colorizeFlow`:

```
angle = atan2(dy, dx)               in (-π, π]
hue   = angle / (2π) + 0.5 + flowHueShift   (mod 1)
mag   = sqrt(dx² + dy²)
v     = clamp(flowFloor + mag · flowGain · (1 − flowFloor), 0, 1)
out   = hsvToRgb(hue, flowSat, v)
```

The output reads as a wind map / storm front. Flat areas of the
noise read dark (small magnitude → low brightness, lifted by
`flowFloor`); ridges and edges read bright with hues that rotate
with the local flow direction. `ε` is the stencil offset — small
ε gives sharper contrast, larger ε softens.

Cost: 3× the fbm calls (three samples per pixel). Compatible with
warp (warp the underlying field, then sample its gradient) and with
loop / tile (those properties carry through to the flow
visualisation).

### Render-loop branching

`generatePerlinImage` and the worker source pick the right sampling
strategy once per render, then iterate pixels:

```js
const isFlow  = colorMode === "flow";
const isMulti = colorMode === "rgb" && rgbMultiChannel;
// inside the pixel loop:
if (isFlow)     { /* 3-sample stencil → colorizeFlow */ }
else if (isMulti) { /* 3 offset samples → colorizeRgbMulti */ }
else            { /* single sample → colorize */ }
```

The branch is per-pixel but the conditions are loop-invariant
constants in modern engines, so it inlines cheaply.

---

## Smoke tests

`scripts/smoke-test.js` runs all the math invariants the project relies
on. It's a single Node script — no test framework — that loads
`perlin.js` via the documented `global.window = {}` + `require()`
pattern. The Forgejo deploy workflow runs it before publishing; a
failure stops the deploy.

The current battery (25 assertions across 7 groups):

| Group | What it covers |
|-------|----------------|
| A. Permutation | length, seed reproducibility, seed difference |
| B. Value range | `perlin3` and `perlin4` stay inside `[-1.05, 1.05]` |
| C. Loop identity | `progress=0` and `progress=1` produce identical frames bytewise, plus bit-exact `(z, w)` and `perlin4` across many sample points (regression guard for `safeProgress`) |
| D. Z / W axis | `perlin4` actually responds to z and w separately, and they're not collinear (regression guard for the axis-swap math bug class) |
| D2. Domain warp | `warpStrength=0` is bit-identical to plain fbm (fast-path regression); `warpStrength>0` actually displaces the sample |
| E. colorize range | all four `colorize` helpers stay in `[0, 255]` |
| F2. Tileable noise | `repeat=0` is bit-identical to no-arg call; tile-X seam closes for perlin3 / perlin4 / fbm3 / **warpedFbm3** (the warp test caught a real bug during development); tile-Y seam closes |
| G. Render-loop divergence | `rgbMultiChannel=true` and `colorMode='flow'` actually produce different bytes than the baseline RGB path (guards against the new render branches becoming silent no-ops) |

The pattern is "regression guard plus sanity guard" — for every
feature toggle, one test confirms the **off** state is unchanged
from before, another confirms the **on** state actually does
something. That keeps the smoke from becoming a tautology.

### Running locally

```bash
node scripts/smoke-test.js
```

Exit 0 = all green, exit 1 = failure with which assertion failed.

### Writing new invariants

When adding a feature that touches `perlin.js`:

1. Add the new helper alongside the existing ones (top-level
   function — it gets auto-included in the worker source).
2. List it in `MTPerlin = { ... }` at the bottom so it's testable
   from Node.
3. Add a smoke test that asserts the **off** state is bit-identical
   to the pre-feature behaviour. This is the regression guarantee.
4. Add a smoke test that asserts the **on** state actually changes
   the output meaningfully. Otherwise a future refactor could
   silently no-op the feature.

---

## Known edge cases

### Worker resolution change

When resolution changes (width/height edited), a worker frame at the
old resolution can come back after the canvas has already been resized.
`onWorkerMessage` sets `canvas.width = width` and `canvas.height =
height` before calling `putImageData` — no crash, no stretched image.

### Browsers without `requestFrame`

`captureStream(0)` needs `track.requestFrame()`. If unavailable, the
code falls back to `captureStream(fps)` — the browser decides when to
capture a frame. With `await setTimeout(frameDelayMs)` between frames,
the browser has enough time to see the current canvas image.

### `preset.gradient` is serialised only for custom palettes

`savePreset()` strips `params.gradient` before the JSON dump when
`gradientName` is one of the named presets — the stop list is large
and can be reconstructed from the name. When `gradientName ===
"custom"` the gradient *is* the user's data, so the field stays in
the JSON. `applyParamsToUi` mirrors this on load: a `custom` preset
with a `gradient` array pulls it into `state.customStops` and rebuilds
the editor.

### Slider with `loop = false`

The maximum of `2000` is enough for ~33 minutes of animation (at 1 t
unit per second). After that the slider is pinned, but the animation
keeps running internally.
