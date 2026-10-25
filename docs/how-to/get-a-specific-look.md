# Get a specific look

Starting points for common looks. Each recipe names a preset or a few settings; adjust from there.

## A background loop for a homepage

- **Live:** embed `<perlin-noise preset="aurora" autoplay>`. It loops forever, scales to the container and respects reduced motion ([Embed in a web page](embed-in-a-web-page.md)).
- **As a video:** load `clouds` or `aurora`, set **Loop duration** to 6–10 s, size it to your layout, export (fps 24, frames 144 for 6 s) ([Export a looping video](export-a-looping-video.md)).

## Marble

`marble` preset. **Warp scale** 0.4–0.6 for sweeping veins, **octaves** 3–4 keeps it painterly, `sunset` or `fire` for warm, `ice` or a custom blue for cool. With a fractional warp scale keep **Tile X / Y** at 0; with tiling on, the scale is rounded to a whole number. Ink in water: strength about 2, scale about 0.3, persistence about 0.4, HSV with a narrow hue range.

## Nebula colours

`nebula` preset, which uses **RGB · per-channel** noise. Toggle the channel inverts to flip the colour relationships; change **base** for a new composition.

## A flow-field (wind map) look

`flow` preset. **gain** controls how bright strong gradients get, **hue shift** rotates the wheel to a brand colour, **stencil ε** sets how sharp the ridges are.

## Clouds with grain

`composite` preset. In **06 · Layer 2**, raise octaves for detail or lower **mix** to fade it in. Try `screen` (brighter) or `difference` (sharp). Save the JSON to lock both seeds.

## Silk, stone or lava from a flat colour

Switch on **Relief lighting** below the colour controls. Start with **relief** 3–6. A low **light height** with **ambient** 0 gives long, dramatic shadows. It works on every colour mode except Flow and RGB · per-channel.

## Soft blobs and cells

Set **Noise type** (section 03) to **Smooth cells** for metaballs, **Cells** for the distance to the nearest point, or **Borders** for cell edges. Use **1–2 octaves** for clean cells; add Relief lighting and a Cosine palette such as *Neon*. The loop still closes exactly.

## A specific brand colour set

[Match a brand palette](match-a-brand-palette.md).

## Noise inside a logo

[Cut noise out with a mask](cut-noise-out-with-a-mask.md).
