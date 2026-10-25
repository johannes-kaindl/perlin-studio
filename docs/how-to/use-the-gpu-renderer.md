# Use the GPU renderer

The studio can draw on the GPU (WebGL2) instead of in a worker on the CPU. The image is the same; the speed is not: on an Apple M5 Pro a 1080p frame took about 1.2 seconds on one CPU core and a few milliseconds on the GPU.

## Switch it on

1. In section **02 · Resolution & tile**, set **Renderer** to **GPU · WebGL2**.
2. The fps readout now ends in **· GPU** while the animation plays.

The choice is remembered in your browser. It is not saved in presets and does not change exports.

## What still draws on the CPU

Even with GPU selected, a frame uses the CPU when the colour mode is **Flow** or **RGB · per-channel**, or when a gradient has more than 16 stops. This happens frame by frame, silently. Everything else, including the cosine palettes, relief lighting and the cellular noise types, draws on the GPU.

## If the option is greyed out or it falls back

- *GPU · WebGL2 (not available)*: the browser has no WebGL2 (or hardware acceleration is off). Stay on CPU.
- If the GPU fails while running (a lost context, a driver problem), the studio switches back to CPU and stays there until you reload and select GPU again. The console shows `GPU renderer failed, using the CPU path`.

## Is the picture really the same?

It is checked, not assumed. You can run the check yourself in any browser, including a phone: open the [GPU check page](https://pages.jkaindl.de/perlin-studio/examples/gpu-check.html), press **Run the check** and read the verdict; it also shows how fast the GPU path is on that device. The developers' version, `scripts/check-gl-parity.mjs` renders each case on both paths in a real browser and compares: at most one colour level apart, tiling exact, loop closure bytewise. It needs Playwright and is run by hand after touching `perlin-gl.js` or the maths in `perlin.js`. The two paths differ only by float32 against float64 rounding.

How it is built: [Architecture, GPU renderer](../explanation/architecture.md#gpu-renderer-perlin-gljs).
