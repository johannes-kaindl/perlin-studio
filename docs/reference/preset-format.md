# Preset format

A preset is a JSON object of studio parameters. **Save JSON** writes one; **Load JSON**, the `<perlin-noise>` element's `src` attribute and its `params` property read the same shape. Built-in presets (`default`, `lava`, `aurora`, `clouds`, `terrain`, `circuit`, `marble`, `nebula`, `flow`, `composite`) are the same objects, defined in `perlin-presets.js`.

- **Missing keys.** On load, a key that is absent keeps the current value in the studio; in the element it takes the default.
- **Only the active mode's keys.** Save JSON writes the colour-mode keys of the mode in use, plus the relief keys when relief is on.
- **Time is not stored.** The time position (`t`, `loopProgress`) comes from the transport, not the file.

## Example

```json
{
  "width": 384, "height": 256, "tileX": 0, "tileY": 0,
  "scaleX": 0.015, "scaleY": 0.015, "scaleT": 0.12, "base": 7,
  "octaves": 5, "persistence": 0.65, "lacunarity": 2.2,
  "warpStrength": 1.6, "warpScale": 0.6,
  "colorMode": "gradient",
  "gradientName": "custom",
  "gradient": [
    {"pos": 0.0, "color": [12, 12, 60]},
    {"pos": 0.6, "color": [240, 110, 80]},
    {"pos": 1.0, "color": [255, 245, 200]}
  ],
  "loop": true, "loopDuration": 6, "loopRadius": 1.0
}
```

## Common keys

| Key | Type / range | Default | Meaning |
|-----|--------------|---------|---------|
| `width`, `height` | 4–1024 | 256 | Render size in pixels. In the element: the reference composition. |
| `tileX`, `tileY` | 0–64 | 0 | Noise cells after which the axis wraps; 0 = off |
| `scaleX`, `scaleY` | 0.0001–10 | 0.02 | Pixel to noise scale (the zoom) |
| `scaleT` | 0–10 | 0.15 | Time scale |
| `base` | integer | 0 | Seed |
| `octaves` | 1–10 | 6 | Noise layers |
| `persistence` | 0–2 | 0.5 | Amplitude factor between octaves |
| `lacunarity` | 1–8 | 2.0 | Frequency factor between octaves |
| `fieldType` | `perlin` · `cells` · `borders` · `smooth` | `perlin` | Noise type |
| `cellJitter` | 0–1 | 1 | Randomness of the cell points (cellular types only) |
| `warpStrength` | 0–8 | 0 | Domain warp strength; 0 = off (the control offers 0–3) |
| `warpScale` | 0.05–16 | 1 | Frequency of the warp field (the control offers 0.1–4) |
| `loop` | boolean | true | Seamless loop (4D) on, linear time (3D) off |
| `loopDuration` | 0.5–60 | 4 | Seconds per loop |
| `loopRadius` | 0–4 | 1.0 | How far the image travels per loop (not used by cellular types) |

## Layer 2

| Key | Type / range | Default | Meaning |
|-----|--------------|---------|---------|
| `layer2On` | boolean | false | Enable the second field |
| `layer2ScaleX`, `layer2ScaleY` | 0.0001–10 | 0.06 | Its spatial scale |
| `layer2Octaves` | 1–10 | 4 | Its octaves |
| `layer2Base` | integer | 0 | Its seed |
| `layer2BlendMode` | `multiply` · `add` · `screen` · `darken` · `lighten` · `difference` | `multiply` | How it combines |
| `layer2Mix` | 0–1 | 0.5 | Blend amount |

Layer 2 uses the same `fieldType` as the main layer and is ignored in Flow and RGB · per-channel mode.

## Colour

`colorMode` is one of `rgb`, `gradient`, `hsv`, `posterize`, `cosine`, `flow`. The keys that go with each:

| Mode | Keys |
|------|------|
| `rgb` | `rScale`, `gScale`, `bScale` (0–4; defaults 0, 1, 0), `rInvert`, `gInvert`, `bInvert` (boolean), `rgbMultiChannel` (boolean) |
| `gradient` | `gradientName` (`viridis`, `magma`, `fire`, `ocean`, `forest`, `grayscale`, `sunset`, `ice`, or `custom`) and, for `custom`, `gradient`: a list of `{ "pos": 0–1, "color": [r, g, b] }`, at most 16 stops on the GPU |
| `hsv` | `hsvHueShift` (0–1, default 0), `hsvHueRange` (0–1, 0.6), `hsvSat` (0–1, 0.8), `hsvVal` (0–1, 1) |
| `posterize` | `posterizeSteps` (2–16, 5) plus `gradientName` / `gradient` as above |
| `cosine` | `cosineName` (`rainbow`, `dusk`, `rose`, `citrus`, `peach`, `neon`, `coral`, or `custom`) and `cosine`: `{ "a": [r, g, b], "b": [...], "c": [...], "d": [...] }` |
| `flow` | `flowHueShift` (0–1), `flowSat` (0–1, 0.85), `flowGain` (0.05–50, 4), `flowFloor` (0–1, 0.05), `flowEps` (0.05–10, 0.6) |

For a named gradient or cosine palette you may omit `gradient` / `cosine`: the name is expanded when the preset is used. Explicit values win over the name.

## Relief lighting

Written when `reliefOn` is true; applies on top of every colour mode except `flow` and `rgb` with `rgbMultiChannel`.

| Key | Range | Default | Meaning |
|-----|-------|---------|---------|
| `reliefOn` | boolean | false | Switch |
| `reliefGain` | 0–20 | 4 (studio) | Steepness of the surface |
| `lightAzimuth` | 0–360 | 315 | Degrees clockwise from the top of the image |
| `lightElevation` | 1–90 | 45 | Degrees above the surface |
| `reliefAmbient` | 0–1 | 0.35 | Light on every slope |
| `reliefSpec` | 0–1 | 0.25 | Highlight strength |
| `reliefShine` | 2–128 | 32 | Highlight tightness |
| `reliefEps` | 0.1–4 | 0.6 | Pixel offset used to measure the slope |

If the studio writes a value outside a range, loading clamps it. A file may carry keys this version does not know; they are ignored. The native macOS and iOS apps read only the older keys (they do not know `cosine`, `fieldType` or relief lighting).
