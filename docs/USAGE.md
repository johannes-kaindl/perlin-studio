# User guide

Detailed explanation of every UI element and parameter. For the quick
start see [README](../README.md); for the tech behind the curtain see
[ARCHITECTURE](ARCHITECTURE.md).

## Contents

1. [UI overview](#ui-overview)
2. [Resolution](#resolution)
3. [Noise](#noise)
4. [Loop](#loop)
5. [Color mode](#color-mode)
6. [Presets](#presets)
7. [Export](#export)
8. [Transport bar](#transport-bar)
9. [Tips and workflows](#tips-and-workflows)

---

## UI overview

```
┌────────────────────────────────┬───────────────────────────────────┐
│ SIDEBAR                        │ MAIN OUTPUT                       │
│                                │                                   │
│  Resolution                    │  ┌─────────────────────────────┐  │
│   Width, Height                │  │                             │  │
│                                │  │   Live preview canvas       │  │
│  Noise                         │  │                             │  │
│   scale x, scale y,            │  │                             │  │
│   Time scale,                  │  └─────────────────────────────┘  │
│   base, octaves, persistence,  │                                   │
│   lacunarity                   │  ▶  ⏮   ━━●━━━━━ t=0.42  fps 30   │
│                                │                            f 120  │
│  Loop                          │                                   │
│   ☑ Seamless loop              │  Status: …                  fps   │
│   Duration, Radius             │  ────────────────────             │
│                                │                                   │
│  Color mode                    │                                   │
│   Dropdown + mode inputs       │                                   │
│                                │                                   │
│  Presets                       │                                   │
│   Save | Load                  │                                   │
│   [Chip] [Chip] [Chip] …       │                                   │
│                                │                                   │
│  Export                        │                                   │
│   PNG | WebM                   │                                   │
└────────────────────────────────┴───────────────────────────────────┘
```

---

## Resolution

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| **Width**  | 4–1024 | 256 | Canvas pixel width |
| **Height** | 4–1024 | 256 | Canvas pixel height |

**Practical advice:**
- 128–256 for live parameter tweaking
- 384–512 for higher-quality export
- 768+ takes noticeably longer per frame — the worker stays fast enough
  for previewing, but animation might drop below 30 fps

Aspect: the canvas is stretched to fit the container width, so the
width/height ratio affects display.

---

## Noise

### `scale x`, `scale y`

Pixel-to-noise scaling on the spatial axes.

| Value | Effect |
|-------|--------|
| 0.005 | very coarse, low detail |
| 0.02 | medium clouds (default) |
| 0.05 | fine, denser structures |
| 0.1+ | quasi-noisy pattern |

Different x/y values give stretched structures (great for aurora bands
or horizontal waves).

### `Time scale` (internal: `scaleT`)

Scales the time axis of the noise.

| Value | Effect |
|-------|--------|
| 0.05 | extremely slow, almost static ripple |
| 0.15 | gentle ripple (default) |
| 0.3 | visible motion |
| 0.5+ | hectic flicker (likely too fast to feel "natural") |

**Rule of thumb**: similar in size to `scale x` / `scale y`. The 0.15
default is a good starting point for 30-fps animations.

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

**Performance**: each extra octave roughly doubles the frequency and
therefore the required sampling density — linear in compute time.

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

---

## Loop

### `Seamless loop` (checkbox, default on)

Switches between two animation modes:

- **On (loop mode)**: 4D Perlin on a circular orbit. After `Loop
  duration` seconds the animation closes seamlessly back to the start.
- **Off (linear mode)**: 3D Perlin with linear time. The animation
  ripples gently but is not loopable (there's a visible jump at the
  end of WebM export).

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

**Watch out** with large values + high octaves: `loopRadius` is multiplied
internally by each octave's frequency. With `loopRadius = 2`, `octaves =
8`, `lacunarity = 2`, the circle in the highest octave already covers
256 cells — the loop is still mathematically seamless but looks
restless.

---

## Color mode

The dropdown picks one of four modes, each with its own controls.

### RGB (per channel)

```
r scale | g scale | b scale  (each a 0–2 slider)
r invert | g invert | b invert  (each a checkbox)
```

Three independent channels. Each channel:
- **Scale** multiplies the noise value (0 = channel off, 1 = full,
  2 = overexposed)
- **Invert** flips the value (`1 - n` instead of `n`)

**Examples:**
- pure green, normal:  `r=0, g=1, b=0, invert: -, g, -`
- magenta: `r=1, g=0, b=1, all invert off`
- yellow-on-black: `r=1, g=1, b=0`

### Gradient (preset)

Pick one of eight predefined color maps:

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

The small bar under the dropdown previews the gradient.

### HSV (hue from noise)

```
hue shift   (0–1)  — hue offset
hue range   (0–1)  — hue bandwidth across the image
saturation  (0–1)  — saturation (constant)
value       (0–1)  — value/brightness (constant)
```

The noise value drives the hue only. Saturation and value are constant
across the image → produces evenly saturated, "neon" looks.

**Examples:**
- Aurora: `shift=0.30, range=0.48, sat=0.88, val=1.0` (cyan-blue-purple)
- Plasma: `shift=0, range=1, sat=1, val=1` (full rainbow spectrum)
- Sepia tone: `shift=0.08, range=0.1, sat=0.6, val=0.9`

### Posterize (steps + gradient)

```
Steps            (2–16) — number of discrete color levels
Gradient preset  — one of the eight color maps
```

The noise is quantised to N equal steps (`floor(n · N) / (N-1)`), then
mapped onto the gradient. Yields cartoon-like banding — great for
terrain height maps and stylised effects.

---

## Presets

### Save

Downloads the current parameter state as JSON
(`perlin-preset-<timestamp>.json`).

### Load

Loads a previously saved JSON file (or one you wrote yourself). Invalid
JSON produces an error in the status bar.

JSON shape (example):
```json
{
  "width": 384,
  "height": 256,
  "scaleX": 0.015,
  "scaleY": 0.015,
  "scaleT": 0.12,
  "base": 7,
  "octaves": 5,
  "persistence": 0.65,
  "lacunarity": 2.2,
  "colorMode": "gradient",
  "gradientName": "fire",
  "loop": true,
  "loopDuration": 6,
  "loopRadius": 1.0,
  "t": 0
}
```

Fields not present keep their current UI value.

### Built-in presets (chips)

| Preset | Look |
|--------|------|
| `default` | green, gently rippling default noise (RGB mode) |
| `lava` | deep red-orange glowing lava flows (`fire` gradient) |
| `aurora` | green → cyan → blue → violet polar light (HSV) |
| `clouds` | soft black-and-white clouds (`grayscale` gradient) |
| `terrain` | banded landscape with a contour-line look (`forest` posterize) |
| `circuit` | hard-edged cyan/black pattern (3-step `ocean` posterize) |

Clicking a chip loads the preset immediately and renders it.

---

## Export

### PNG (current frame)

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

**Loop on + WebM**: exactly `frames` frames per loop, closes perfectly.
**Loop off + WebM**: linear through time, the video snaps back when
replayed.

### Recommended export settings

| Use case | frames | fps | Duration | Loop |
|----------|--------|-----|----------|------|
| Social media snippet | 90 | 30 | 3 s | on |
| Website header loop | 180 | 30 | 6 s | on |
| Long background video | 600 | 24 | 25 s | off |
| Test / preview | 30 | 15 | 2 s | either |

WebM files are roughly 50–500 KB for short loops at moderate resolution.

---

## Transport bar

| Control | Function |
|---------|----------|
| **▶** / **⏸** | Play/pause the live animation. Alternative: **Space** |
| **⏮** | Slider back to 0 (`t = 0` or `loopProgress = 0`) |
| **t slider** | Scrubbing; range depends on loop mode |
| **fps** (1–60) | Export framerate; in live mode the app renders as fast as it can |
| **frames** (1–600) | Frame count for WebM export |

Right of the status line: live FPS counter (during play).

---

## Tips and workflows

### "I want a background loop for my homepage"
1. Load the `clouds` or `aurora` preset
2. Set `Loop duration` to 6–10 sec
3. Adjust width/height to your layout (e.g. 1280×360 for a banner)
4. Export WebM, fps=24, frames=144 (= 6 sec)
5. In HTML: `<video autoplay muted loop playsinline>`

### "I want a generative texture for a game"
1. `terrain` or `circuit` preset
2. Turn the loop off (a single frame is enough)
3. Resolution to the target size (512 or 1024)
4. PNG export

### "I'm testing different seeds"
1. Click around in `base` (up/down arrows)
2. Live preview updates immediately
3. Like what you see? Save it as a JSON preset.

### "My browser is slow"
- Lower the resolution (128 or 192)
- Lower the octaves (3–4 is often enough)
- Check the status for "(main)" — if shown, the main-thread fallback is
  active and is significantly slower than the worker (some Safari
  versions under `file://`). Start a local HTTP server:
  `python3 -m http.server 8000`.

### "I want custom gradients"
Code-side only for now: extend the `GRADIENTS` object in
`perlin-studio.js` and add an `<option>` in `index.html`. A custom
gradient editor is on the [roadmap](../README.md#roadmap).
