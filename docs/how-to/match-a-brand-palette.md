# Match a brand palette

## With hex codes (gradient)

1. Click **Custom hex palette →** under the colour-mode dropdown, or choose *Gradient* and the preset **Custom …**.
2. Paste your hex codes into **Paste palette**, for example `#1ea84a, #4ac8d8, #a878ff`. Any separator works, with or without `#`, three or six digits.
3. Press **Apply palette**. The colours become stops spread evenly across the bar (up to 16).
4. Fine-tune a stop by typing a `#rrggbb` into its hex field, moving its position slider, or using the colour swatch. **+ add stop** inserts one in the largest gap, **×** removes one (two stay as the minimum).
5. Press **Save JSON** to keep it. The stops travel with the preset.

The same custom gradient is available in **Posterize** mode (choose *Custom …* there).

## With a formula (cosine palette)

1. Switch the colour mode to **Cosine**.
2. Pick one of the seven ready-made palettes as a start.
3. Change the twelve numbers: `a` is the base brightness, `b` the swing, `c` how often each channel cycles over the ramp, `d` where it starts. The strip above shows the result.
4. Use whole numbers for `c` if the ramp should close its cycle (lowest and highest value get the same colour).

Editing any number switches the palette to *Custom*; the numbers are saved in the preset.

Details of both editors: [Colour modes and relief lighting](../reference/colour-modes.md).
