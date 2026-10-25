# Export a looping video

For a clip that repeats without a visible jump, for example a website header or a social snippet.

## Steps

1. Turn **Seamless loop** on in section **05 · Loop**. With it off the clip ripples but snaps back where it repeats.
2. Pick a **Loop duration**. That is the length of the clip: 2–4 s for a "breathing" loop, 6–10 s for a relaxed background.
3. In section **09 · Export** set **frames = Loop duration × fps**, for example 6 s × 30 fps = 180 frames, so exactly one loop is captured.
4. Choose a **resolution** for the target (the presets cover portrait, landscape and square).
5. Choose a **background**: a solid colour or an image. The mask, if you use one, is baked in.
6. Press **Record animation**, then **Download video**.

## Play it as a loop

A video file does not loop by itself. On a web page use the attributes:

```html
<video autoplay muted loop playsinline src="my-loop.mp4"></video>
```

## Settings that work

| Use case | frames | fps | Duration | Seamless loop |
|----------|--------|-----|----------|---------------|
| Social snippet | 90 | 30 | 3 s | on |
| Website header loop | 180 | 30 | 6 s | on |
| Long background video | 600 | 24 | 25 s | off |
| Test / preview | 30 | 15 | 2 s | either |

Short loops at moderate resolution are roughly 50–500 KB.

## Good to know

- The format follows the browser: MP4 (H.264) in Safari, iOS and Chrome 126+, WebM (VP9/VP8) in Firefox.
- A larger export resolution shows more of the noise field at the same feature size, because the scales are per pixel. To keep the composition of the on-screen canvas, divide **scale x / y** by the same factor.
- The seamless loop does not depend on the resolution or the renderer; progress 1 is exactly progress 0.
- Instead of a file you can embed the live animation: [Embed in a web page](embed-in-a-web-page.md).
