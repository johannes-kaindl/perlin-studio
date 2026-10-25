# Cut noise out with a mask

Show the noise only inside a shape, for example a logo, or fade it with a soft vignette.

1. Make the mask image: a PNG with the shape opaque and the rest transparent works best. A black-on-white silhouette (JPG or opaque PNG) also works, because the mask then uses brightness.
2. In section **08 · Mask**, press **Load image**. **Apply mask** switches on.
3. If the noise appears *outside* the shape, tick **Invert**.
4. Set **Width** and **Height** in section 02 to the aspect of the mask. The mask is stretched to the canvas size.
5. Export:
   - **PNG · current frame** keeps the transparency.
   - **Record animation** bakes the mask into the video together with the background you chose in section 09 (a solid colour, or an image with **Cover**/**Contain**). Transparent video is only possible where the browser can record alpha.

## Ideas

- A branded texture inside a logo silhouette.
- A feathered vignette from a radial-gradient PNG.
- Composite passes: the same noise with two different masks.

Reference: [08 · Mask](../reference/controls.md#08--mask) and [09 · Export](../reference/controls.md#09--export).
