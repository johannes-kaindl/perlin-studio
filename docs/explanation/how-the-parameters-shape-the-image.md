# How the parameters shape the image

The control reference lists every range; this page is about what the controls *do* to the picture and why. Each pair below changes one variable and keeps the rest.

## Fractal noise in one paragraph

These are the core **fractal-Brownian-motion (fBm)** controls. fBm builds
the image by stacking several layers ("octaves") of the same Perlin noise:
each octave is finer (higher frequency) and quieter (lower amplitude) than
the one before, and they're summed. So **octaves** = *how many* layers
stack (more → finer detail); **persistence** = *how loud* the finer layers
are (high → the fine layers dominate, rough; low → faint, smooth);
**lacunarity** = how much finer each layer is than the last. The pairs
below isolate one variable at a time.

## Pixels, not units: the low-resolution look

The canvas **fills its frame** and upscales with nearest-neighbour, so a small Width/Height renders as crisp pixel blocks — a deliberate retro / "Minecraft" look. The render is exactly `Width × Height` pixels; the display just scales those up. A PNG export always has the native `Width × Height`.

<table>
  <tr>
    <td width="50%"><img src="../images/lowres-blocks.png" width="100%" alt="A 40×27 render upscaled with nearest-neighbour into chunky pixel blocks"></td>
    <td width="50%"><img src="../images/lowres-smooth.png" width="100%" alt="The same coarse noise rendered at full resolution, smooth"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>40×27</b> → crisp pixel blocks</sub></td>
    <td align="center"><sub>The same field at full resolution</sub></td>
  </tr>
</table>

## Scale: the zoom

`scale x` and `scale y` convert pixels into noise space, so they are the zoom. Different values for x and y stretch the structures (aurora bands, horizontal waves). With **Tile X / Y** on, the scales also set the tile size in pixels (`Tile / scale`).

<table>
  <tr>
    <td width="50%"><img src="../images/scale-coarse.png" width="100%" alt="Coarse scale: large zoomed-in blobs"></td>
    <td width="50%"><img src="../images/scale-fine.png" width="100%" alt="Fine scale: small dense features"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>scale 0.008</b> · coarse, few large features</sub></td>
    <td align="center"><sub><b>scale 0.045</b> · fine, dense detail</sub></td>
  </tr>
</table>

## Octaves: how much fine detail

Each octave is one more evaluation of the noise per pixel, at twice the frequency and half the loudness. Cost grows roughly linearly with the count.

<table>
  <tr>
    <td width="50%"><img src="../images/octaves-2.png" width="100%" alt="2 octaves: smooth large blobs"></td>
    <td width="50%"><img src="../images/octaves-8.png" width="100%" alt="8 octaves: fine grainy detail"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>2 octaves</b> · smooth</sub></td>
    <td align="center"><sub><b>8 octaves</b> · fine detail</sub></td>
  </tr>
</table>

## Persistence: smooth or rough

Persistence is the loudness ratio between neighbouring octaves. Low values let the fine layers fade (clouds), high values keep them (terrain, grain).

<table>
  <tr>
    <td width="50%"><img src="../images/persistence-low.png" width="100%" alt="Low persistence: smooth, the fine octaves barely register"></td>
    <td width="50%"><img src="../images/persistence-high.png" width="100%" alt="High persistence: rough, the fine octaves dominate"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>0.32</b> · smooth, cloud-like</sub></td>
    <td align="center"><sub><b>0.75</b> · rough, terrain-like</sub></td>
  </tr>
</table>

## The same noise in five colour modes

The colour mode only changes how the noise value becomes a colour; the field underneath is identical.

<table>
  <tr>
    <td width="20%"><img src="../images/mode-rgb.png" width="100%" alt="RGB per-channel mode"></td>
    <td width="20%"><img src="../images/mode-gradient.png" width="100%" alt="Gradient mode (magma)"></td>
    <td width="20%"><img src="../images/mode-hsv.png" width="100%" alt="HSV mode"></td>
    <td width="20%"><img src="../images/mode-posterize.png" width="100%" alt="Posterize mode (ocean)"></td>
    <td width="20%"><img src="../images/mode-flow.png" width="100%" alt="Flow vector-field mode"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>RGB</b></sub></td>
    <td align="center"><sub><b>Gradient</b></sub></td>
    <td align="center"><sub><b>HSV</b></sub></td>
    <td align="center"><sub><b>Posterize</b></sub></td>
    <td align="center"><sub><b>Flow</b></sub></td>
  </tr>
</table>

## Warp: from noise to marble

Domain warping pushes each sample point by a second, smoother field before the main noise is read. A small strength gives veins, a large one swirls.

<table>
  <tr>
    <td width="50%"><img src="../images/warp-off.png" width="100%" alt="Warp off: ordinary Perlin clouds"></td>
    <td width="50%"><img src="../images/warp-on.png" width="100%" alt="Warp on: the field pulled into swirling marble veins"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>strength 0</b> · raw noise</sub></td>
    <td align="center"><sub><b>strength 1.8</b> · marble swirls</sub></td>
  </tr>
</table>

## Where to go next

- Every range and default: [Control reference](../reference/controls.md).
- How the maths is built: [Architecture](architecture.md).
- A look to start from: [Get a specific look](../how-to/get-a-specific-look.md).
