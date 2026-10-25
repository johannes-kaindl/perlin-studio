# Troubleshooting

Find the symptom, then the cause and the fix.

## The page is slow, and a "main thread" badge shows

**Cause:** the noise maths runs on the page's main thread instead of a background Web Worker. Some browsers block workers for a page opened straight from disk (a `file://…` URL, that is, double-clicking `index.html`); it is most common in Safari.

**Fix:** serve the folder over HTTP once: run `python3 -m http.server 8000` in the project folder and open `http://localhost:8000`. The hosted site is never affected.

## It is slow without that badge

- Lower the resolution (128–192) and the octaves (3–4).
- Set **Warp strength** to 0 (fast path).
- Avoid **Flow** for large previews (three samples per pixel); the same goes for **Relief lighting** (three, or six with Layer 2).
- Switch **Renderer** to GPU: [Use the GPU renderer](use-the-gpu-renderer.md).

## "GPU · WebGL2 (not available)" or the GPU switches itself off

The browser has no WebGL2, or hardware acceleration is disabled, or the GPU context was lost (the console says `GPU renderer failed, using the CPU path`). Enable hardware acceleration in the browser settings and reload, or stay on CPU. The picture is the same on both.

## My loop video jumps where it repeats

- **Seamless loop** was off. Turn it on (section 05).
- **frames** is not **Loop duration × fps**, so the clip captured a fraction of a loop. Set it to exactly that product.
- The player is not looping the file. Use `<video loop>`.

## The tile has a visible seam

- Tiling needs **Tile X / Y** above 0, and a whole-number **lacunarity** (2 is ideal).
- With **Warp** on, the warp scale is rounded to a whole number for you; a seam can remain if the scale is fractional and tiling was switched on after the look was dialled in.
- A very small tile with many octaves looks repetitive; grow the tile or drop octaves.

## Relief lighting or the noise type has no effect

- Relief lighting is ignored in **Flow** and **RGB · per-channel** mode (a note under the switch says so).
- **Loop radius** does nothing for the cellular noise types; the **Time scale** sets the speed when Loop is off.
- Cells look grainy with many octaves; use 1–2.

## "This browser can't record transparent video"

Only some browsers can record alpha. Use a solid colour or an image background, or export a PNG (which keeps transparency).

## No MP4, only WebM

Firefox has no MP4 muxer, so it records WebM. Safari, iOS and Chrome 126+ record MP4. Convert if you need the other format.

## An export looks different from the canvas

Scales are per pixel: a larger export size shows more of the noise field at the same feature size. Divide **scale x / y** by the size factor to keep the composition. See [Export a looping video](export-a-looping-video.md#good-to-know).

## The macOS app does not open

macOS Gatekeeper blocks apps it cannot verify. See [Install the macOS app](install-the-macos-app.md#opening-an-unsigned--locally-built-app-gatekeeper).

## Getting help

Open an issue with the browser and version, the preset JSON (**Save JSON**), and what you expected: <https://git.jkaindl.de/jkaindl/perlin-studio/issues>. For a security problem write to `security@jkaindl.de` instead (see [SECURITY.md](../../SECURITY.md)).
