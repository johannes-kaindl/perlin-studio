# Export an image or a tileable texture

## A single image

1. Set **Width** and **Height** in section **02** to the size you want. The export is exactly that size.
2. Turn **Seamless loop** off if you want a still from a linear time position, or leave it on and drag the time slider to the frame you like.
3. Press **PNG · current frame**. The file is `perlin-<timestamp>.png`. If a mask is applied it keeps its transparency.

To compare seeds, click the **base** spinner arrows; the preview updates immediately. Save a preset when you like one.

## A seamlessly tileable texture

1. Pick `clouds` or `terrain` and turn the loop **off**.
2. Set **Tile X** and **Tile Y** to a small whole number (4–8). The noise wraps every N cells.
3. Set the resolution to the texture size. The tile is `Tile / scale` pixels wide, so choose **scale** to make the tile fill the image.
4. With **Warp** on, the warp scale is rounded to a whole number automatically so the seam still closes.
5. Press **PNG · current frame**.

Use a whole-number **lacunarity** (2 is ideal) for clean tiling; other values shift the wrap period per octave. This also works for the cellular noise types, and for relief lighting.

## A low-resolution pixel-art texture

1. Set Width/Height small, for example 32–64. The canvas shows crisp blocks.
2. Pick a punchy gradient or the Posterize mode for chunky colour bands.
3. Press **PNG · current frame**; it saves at the small native size.

## A generative texture for a game

1. Take `terrain` or `circuit`, loop off, resolution 512–1024.
2. Optionally set **Tile X / Y** to repeat it.
3. Export the PNG.
