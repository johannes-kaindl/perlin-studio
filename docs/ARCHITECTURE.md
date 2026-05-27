# Architecture

In-depth technical documentation. Read the [README](../README.md) first
for the broad overview.

## Contents

1. [Code layout](#code-layout)
2. [Math: Perlin noise in 3D and 4D](#math-perlin-noise-in-3d-and-4d)
3. [fBm — Fractal Brownian Motion](#fbm--fractal-brownian-motion)
4. [Loop mechanics: circular orbit in 4D](#loop-mechanics-circular-orbit-in-4d)
5. [Worker pipeline](#worker-pipeline)
6. [Animation loop](#animation-loop)
7. [WebM recording](#webm-recording)
8. [Color modes](#color-modes)
9. [Known edge cases](#known-edge-cases)

---

## Code layout

Two JS files share the responsibility:

```
perlin.js                    perlin-studio.js
├── Math (perlin3, perlin4)  ├── DOM bindings
├── fBm (fbm3, fbm4)         ├── worker setup + fallback
├── colorize()               ├── RAF loop (play/pause)
├── generatePerlinImage()    ├── recording (MediaRecorder)
└── WORKER_SOURCE (string)   └── preset system (built-in + JSON)
```

`perlin.js` is **pure** — no globals, no DOM access. An IIFE exports
to `window.MTPerlin`. The entire module logic is also available as a
string in `MTPerlin.WORKER_SOURCE`; that's what the studio uses to
build a Blob worker. Important so the worker also runs under `file://`
(some browsers block external worker URLs).

`perlin-studio.js` is the **controller** — it reads UI state, sends
frames to the worker, draws responses onto the canvas, drives the
animation, and exports WebM.

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

`colorize(n, params)` maps a noise value `n ∈ [0, 1]` to RGB. Four
variants:

### `rgb` — per channel

```
r = (rInvert ? 1-n : n) · rScale  · 255
g = (gInvert ? 1-n : n) · gScale  · 255
b = (bInvert ? 1-n : n) · bScale  · 255
```

Three sliders per channel, three invert toggles. Identical to the
Python original.

### `gradient` — color stops

`gradientLookup(stops, n)` linearly interpolates over a stops list:
```js
[{ pos: 0.0, color: [68, 1, 84] },
 { pos: 0.5, color: [33, 145, 140] },
 { pos: 1.0, color: [253, 231, 37] }]
```

Eight predefined maps: `viridis`, `magma`, `fire`, `ocean`, `forest`,
`grayscale`, `sunset`, `ice`.

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
effects. Great for terrain height maps and stylisation.

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

### `preset.gradient` must not be serialised

`savePreset()` deletes `gradient` before the JSON dump — the stop list
is large and can be reconstructed from `gradientName`.

### Slider with `loop = false`

The maximum of `2000` is enough for ~33 minutes of animation (at 1 t
unit per second). After that the slider is pinned, but the animation
keeps running internally.
