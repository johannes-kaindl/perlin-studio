# Web video export — Phase 1 design

- **Date:** 2026-06-15
- **Status:** Approved (brainstorming); ready for implementation plan
- **Scope:** Phase 1 of a larger "export build-out" initiative (web surface only)
- **Profiles:** web-static (this phase). Native phases tracked separately.

## Motivation

Importing an image, using it as a **mask**, and watching Perlin noise animate
within/through it produces striking results. Today that result **cannot be
exported faithfully as video**: the web recorder captures the canvas via
`captureStream()`, which is RGB-only, so the alpha mask is dropped and there is
no defined background. The masked, animated image is the project's most
compelling output — making it exportable is the headline of this work, and the
first step toward "animated wallpapers + videos" becoming the project's flagship
feature.

This spec covers **Phase 1: the web surface**. A shared mental model
(`ExportSpec`) is introduced now so later native phases stay consistent.

## Decisions locked during brainstorming

1. **Deliverable:** a general-purpose video export (not a macOS "wallpaper file"
   — macOS has no such format; the live app already *is* the animated wallpaper).
2. **Surfaces:** web + native, unified UX/feature-parity, but each surface keeps
   its own native encoder. Rolled out in phases (this spec = web).
3. **Formats (overall initiative):** MP4/H.264 + HEVC (core), transparent/alpha
   (native-only), GIF/animated WebP. **Phase 1 ships MP4/H.264 + WebM**; GIF and
   a frame-exact WebCodecs encoder are deferred to Phase 1b.
4. **Seamless loop:** essential everywhere. The web already has the true 4D
   seamless loop; Phase 1 preserves it. (Porting the loop to the native Metal
   renderer is a later phase.)
5. **Web stays strictly zero-dependency:** browser-native `MediaRecorder` /
   `WebCodecs` only; any muxer/GIF encoder we ever add is authored in-repo as
   vanilla JS, never an external library.
6. **Compositing model:** bring the full native "image-through-mask" model to the
   web — masked noise over a chosen background: solid color, an imported
   background image, or transparent (best-effort).

## Goals

- Bake **mask + chosen background** into the exported video, so the exported clip
  matches the live preview / PNG export.
- Add a **background model**: solid color, background image (with fit), or
  transparent (best-effort).
- **Decouple export resolution from the live canvas**, with presets for common
  wallpaper/social sizes plus custom dimensions.
- A unified **export panel** that exposes format, resolution, duration/fps, loop,
  and background — replacing the current "video is RGB-only, mask ignored" caveat.
- Preserve the existing **deterministic, seamless 4D-loop** capture.

## Non-goals (later phases)

- GIF / animated WebP and a frame-exact WebCodecs encoder + in-repo muxer (**Phase 1b**).
- Native (macOS/iOS) general export, MP4/H.264 on native, and porting the 4D loop
  to the Metal renderer (**Phase 2**).
- Transparent/alpha video as a first-class, reliable format (native ProRes 4444 /
  HEVC-alpha) (**Phase 3**).
- Auto-start-on-login / idle-screensaver behavior reused from kuro-screensaver
  for the macOS wallpaper app (**Phase 3**).

## Current state (what already exists)

- `recordWebm()` (`perlin-studio.js`) drives a **deterministic** capture: per
  frame it calls `engine.renderFrameAndWait(params)` then `track.requestFrame()`
  on a `canvas.captureStream(0)` track.
- `paramsForRecordingFrame()` computes per-frame params; in loop mode
  `loopProgress = (start + i/total) % 1` with frame `total` skipped — a true
  seamless 4D loop.
- `RECORDER_MIME_CANDIDATES` / `setupRecorder()` already prefer **MP4/H.264**,
  falling back to WebM (vp9/vp8). MIME and file extension are derived from what
  the browser actually records.
- The image mask (`loadMaskFile`/`rebuildMaskAlphaCache`/`applyMaskToImageData`)
  produces an alpha channel from a PNG/JPG (alpha, or Rec.709 luminance fallback
  for opaque images), applied to the rendered RGBA. **PNG export keeps the alpha;
  video does not.**
- There is **no background-image compositing on the web today** (only the mask
  silhouette). Native (`LivePhotoExporter`/`ExportController`) has it; Phase 1
  brings the equivalent to web.

## Architecture & components

### 1. `ExportSpec` (new, shared model)

A plain object describing one export, produced from the export panel:

```
ExportSpec = {
  format: "mp4" | "webm",        // requested container; actual derived from recorder
  width: number, height: number, // export resolution (decoupled from live canvas)
  fps: number,                   // 1–60
  frames: number,                // 1–600 (duration = frames / fps)
  loop: boolean,                 // true → seamless 4D loop
  background: {
    type: "color" | "image" | "transparent",
    color: string,               // CSS color, used when type === "color"
    image: ImageBitmap | null,   // background image; null → fall back to mask image
    fit: "cover" | "contain",    // used when type === "image"
  },
  mask: boolean,                 // whether the active mask is applied
}
```

`ExportSpec` is the single source of truth the pipeline consumes. It deliberately
mirrors the parameters native phases will need, so the two surfaces converge.

### 2. Frame compositor (new, vanilla JS)

A small module that owns a single **offscreen compositing canvas** sized to
`ExportSpec.width × height`. Per frame:

1. Clear (or fill `transparent`).
2. Draw the **background**: solid `color`, or the background `image` scaled with
   `fit` (cover/contain, centered), or nothing (transparent).
3. Draw the **rendered masked-noise RGBA** on top (the engine output with the
   mask's alpha applied — premultiplied compositing via the 2D context's default
   `source-over`).

The **compositing canvas** — not the live canvas — is what the recorder captures.
This is the core fix and is independent of the encoder backend, so Phase 1b can
swap MediaRecorder for WebCodecs without touching the compositor.

For `transparent`, the compositor leaves the background clear; whether the
*encoder* can preserve alpha is a separate, best-effort concern (see Encoder).

### 3. Render-at-export-resolution

Export frames are rendered at `ExportSpec.width × height`, independent of the live
canvas (which stays ≤ 1024² for interactivity). `generatePerlinImage()` already
takes width/height, so the engine renders export frames into an offscreen target
of the requested size. The live preview is paused during capture (as today).

### 4. Encoder backend (Phase 1a: MediaRecorder)

Reuse the existing `setupRecorder()` / `RECORDER_MIME_CANDIDATES` path **pointed
at the compositing canvas** instead of the live canvas. Keep the deterministic
`renderFrameAndWait` → composite → `track.requestFrame()` loop. Container/codec
selection, MIME fallback, and file naming are unchanged.

Phase 1b (separate spec) will add a frame-exact `WebCodecs.VideoEncoder` + an
in-repo muxer behind the same compositor interface, plus an in-repo GIF encoder.

### 5. Export panel UX (§09 redesign)

Replace the current frames/fps + "RGB-only" warning with:

- **Format:** MP4 / WebM (auto-selected to the best supported; user can force).
- **Resolution:** presets (e.g. 1080×1920, 1920×1080, 1080×1080, 1440p, 2160p) +
  custom W/H, with a sane upper cap and a memory/time hint for large × long.
- **Duration:** frames or seconds (toggle) + fps.
- **Loop:** existing toggle (drives seamless 4D path).
- **Background:** `none`-removed; choose `color` (swatch), `image` (optional
  separate background-image picker; falls back to the mask image; `fit`
  cover/contain), or `transparent` (disabled with a "native only — Phase 3" hint
  when the browser can't record alpha).
- **Estimate:** rough output size / capture time.

## Data flow

```
export panel → ExportSpec
  └─ for i in 0..frames-1:
       params  = paramsForRecordingFrame(base, startSlider, i, frames, fps)   // existing, seamless in loop mode
       rgba    = engine.renderFrameAndWait(params, {width, height})           // render at export resolution
       (mask applied to rgba via existing applyMaskToImageData when spec.mask)
       compositor.draw(background, rgba)                                       // NEW: bg + masked noise
       recorder ← compositingCanvas.requestFrame()
  └─ recorder.stop() → Blob → inline <video> preview + Download
```

## Background / compositing model (detail)

- **color:** fill the compositing canvas with `background.color`, then draw masked
  noise. Equivalent to native "composite over solid color".
- **image:** draw `background.image` (or the mask image if none chosen) scaled by
  `fit`, then draw masked noise. Where the mask hides noise (alpha→0), the
  background image shows through — the native "image-through-mask" look.
- **transparent:** leave background clear. Recordable only where the browser
  supports an alpha video codec (some Chromium builds record `video/webm;codecs=vp9`
  with alpha). When unsupported, the panel disables the option and points to the
  native phase. Never silently flatten transparent onto black without telling the
  user.

Aspect handling: `cover` fills the frame (cropping overflow), `contain` letterboxes
(transparent or `color` margins). The mask is rasterized to the **export**
resolution via the existing `rebuildMaskAlphaCache(targetW, targetH)`.

## Error handling & edge cases

- **No supported recorder codec:** existing clear message; abort cleanly.
- **Transparent unsupported by the recorder:** disable the option pre-flight (probe
  `MediaRecorder.isTypeSupported('video/webm;codecs=vp9')` + alpha capability);
  show the "native only (Phase 3)" hint. Do not produce a black-flattened clip
  labeled "transparent".
- **Background image load failure:** report via `setStatus(..., true)`; keep the
  previous background selection.
- **Aspect mismatch (image vs export size):** resolved by `fit`; never stretch.
- **Large resolution × long duration:** show an estimated-size/time hint; capture
  remains cancelable mid-run (existing `recordingCancel` path).
- **Mask absent but `background.type === "image"`:** allowed — noise composites
  fully over the image (no holes); document this is intentional.

## Testing strategy

Extend `scripts/smoke-test.js` (Node, `global.window = {}` pattern) and the manual
browser pass:

- **Compositor unit invariants (deterministic):** given a tiny known noise frame
  + a 2×2 mask (one opaque, one transparent texel) + a fixed background color,
  assert the composited RGBA at known coordinates (background shows through the
  transparent texel; noise shows through the opaque one). The compositor must be
  importable/testable without a real `<canvas>` where feasible (factor the pixel
  math out of the DOM canvas call).
- **Loop identity for composited frames:** composited frame `0` and frame
  `frames` (progress 0 vs 1) must be byte-identical in loop mode — extends the
  existing loop-endpoint invariant to the composited output.
- **MIME/extension mapping:** unit-check `extForMime()` and the candidate ordering
  remain MP4-first.
- **Manual browser matrix:** Chrome, Safari, Firefox — verify MP4 vs WebM
  selection, mask+color, mask+image (cover/contain), and transparent
  enable/disable behavior; verify the exported clip loops seamlessly.

## Risks & open questions

- **MediaRecorder frame-exactness:** the deterministic `requestFrame` path is
  content-seamless (the 4D math loops), but container-level frame drop/dup can
  still nick the loop on some engines. If the manual matrix shows seams, that is
  the trigger to pull Phase 1b (WebCodecs) forward. Logged, not pre-solved.
- **Transparent web video** is genuinely flaky across browsers; treat as
  best-effort and lean on the native phase for reliable alpha.
- **Export-resolution memory:** very large frames × MediaRecorder may pressure
  memory; the estimate hint + cancelability mitigate, but a hard cap may be
  needed (decide during implementation from measured limits).

## Future phases (context, not in scope)

- **Phase 1b (web):** WebCodecs `VideoEncoder` + in-repo MP4/WebM muxer (frame-
  exact, guaranteed seamless) + in-repo GIF/animated-WebP encoder.
- **Phase 2 (native):** port the 4D seamless loop into `NoiseShader.swift`;
  generalize `LivePhotoExporter` to MP4/H.264; bring the export panel to parity on
  macOS/iOS.
- **Phase 3:** transparent/alpha video (ProRes 4444 / HEVC-alpha, native); reuse
  kuro-screensaver's `LoginItem`/`Idle`/menu plumbing for auto-start + idle
  screensaver mode on the macOS wallpaper app.
