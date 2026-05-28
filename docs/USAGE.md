# User guide

Detailed explanation of every UI element and parameter. For the
quick start see [README](../README.md); for the tech behind the
curtain see [ARCHITECTURE](ARCHITECTURE.md).

## Contents

1. [UI overview](#ui-overview)
2. [01 · Resolution & tile](#01--resolution--tile)
3. [02 · Noise](#02--noise)
4. [03 · Layer 2](#03--layer-2)
5. [04 · Warp](#04--warp)
6. [05 · Loop](#05--loop)
7. [06 · Color mode](#06--color-mode)
   - [RGB · per channel](#rgb--per-channel)
   - [Gradient · preset](#gradient--preset)
   - [HSV · hue from noise](#hsv--hue-from-noise)
   - [Posterize · steps + gradient](#posterize--steps--gradient)
   - [Flow · gradient direction](#flow--gradient-direction)
8. [07 · Mask](#07--mask)
9. [08 · Presets](#08--presets)
10. [09 · Export](#09--export)
11. [Transport bar](#transport-bar)
12. [Theme toggle](#theme-toggle)
13. [Embedding (`<perlin-noise>`)](#embedding-perlin-noise)
14. [Tips and workflows](#tips-and-workflows)
15. [Keyboard shortcuts](#keyboard-shortcuts)

---

## UI overview

```
┌────────────────────────────────┬─────────────────────────────────────┐
│ SIDEBAR                        │ MAIN OUTPUT                         │
│                                │                                     │
│  01 · Resolution & tile        │  ┌──────────────────────────────┐   │
│   Width, Height                │  │ FRAME                  • LIVE│   │
│   Tile X, Tile Y               │  │                              │   │
│                                │  │       Live preview canvas    │   │
│  02 · Noise                    │  │                              │   │
│   scale x, scale y, time scale │  └──────────────────────────────┘   │
│   base, octaves,               │                                     │
│   persistence, lacunarity      │  ▶  ⏮   ━━●━━━━ t = 0.42  fps 30    │
│                                │                            f   120  │
│  03 · Layer 2                  │  > Ready.                    30 fps │
│   ☐ Enable, sx/sy/oct/base     │                                     │
│   blend mode, mix              │                                     │
│                                │                                     │
│  04 · Warp                     │                                     │
│   strength, scale              │                                     │
│                                │                                     │
│  05 · Loop                     │                                     │
│   ☑ Seamless loop              │                                     │
│   Loop duration, Loop radius   │                                     │
│                                │                                     │
│  06 · Color mode               │                                     │
│   Dropdown + per-mode inputs   │                                     │
│                                │                                     │
│  07 · Mask                     │                                     │
│   Load | Clear, ☐ Apply,       │                                     │
│   ☐ Invert                     │                                     │
│                                │                                     │
│  08 · Presets                  │                                     │
│   Save JSON | Load JSON        │                                     │
│   [default] [lava] [aurora]    │                                     │
│   [clouds] [terrain] [circuit] │                                     │
│   [marble] [nebula] [flow]     │                                     │
│   [composite]                  │                                     │
│                                │                                     │
│  09 · Export                   │                                     │
│   PNG | WebM | Download WebM   │                                     │
└────────────────────────────────┴─────────────────────────────────────┘
                                                  Topbar: brand · ☀/🌙
```

The sidebar holds all parameters. Sections are numbered to make the
workflow scannable — typical order of editing is top to bottom. Every
input updates the preview live (small debounce). The main panel shows
the canvas with a permanent `FRAME` tag in the top-left and a pulsing
`• LIVE` badge in the top-right (decorative — no JS hook).

The transport bar below the canvas holds Play/Pause, Reset-t, the t
slider, fps and frames inputs. A status line + circuit-cyan FPS pill
sit underneath.

---

## 01 · Resolution & tile

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| **Width**  | 4–1024 | 256 | Canvas pixel width |
| **Height** | 4–1024 | 256 | Canvas pixel height |
| **Tile X** | 0–64 cells | 0 | When > 0, the noise X axis wraps every N noise cells — output tiles seamlessly horizontally |
| **Tile Y** | 0–64 cells | 0 | When > 0, the noise Y axis wraps every N noise cells — output tiles seamlessly vertically |

**Resolution practical advice**

- 128–256 for live parameter tweaking
- 384–512 for higher-quality export
- 768+ takes noticeably longer per frame — the worker stays fast
  enough for previewing, but animation can drop below 30 fps

The canvas stretches to fit its container, so width/height affect
the display ratio. For non-square ratios pick the dimensions that
match your downstream use (e.g. 1280×360 for a banner, 384×256 for
a video frame).

**Tile X / Tile Y**

The tile is measured in *noise cells*, not pixels. The physical
period in pixels is `Tile / scaleX` (or `/ scaleY`). With default
`scaleX = 0.02` and `Tile X = 8`, the horizontal tile = 400 pixels.

Tiling is independent of the seamless time loop — both can be on at
the same time. The noise still loops in time (4D circular path) and
also wraps in space.

**Constraints to know**

- `Tile X / Y` only affects perlin3 and perlin4 on the X and Y axes.
  Z (3D linear time) and W (4D loop time) stay infinite so the loop
  closure isn't disturbed.
- When **Warp** is also active, `Warp scale` is internally rounded
  to the nearest non-zero integer so the warp's wrap period
  (`tile · scale`) lands on an integer cell. Otherwise the seam
  would slip by a fractional cell. The Warp section hint says this
  too.
- High `octaves` + small `Tile` can over-constrain the noise — the
  detail wraps very fast and the image looks repetitive. If a tile
  is too small for the desired detail, either grow the tile or drop
  the octaves.

---

## 02 · Noise

### `scale x`, `scale y`

Pixel-to-noise scaling on the spatial axes.

| Value | Effect |
|-------|--------|
| 0.005 | very coarse, low detail |
| 0.02 | medium clouds (default) |
| 0.05 | fine, denser structures |
| 0.1+ | quasi-noisy pattern |

Different X/Y values give stretched structures (great for aurora
bands or horizontal waves). With **Tile X / Y** active these scales
also determine the physical tile size in pixels.

### `Time scale` (internal: `scaleT`)

Scales the time axis of the noise.

| Value | Effect |
|-------|--------|
| 0.05 | extremely slow, almost static ripple |
| 0.15 | gentle ripple (default) |
| 0.3 | visible motion |
| 0.5+ | hectic flicker (likely too fast to feel "natural") |

**Rule of thumb**: similar in size to `scale x` / `scale y`. The
0.15 default is a good starting point for 30-fps animations.

### `base` (seed)

An integer (can be negative). Shifts the permutation table
deterministically. Different seeds → completely different patterns
under otherwise identical parameters. Useful for "rolling the dice"
when you don't like the current pattern.

### `octaves`

Number of fBm frequency levels. 1–10.

| Value | Effect |
|-------|--------|
| 1 | pure smooth clouds, no detail |
| 3 | soft structures with some variation |
| 6 | classic fBm look (default) |
| 8+ | very fine detail, possibly noisy |

**Performance**: each extra octave roughly doubles the frequency
and therefore the required sampling density — linear in compute
time.

### `persistence`

Amplitude factor between octaves, 0–2. Default 0.5.

| Value | Effect |
|-------|--------|
| 0.3 | upper octaves very weak → smooth, cloud-like structures |
| 0.5 | classic (default) |
| 0.7 | upper octaves prominent → rough terrain |
| 1.0 | all octaves equally strong → very noisy |

### `lacunarity`

Frequency factor between octaves, 1–8. Default 2.0.

| Value | Effect |
|-------|--------|
| 1.5 | self-similar, "organic" structures |
| 2.0 | classic (default) |
| 3.0+ | strongly differing detail levels, almost "electric" |

The `circuit` preset uses `lacunarity = 3.0` for its characteristic
circuit-board look.

**Tile note:** for clean tiling, `lacunarity` should be an integer
(2 is the default and ideal). Non-integer lacunarity scales the
per-octave wrap period and the smoke test catches the slip.

---

## 03 · Layer 2

A second noise field composited on top of the main one with a chosen
blend mode. The second field shares the loop / warp / tile settings
with Layer 1, but has its own spatial scale, octave count, and seed.

```
n_main      = fbm₁(x · scaleX,  y · scaleY,  ...)
n_layer2    = fbm₂(x · l2scaleX, y · l2scaleY, ..., l2octaves, base: l2base)
composite   = blend(n_main, n_layer2, blendMode)
output      = (1 − mix) · n_main + mix · composite
```

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| **Enable Layer 2** | checkbox | off | Compositing is fully bypassed when off — the render path matches v0.10 exactly. |
| **scale x / scale y** | step 0.005 | 0.06 | Spatial scale of the second field. Use a different value from Layer 1 to get a *different size* of structure (otherwise you're just adding the same field to itself). |
| **octaves** | 1–10 | 4 | Octave count for the second field. Lower than Layer 1 for soft overlays; higher for fine detail on top. |
| **base (seed)** | int | 101 | Permutation seed for the second field. Different from Layer 1's `base` so the two fields are visually independent. |
| **blend mode** | dropdown | multiply | How the two fields combine. See the modes below. |
| **mix** | 0–1 | 0.5 | Linear interpolation between Layer 1 alone (0) and the full blend (1). Lets you ease a Layer 2 effect in or out without changing the blend mode. |

### Blend modes

All operate on values in `[0, 1]` and return values in `[0, 1]`.

| Mode | Formula | Character |
|------|---------|-----------|
| **multiply** | `n₁ · n₂` | Darkens where either layer is dim. Classic for embossing one pattern onto another. |
| **add** | `min(n₁ + n₂, 1)` | Lightens; the union of bright regions. Can blow out — pair with low `mix` for subtler results. |
| **screen** | `1 − (1 − n₁)(1 − n₂)` | Inverse of multiply. Lifts darks, preserves brights — softer than add. |
| **darken** | `min(n₁, n₂)` | Keeps only the darker layer per pixel. Reveals contour lines. |
| **lighten** | `max(n₁, n₂)` | Keeps only the brighter layer per pixel. |
| **difference** | `|n₁ − n₂|` | Distance between layers; sharp boundaries where they cross. Looks unstable, useful for stylised effects. |

### Why a separate seed

Layer 2 uses its own permutation table built from `base2`. Using the
same `base` would just produce a scaled version of Layer 1 — adding
no new information. With a distinct seed the two fields are
statistically independent, which is what makes composite results
look like "two materials" rather than "one material at two scales".

### Mode restrictions

Layer 2 is **ignored** when:
- `colorMode` is `flow` — flow needs three samples per pixel for the
  gradient stencil; layering would 6× the cost.
- `colorMode` is `rgb` and Per-channel noise is on — that mode also
  needs three samples per pixel.

The UI hint in the section notes this. Switching to a layer-aware
colour mode (`gradient`, `hsv`, `posterize`, single-sample `rgb`)
re-activates Layer 2 automatically; nothing to reconfigure.

### Performance

When the layer is active, the render path makes two `warpedFbm`
calls per pixel instead of one. Roughly 2× the per-frame cost. The
worker fallback can dip below 30 fps at 384×256 with both layers at
octaves 5+; the worker path handles it fine on most machines.

---

## 04 · Warp

Domain warping — pre-displaces the noise sample point by a second,
smoother noise field before the main fbm runs. Output stops looking
like raw Perlin: marble veins, ink in water, alien terrain.

```
warped(x, y) = fbm(x + strength · perlin(x·scale, y·scale),
                   y + strength · perlin(…))
```

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| **strength** | 0–3 | 0 (off) | How far each sample point gets pushed. 0 = no warp = identical output to v0.7. 0.5 = subtle veins. 1–2 = pronounced marble. 3 = chaotic. |
| **scale** | 0.1–4 | 1 | Frequency of the displacement field. < 1 = slow, sweeping warp. > 1 = faster, finer warp ripples. |

The warp uses a single-octave Perlin sample for displacement (cheap)
plus two fixed offsets in noise space to decorrelate the X and Y
components. Performance cost: ~2 extra perlin calls per pixel when
strength > 0; when strength = 0 the warp is bypassed entirely (fast
path).

**Practical tips**

- For Marble-like looks try `strength ≈ 1.5`, `scale ≈ 0.5`,
  octaves 3–4, and the `sunset` gradient (this is exactly the
  `marble` built-in preset).
- For dense, swirly textures crank `scale` up to 2–3 and lower
  `octaves` to 2–3.
- For ink-in-water vibes use `strength ≈ 2`, `scale ≈ 0.3`,
  `persistence ≈ 0.4`, and a HSV mode with a narrow `hue range`.

**Tile interaction**

When **Tile X / Y** is active, `Warp scale` is rounded internally to
the nearest non-zero integer. This guarantees the warp displacement
also closes at the tile seam — otherwise the warped output would
have a visible discontinuity at the seam. The slider still moves
freely but the rendered value is the rounded one. The Warp section
hint in the UI says the same.

---

## 05 · Loop

### `Seamless loop` (checkbox, default on)

Switches between two animation modes:

- **On (loop mode)**: 4D Perlin on a circular orbit. After `Loop
  duration` seconds the animation closes seamlessly back to the
  start.
- **Off (linear mode)**: 3D Perlin with linear time. The animation
  ripples gently but is not loopable (there's a visible jump at the
  end of WebM export).

The t-slider's range/labels switch with the checkbox:
- Loop on: `[0, 1]` step 0.001, labelled *Loop progress*
- Loop off: `[-200, 2000]` step 0.01, labelled *t*

### `Loop duration (sec)`

How long a loop lasts. 0.5–60 seconds, default 4.

Suggestions:
- 2–4 sec for "breathing" GIF-style loops
- 6–10 sec for relaxed background animations
- 15+ sec when the loop should barely be perceivable as one

### `Loop radius`

How far the image "travels" in noise space over one full revolution.
0–4, default 1.0.

| Value | Effect |
|-------|--------|
| 0.2 | very subtle motion, near-static |
| 0.5 | light ripple |
| 1.0 | visible animation (default) |
| 2.0+ | strong change, may show detail-level discontinuities at high octaves |

**Watch out** with large values + high octaves: `loopRadius` is
multiplied internally by each octave's frequency. With `loopRadius
= 2`, `octaves = 8`, `lacunarity = 2`, the circle in the highest
octave already covers 256 cells — the loop is still mathematically
seamless but looks restless.

---

## 06 · Color mode

Five modes, picked from the dropdown. Each reveals its own
parameter block beneath the selector. The other blocks stay in the
DOM but `hidden`.

### RGB · per channel

```
r scale | g scale | b scale     (each a 0–2 slider)
r invert | g invert | b invert  (each a checkbox)
☐ Per-channel noise — each channel its own sample
```

Three independent channels. Each channel:
- **Scale** multiplies the noise value (0 = channel off, 1 = full,
  2 = overexposed).
- **Invert** flips the value (`1 - n` instead of `n`).

**Per-channel noise** (the bottom toggle): when on, the renderer
samples *three independent noise fields* per pixel (taken at offset
positions in noise space, same permutation table) and feeds one to
each of R / G / B. Channels drift independently — film-grain,
nebula and stellar-cloud looks become reachable, which the
single-sample RGB mode can't do.

Performance: 3× the fbm cost in RGB mode when the toggle is on. The
toggle is off by default and existing presets that pre-date v0.9
keep their look.

**Examples (single-sample)**
- pure green, normal:  `r=0, g=1, b=0, invert: -, g, -`
- magenta: `r=1, g=0, b=1, all invert off`
- yellow-on-black: `r=1, g=1, b=0`

**Examples (per-channel)**
- nebula vibes: `r=1, g=0.7, b=1.1, invert all off`, multi on
- noise grain on a base: `r=g=b=0.8`, multi on, low octaves

### Gradient · preset

Pick one of nine palettes:

| Name | Character |
|------|-----------|
| Viridis | scientific, purple → yellow |
| Magma | black → magenta → yellow |
| Fire | black → red → orange → white |
| Ocean | deep blue → light blue → white |
| Forest | dark green → light green → beige |
| Grayscale | black → white |
| Sunset | dark purple → orange → cream |
| Ice | deep blue → ice blue → white |
| **Custom …** | *user-defined stops, edited inline (see below)* |

The bar under the dropdown previews the gradient with tick labels
(0.0 / 0.25 / 0.5 / 0.75 / 1.0).

**Custom gradient editor**

Pick `Custom …` and an inline editor appears under the preview. Each
row is one stop:

- **Position slider** (0–1) — where on the gradient bar the stop
  sits. Stops re-sort by position automatically when you release
  the slider, so you can drag a stop past its neighbours without
  fear.
- **Colour picker** — native browser colour input. Live updates the
  gradient preview.
- **× remove** — delete the stop. Disabled when only two stops
  remain (a gradient needs at least two).
- **+ add stop** — appends a stop at the midpoint of the largest
  gap with a colour interpolated between its neighbours.

The custom gradient is in-memory state. It survives switches
between named presets and back to `Custom …`. It's also saved/loaded
through JSON presets via the existing `gradient` field — no extra
ceremony, the stops just travel with the rest of the parameters.

Default seed on first activation: the viridis stops, so there's
always something to edit immediately.

### HSV · hue from noise

```
hue shift   (0–1)  — hue offset
hue range   (0–1)  — hue bandwidth across the image
saturation  (0–1)  — saturation (constant)
value       (0–1)  — value/brightness (constant)
```

The noise value drives the hue only. Saturation and value are
constant across the image → produces evenly saturated, "neon"
looks.

**Examples**
- Aurora: `shift=0.30, range=0.48, sat=0.88, val=1.0` (cyan-blue-purple)
- Plasma: `shift=0, range=1, sat=1, val=1` (full rainbow spectrum)
- Sepia tone: `shift=0.08, range=0.1, sat=0.6, val=0.9`

### Posterize · steps + gradient

```
Steps            (2–16) — number of discrete color levels
Gradient preset  — one of the nine palettes (Custom … also available)
```

The noise is quantised to N equal steps (`floor(n · steps) /
(steps - 1)`), then mapped onto the gradient. Yields cartoon-like
banding — great for terrain height maps and stylised effects.

Custom gradient stops work here too — the same custom-stops editor
shows up when `Custom …` is picked from the posterize gradient
dropdown.

### Flow · gradient direction

A vector-field visualisation. Instead of mapping the noise *value*
to colour, the renderer takes a 3-point stencil per pixel and
computes the local *gradient direction*:

```
n0 = noise(x,        y)
n1 = noise(x + ε,    y)
n2 = noise(x,        y + ε)
dx = n1 − n0,  dy = n2 − n0
hue = atan2(dy, dx) / (2π) + hueShift
brightness = floor + magnitude · gain
```

The output reads like a wind map or storm front — areas where the
noise is flat read dark, edges and ridges read bright with hues
that rotate with the flow direction.

```
hue shift   (0–1)         — rotate the colour wheel
saturation  (0–1)         — constant saturation
gain        (0.1–20)      — multiplier for the magnitude → brightness
floor       (0–0.6)       — baseline brightness so flat regions don't go fully black
stencil ε   (0.1–3)       — pixel offset for the gradient stencil
```

Performance: 3× the fbm cost (three samples per pixel). Compatible
with **Warp** (warp the underlying field, then sample its gradient)
and with **Loop** (loop the underlying field, the flow visualisation
loops too). Stencil ε around 0.6 works well at default scaleX; with
very small scaleX (very coarse noise) you may need a larger ε to
read the gradient.

---

## 07 · Mask

Load a PNG / JPG / WebP and use its alpha (or luminance) as a per-
pixel multiplier on the canvas alpha channel. Where the mask is
transparent (or dark, for opaque source images), the noise is
hidden; where it's opaque (or bright), it shows through.

| Control | Effect |
|---------|--------|
| **Load image** | Opens a file picker. PNG with an alpha channel is the cleanest — the alpha *is* the mask. JPG / fully-opaque PNG falls back to luminance (Rec. 709) so a black-on-white silhouette also works. |
| **Clear** | Drops the mask from memory. |
| **Apply mask** | Toggle. On by default after loading. When off, the mask is kept in memory but not applied — useful for A/B comparisons. |
| **Invert (transparent regions show noise)** | Flips the alpha — useful when your source is a silhouette where the "shape" is the bright/opaque part but you want to mask *around* it. |

### How the mask is sampled

The loaded image is **stretched** to the current canvas resolution
on first use and cached as a `Uint8Array` of alpha bytes. When you
change Width or Height the cache rebuilds at the new size — small
hit on the next frame, then cached again.

If you want the mask to *not* stretch, match its aspect ratio to
the canvas (e.g. a 1024×512 mask paired with a 1024×512 canvas).

### Export behaviour

| Export | Mask result |
|--------|-------------|
| **PNG (current frame)** | Includes the alpha channel — masked regions are *transparent* in the PNG. Open in an editor and the canvas underneath shows through. |
| **WebM** | RGB-only codec. Masked regions render onto whatever's behind the canvas at recording time (usually the page background). The video itself is not transparent. |

### Practical use cases

- **Branded textures** — render a Perlin animation only inside a
  logo silhouette. Save the silhouette as a PNG with transparent
  background, load, done.
- **Vignettes** — load a radial-gradient PNG (centre opaque, edges
  transparent) for a feathered edge.
- **Composite passes** — render the same noise twice with two
  different masks, then composite in Affinity / Photoshop / Pixelmator.

### Limitations

- Resolution-dependent — the mask is rasterised to canvas size, so
  changing canvas dimensions stretches the mask. (See the "match
  aspect" note above.)
- The mask alpha is applied directly to the canvas pixel alpha.
  The RGB stays untouched, so you can't use a coloured mask to tint
  the noise (use the gradient editor or HSV mode for tinting).

---

## 08 · Presets

### Save JSON

Downloads the current parameter state as JSON
(`perlin-preset-<timestamp>.json`).

### Load JSON

Loads a previously saved JSON file (or one you wrote yourself).
Invalid JSON produces an error in the status bar.

JSON shape (showing a custom-gradient preset):
```json
{
  "width": 384,
  "height": 256,
  "tileX": 0,
  "tileY": 0,
  "scaleX": 0.015,
  "scaleY": 0.015,
  "scaleT": 0.12,
  "base": 7,
  "octaves": 5,
  "persistence": 0.65,
  "lacunarity": 2.2,
  "warpStrength": 1.6,
  "warpScale": 0.6,
  "colorMode": "gradient",
  "gradientName": "custom",
  "gradient": [
    {"pos": 0.0, "color": [12, 12, 60]},
    {"pos": 0.6, "color": [240, 110, 80]},
    {"pos": 1.0, "color": [255, 245, 200]}
  ],
  "loop": true,
  "loopDuration": 6,
  "loopRadius": 1.0
}
```

Fields not present keep their current UI value.

### Built-in presets (chips)

| Preset | Look | Notable params |
|--------|------|----------------|
| `default` | green, gently rippling default noise | RGB mode |
| `lava` | deep red-orange glowing lava flows | `fire` gradient, persistence 0.65 |
| `aurora` | green → cyan → blue → violet polar light | HSV mode, narrow hue range |
| `clouds` | soft black-and-white clouds | grayscale gradient, octaves 7 |
| `terrain` | banded landscape with a contour-line look | forest posterize, 6 steps |
| `circuit` | hard-edged cyan/black pattern | ocean posterize, lacunarity 3 |
| `marble` | warm stone-vein swirls | warp strength 1.6, sunset gradient |
| `nebula` | drifting RGB channels on a soft warp | per-channel noise + warp |
| `flow` | storm-front-like vector field | flow colour mode, high gain |
| `composite` | layered cloud-and-contour pattern | Layer 2 multiply blend on ice gradient |

Clicking a chip loads the preset immediately and renders it.

---

## 09 · Export

### PNG · current frame

Saves the currently visible frame as PNG. Filename:
`perlin-<timestamp>.png`. Resolution matches the canvas.

### WebM animation

Renders `frames` frames at `fps` fps and exports as WebM (VP9 when
available, VP8 otherwise). While recording:
- Buttons are disabled
- A progress bar shows progress
- The status line shows the current frame

When done, the canvas is replaced by a `<video>` preview. The
**Download WebM** button becomes visible. Filename:
`perlin-animation-<timestamp>.webm`.

**Loop on + WebM**: exactly `frames` frames per loop, closes
perfectly.

**Loop off + WebM**: linear through time, the video snaps back
when replayed.

### Recommended export settings

| Use case | frames | fps | Duration | Loop |
|----------|--------|-----|----------|------|
| Social media snippet | 90 | 30 | 3 s | on |
| Website header loop | 180 | 30 | 6 s | on |
| Long background video | 600 | 24 | 25 s | off |
| Test / preview | 30 | 15 | 2 s | either |

WebM files are roughly 50–500 KB for short loops at moderate
resolution. Higher octaves + warp + flow modes increase the
per-frame cost but barely affect output file size.

---

## Transport bar

| Control | Function |
|---------|----------|
| **▶** / **⏸** | Play/pause the live animation. Alternative: **Space** |
| **⏮** | Slider back to 0 (`t = 0` or `loopProgress = 0`) |
| **t slider** | Scrubbing; range depends on loop mode |
| **fps** (1–60) | Export framerate; in live mode the app renders as fast as it can |
| **frames** (1–600) | Frame count for WebM export |

The slider label flips between *Loop progress* and *t* depending
on whether **Seamless loop** is on. Below the bar: a `>`-prefixed
status line (the prompt-glyph flips to `!` on error) and a
circuit-cyan FPS pill that shows once the worker has produced its
first frame. The badge reads `… fps (main)` when the worker
fallback is active.

---

## Theme toggle

A sun/moon icon sits at the right end of the topbar. By default the
page follows `prefers-color-scheme` — your OS decides. Click the
toggle once to pin an explicit choice (Dark or Light); the icon
flips to show the *next* state you'd get on click.

Behaviour:
- First-load: follow OS theme. Icon shows the destination ("would
  switch to *light*").
- Click → set explicit override, save to `localStorage`. Page paints
  in the new theme; PWA / address-bar `theme-color` updates too.
- Reload: explicit override is restored before stylesheet paint
  (inline `<head>` script — no flash of wrong theme).
- Clear the override: in DevTools run
  `localStorage.removeItem("perlin-studio:theme")`, then reload.

Both themes use the same hue palette (phosphor / circuit / spectre)
with contrast-corrected variants for light mode. The colour
modes, presets, and exports look the same in both themes — only
the chrome differs.

---

## Embedding (`<perlin-noise>`)

Besides exporting a WebM, you can embed the *live* animation on a page
with the `<perlin-noise>` custom element — a renderer with no controls.
Include the four scripts in order, then drop the tag:

```html
<script src="perlin.js"></script>
<script src="perlin-presets.js"></script>
<script src="perlin-engine.js"></script>
<script src="perlin-element.js"></script>

<perlin-noise preset="aurora" autoplay></perlin-noise>
```

**Configuration** (precedence high → low):

| How | Example | Notes |
|-----|---------|-------|
| `params` property | `el.params = {...}` | A full params object; wins over attributes. |
| `src` attribute | `src="loop.json"` | A preset exported via **Save preset**. Needs an HTTP server — `fetch` is blocked under `file://`. |
| `preset` attribute | `preset="lava"` | A built-in name. Works under `file://`. |
| (none) | | Falls back to the `default` preset. |

**Other attributes:** `autoplay` (start animating), `static` (force a
single still frame), `max-resolution` (render cap in px on the longest
edge, default 1280).

**Behaviour:** the element fills its container and renders at the
displayed size × devicePixelRatio, capped at `max-resolution`, so a
full-bleed hero stays cheap. The preset's width/height act as a
reference so the look is the same at any size. It renders a single still
frame (no animation) when the OS has **Reduce motion** on, and pauses
while scrolled off-screen.

A runnable demo with a hero, preset tiles, and a JSON-`src` tile lives
in **[examples/embed.html](../examples/embed.html)**.

---

## Tips and workflows

### "I want a background loop for my homepage"

Two options:
- **Live element (no file):** embed `<perlin-noise preset="aurora"
  autoplay>` — see [Embedding](#embedding-perlin-noise) above. It loops
  forever, scales to the container, and respects reduced motion.
- **Exported video:**
  1. Load the `clouds` or `aurora` preset
  2. Set `Loop duration` to 6–10 sec
  3. Adjust width/height to your layout (e.g. 1280×360 for a banner)
  4. Export WebM, fps=24, frames=144 (= 6 sec)
  5. In HTML: `<video autoplay muted loop playsinline>`

### "I want a seamlessly tileable texture"
1. Pick a starting preset (e.g. `clouds` or `terrain`)
2. Turn the loop off (single still frame)
3. Set `Tile X` and `Tile Y` to a small integer (4–8) — the smaller
   the tile, the more obvious the repetition
4. Resolution to the target size; the physical tile size in pixels
   is `Tile / scaleX` pixels wide
5. Export PNG
6. If you also want **Warp**, integer `Warp scale` is enforced
   automatically when tile is on — keep `Warp scale` at 1 or 2

### "I want a generative texture for a game"
1. `terrain` or `circuit` preset
2. Turn the loop off (a single frame is enough)
3. Resolution to the target size (512 or 1024)
4. (Optional) set `Tile X / Y` if the texture needs to repeat
5. PNG export

### "I'm testing different seeds"
1. Click around in `base` (up/down arrows)
2. Live preview updates immediately
3. Like what you see? Save it as a JSON preset.

### "I want a flow-field look"
1. Pick the `flow` preset as a starting point
2. Adjust `gain` to control how bright the high-magnitude regions
   look — too low and the image is uniformly dark, too high and it
   washes out
3. Use `hue shift` to rotate the colour wheel to match a brand
4. `stencil ε` controls the gradient sharpness — small ε gives
   sharper "ridges", larger ε softens the look

### "I want a marble-like material"
1. `marble` preset as a starting point
2. Reduce `Warp scale` to 0.4–0.6 for slow, sweeping veins
3. `octaves` 3–4 keeps the structure painterly rather than noisy
4. Use the `sunset` or `fire` gradient for warm marble; `ice` or a
   custom blue/white gradient for cool marble

### "I want nebula colours"
1. `nebula` preset
2. Toggle individual channel inverts to flip colour relationships
3. Adjust `base` to get a different overall composition while
   keeping the per-channel character

### "I want noise inside a logo / silhouette"
1. Save your logo as a PNG with transparent background (the shape
   opaque, the rest transparent)
2. Section 07 → Load image, pick the PNG
3. Apply is on by default. Try Invert if your image has the shape
   transparent
4. Adjust canvas Width / Height to match the logo's aspect ratio for
   no stretching
5. Export → PNG; the export keeps the transparent background.

### "I want a composite cloud-and-grain texture"
1. `composite` preset as a starting point
2. Section 03: bump `Layer 2 octaves` to add more detail; lower
   `mix` to fade the layer in subtly
3. Try `blend mode: screen` instead of multiply for a brighter
   composite, or `difference` for sharp boundaries
4. Lock the seeds (`base` for Layer 1, Layer 2's `base (seed)`) by
   saving as a JSON preset once you like it

### "My browser is slow"
- Lower the resolution (128 or 192)
- Lower the octaves (3–4 is often enough)
- Turn `Warp strength` to 0 (fast path bypasses warp)
- Don't use `Flow` colour mode for high-resolution previews — it's
  3× the per-pixel cost
- Check the status for "(main)" — if shown, the main-thread
  fallback is active and is significantly slower than the worker
  (some Safari versions under `file://`). Start a local HTTP
  server: `python3 -m http.server 8000`.

### "I want a custom palette no built-in covers"
1. Colour mode → Gradient → `Custom …`
2. Add / remove / drag stops in the inline editor
3. Save as JSON preset to re-use later — the `gradient` field
   carries the stops verbatim

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Space** | Play / pause (does nothing when an input is focused) |
| **↑ / ↓ / arrows** | Step the focused number input by its `step` size |
| **Tab / Shift+Tab** | Cycle through controls |

There are intentionally few shortcuts — the controls are mouse- and
trackpad-first. The space-to-play binding is the one shortcut that
materially speeds up iteration.
