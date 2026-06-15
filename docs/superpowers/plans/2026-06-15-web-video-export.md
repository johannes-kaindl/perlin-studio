# Web Video Export (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web studio export the masked, animated image as video — baking the mask and a chosen background (color / image / transparent) into the frames, at a chosen export resolution.

**Architecture:** A new zero-dependency module `perlin-export.js` (`window.MTPerlinExport`) holds the pure, testable compositing math (`computeFitRect`, `compositeOverColor`, `hexToRgb`). The studio renders each export frame at the export resolution via the existing `engine.renderFrameAndWait` (which already applies the mask through `transformFrame`), composites it onto an offscreen **compositing canvas** over the chosen background, and records *that* canvas with the existing `MediaRecorder` path. The live canvas is restored afterward.

**Tech Stack:** Vanilla JS (no build, no deps), Canvas 2D, `MediaRecorder`, Web Worker (existing engine). Node for `scripts/smoke-test.js` (the deploy gate) and `scripts/check-syntax.mjs`.

**Spec:** `docs/superpowers/specs/2026-06-15-web-video-export-design.md`

---

## File Structure

- **Create** `perlin-export.js` — `window.MTPerlinExport`: pure helpers `computeFitRect`, `compositeOverColor`, `hexToRgb`. No DOM, Node-requirable. One responsibility: compositing math.
- **Modify** `index.html` — redesign §09 Export panel (resolution, background controls); add `<script src="perlin-export.js" defer>`; remove the RGB-only mask warning; update the §08 mask hint.
- **Modify** `styles.css` — minimal styles for the new export controls.
- **Modify** `perlin-studio.js` — new `els`/`state` bindings; `gatherExportSpec()`; `compositeExportFrame()`; rework `recordWebm` → `recordVideo` (capture compositing canvas, render at export resolution, restore); background-mode UI behavior; remove `updateWebmMaskHint`.
- **Modify** `scripts/check-syntax.mjs` — add `perlin-export.js` to the gated `jsFiles`.
- **Modify** `scripts/smoke-test.js` — TDD tests for the new pure helpers.
- **Modify** `AGENTS.md` — module layering + file layout list the new module.
- **Modify** `CHANGELOG.md` — `[Unreleased]` entry.

---

## Task 1: `perlin-export.js` + `computeFitRect`

**Files:**
- Create: `perlin-export.js`
- Test: `scripts/smoke-test.js` (append a section)

- [ ] **Step 1: Write the failing test** — append to `scripts/smoke-test.js` **above** the final summary/exit block (the file ends with a `failed`-based exit; insert before it):

```javascript
// ----- EXPORT: computeFitRect -----
global.window = global.window || {};
require(path.join(__dirname, "..", "perlin-export.js"));
const EX = global.window.MTPerlinExport;
{
  // cover: 100x100 into 200x100 -> scale 2 -> 200x200, centered vertically (y = -50)
  const cov = EX.computeFitRect(100, 100, 200, 100, "cover");
  ok("computeFitRect cover w", cov.w === 200, "got " + cov.w);
  ok("computeFitRect cover h", cov.h === 200, "got " + cov.h);
  ok("computeFitRect cover x centered", cov.x === 0, "got " + cov.x);
  ok("computeFitRect cover y centered", cov.y === -50, "got " + cov.y);
  // contain: 100x100 into 200x100 -> scale 1 -> 100x100, centered horizontally (x = 50)
  const con = EX.computeFitRect(100, 100, 200, 100, "contain");
  ok("computeFitRect contain w", con.w === 100, "got " + con.w);
  ok("computeFitRect contain h", con.h === 100, "got " + con.h);
  ok("computeFitRect contain x centered", con.x === 50, "got " + con.x);
  ok("computeFitRect contain y centered", con.y === 0, "got " + con.y);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test.js`
Expected: throws `Cannot find module '../perlin-export.js'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation** — create `perlin-export.js`:

```javascript
/**
 * perlin-export.js — pure compositing math for Perlin Studio's video export.
 *
 * No DOM, no dependencies: attaches window.MTPerlinExport so it is usable in
 * the browser and require()-able in Node (the smoke-test gate). The studio
 * (perlin-studio.js) wraps these with the actual canvas/MediaRecorder plumbing.
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";

  // Rect for drawing a srcW x srcH image into a dstW x dstH frame, centered.
  // "cover" fills the frame (cropping overflow); "contain" letterboxes.
  function computeFitRect(srcW, srcH, dstW, dstH, fit) {
    const scale = fit === "contain"
      ? Math.min(dstW / srcW, dstH / srcH)
      : Math.max(dstW / srcW, dstH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
  }

  root.MTPerlinExport = { computeFitRect };
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-test.js`
Expected: the four `computeFitRect cover …` and four `contain …` lines print `ok`; process exits 0.

- [ ] **Step 5: Commit**

```bash
git add perlin-export.js scripts/smoke-test.js
git commit -m "feat(export): add MTPerlinExport.computeFitRect (pure fit math)"
```

---

## Task 2: `compositeOverColor` + `hexToRgb`

**Files:**
- Modify: `perlin-export.js`
- Test: `scripts/smoke-test.js`

- [ ] **Step 1: Write the failing test** — append to the EXPORT section in `scripts/smoke-test.js`:

```javascript
// ----- EXPORT: hexToRgb -----
{
  const c = EX.hexToRgb("#0a0a18");
  ok("hexToRgb r", c[0] === 10, "got " + c[0]);
  ok("hexToRgb g", c[1] === 10, "got " + c[1]);
  ok("hexToRgb b", c[2] === 24, "got " + c[2]);
}

// ----- EXPORT: compositeOverColor -----
{
  // One pixel, straight alpha. noise=[200,100,50] @ a=128 over bg black.
  // out = round(noise * a/255 + bg * (1 - a/255)); a_out = 255.
  const noise = new Uint8ClampedArray([200, 100, 50, 128]);
  const out = EX.compositeOverColor(noise, [0, 0, 0]);
  ok("compositeOverColor r", out[0] === Math.round(200 * 128 / 255), "got " + out[0]);
  ok("compositeOverColor g", out[1] === Math.round(100 * 128 / 255), "got " + out[1]);
  ok("compositeOverColor b", out[2] === Math.round(50 * 128 / 255), "got " + out[2]);
  ok("compositeOverColor opaque", out[3] === 255, "got " + out[3]);

  // alpha=0 -> pure background; alpha=255 -> pure noise.
  const bgOnly = EX.compositeOverColor(new Uint8ClampedArray([200, 100, 50, 0]), [12, 34, 56]);
  ok("compositeOverColor a=0 is bg", bgOnly[0] === 12 && bgOnly[1] === 34 && bgOnly[2] === 56);
  const fg = EX.compositeOverColor(new Uint8ClampedArray([200, 100, 50, 255]), [12, 34, 56]);
  ok("compositeOverColor a=255 is noise", fg[0] === 200 && fg[1] === 100 && fg[2] === 50);

  // Does not mutate the input.
  const inp = new Uint8ClampedArray([9, 9, 9, 100]);
  EX.compositeOverColor(inp, [0, 0, 0]);
  ok("compositeOverColor is pure", inp[0] === 9 && inp[3] === 100);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/smoke-test.js`
Expected: FAIL — `EX.hexToRgb is not a function` (thrown) / the compositeOverColor lines absent.

- [ ] **Step 3: Write minimal implementation** — add to `perlin-export.js` (before the `root.MTPerlinExport = …` line, then extend that export):

```javascript
  // "#rrggbb" -> [r, g, b] (0–255). Assumes the 7-char form an <input type=color> yields.
  function hexToRgb(hex) {
    const n = parseInt((hex || "#000000").slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Composite straight-alpha RGBA noise over an opaque [r,g,b] background.
  // Returns a NEW opaque Uint8ClampedArray; does not mutate the input.
  function compositeOverColor(noise, bg) {
    const out = new Uint8ClampedArray(noise.length);
    const br = bg[0], bg1 = bg[1], bb = bg[2];
    for (let i = 0; i < noise.length; i += 4) {
      const a = noise[i + 3] / 255;
      const ia = 1 - a;
      out[i]     = Math.round(noise[i]     * a + br  * ia);
      out[i + 1] = Math.round(noise[i + 1] * a + bg1 * ia);
      out[i + 2] = Math.round(noise[i + 2] * a + bb  * ia);
      out[i + 3] = 255;
    }
    return out;
  }
```

Then change the export line to:

```javascript
  root.MTPerlinExport = { computeFitRect, compositeOverColor, hexToRgb };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/smoke-test.js`
Expected: all `hexToRgb …` and `compositeOverColor …` lines print `ok`; exit 0.

- [ ] **Step 5: Commit**

```bash
git add perlin-export.js scripts/smoke-test.js
git commit -m "feat(export): add compositeOverColor + hexToRgb (pure)"
```

---

## Task 3: Gate the new module + index.html export panel

**Files:**
- Modify: `scripts/check-syntax.mjs:23-29` (the `jsFiles` array)
- Modify: `index.html` (script tags ~388-392; §08 hint line 300; §09 section 317-330)

- [ ] **Step 1: Add `perlin-export.js` to the syntax gate** — in `scripts/check-syntax.mjs`, change the `jsFiles` array to include the new module:

```javascript
const jsFiles = [
  'perlin.js',
  'perlin-presets.js',
  'perlin-engine.js',
  'perlin-export.js',
  'perlin-studio.js',
  'perlin-element.js',
];
```

- [ ] **Step 2: Add the script tag** — in `index.html`, the deferred script block currently lists five files. Insert `perlin-export.js` before `perlin-studio.js`:

```html
  <script src="perlin.js" defer></script>
  <script src="perlin-presets.js" defer></script>
  <script src="perlin-engine.js" defer></script>
  <script src="perlin-export.js" defer></script>
  <script src="perlin-studio.js" defer></script>
  <script src="perlin-element.js" defer></script>
```

- [ ] **Step 3: Update the §08 Mask hint** — replace the line at `index.html:300`:

```html
        <p class="sec-hint">Load a PNG / JPG. Transparent (or dark) regions hide the noise. Affects live preview, PNG export, and video export.</p>
```

- [ ] **Step 4: Replace the §09 Export section** — replace the whole `<section>` for §09 (currently `index.html:317-330`) with:

```html
      <section class="ctrl-section">
        <h2><span class="sec-num">09</span><span class="sec-name">Export</span></h2>
        <p class="sec-hint">Render the animation to video. The mask and the chosen background are baked into the frames.</p>

        <label>resolution
          <select id="p-export-res">
            <option value="canvas">Match canvas</option>
            <option value="1080x1920">1080×1920 · portrait</option>
            <option value="1920x1080">1920×1080 · landscape</option>
            <option value="1080x1080">1080×1080 · square</option>
            <option value="1440x2560">1440×2560 · portrait HiDPI</option>
            <option value="2160x3840">2160×3840 · 4K portrait</option>
            <option value="custom">Custom…</option>
          </select>
        </label>
        <div class="grid-2" id="export-custom-res" hidden>
          <label>width<input type="number" id="p-export-w" min="16" max="4096" value="1080"></label>
          <label>height<input type="number" id="p-export-h" min="16" max="4096" value="1920"></label>
        </div>

        <div class="grid-2">
          <label>fps<input type="number" id="p-fps" min="1" max="60" value="30"></label>
          <label>frames<input type="number" id="p-frames" min="1" max="600" value="120"></label>
        </div>

        <label>background
          <select id="p-bg-type">
            <option value="color">Solid color</option>
            <option value="image">Image</option>
            <option value="transparent">Transparent (best-effort)</option>
          </select>
        </label>
        <div id="bg-color-row">
          <label class="color-row">color<input type="color" id="p-bg-color" value="#0a0a18"></label>
        </div>
        <div id="bg-image-row" hidden>
          <div class="mask-controls">
            <button type="button" id="btn-bg-load">Load background image</button>
            <button type="button" id="btn-bg-clear" disabled>Clear</button>
            <input type="file" id="bg-file" accept="image/png,image/jpeg,image/webp" hidden>
            <p class="mask-name" id="bg-name">using mask image</p>
            <label>fit
              <select id="p-bg-fit">
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
              </select>
            </label>
          </div>
        </div>
        <p class="sec-hint" id="bg-transparent-hint" hidden>This browser can't record transparent video — use a color or image background, or export with alpha on the native app (later phase).</p>

        <div class="export-actions">
          <button id="btn-png">PNG · current frame</button>
          <button id="btn-webm" class="primary">Record animation</button>
          <button id="btn-webm-download" hidden disabled>Download video</button>
        </div>
        <p class="sec-hint" id="export-estimate"></p>
      </section>
```

- [ ] **Step 5: Add minimal styles** — append to `styles.css`:

```css
/* Export background controls */
#bg-color-row .color-row { display: flex; align-items: center; gap: 0.5rem; }
#bg-color-row input[type="color"] { inline-size: 3rem; block-size: 1.8rem; padding: 0; }
#export-estimate:empty { display: none; }
```

- [ ] **Step 6: Verify markup + gate**

Run: `node scripts/check-syntax.mjs`
Expected: `SYNTAX OK — 8 script block(s) parse` (now includes perlin-export.js; perlin-studio.js still references not-yet-defined elements but that is runtime, not syntax — the gate only parses).

- [ ] **Step 7: Commit**

```bash
git add scripts/check-syntax.mjs index.html styles.css
git commit -m "feat(export): export panel markup (resolution + background) + gate perlin-export.js"
```

---

## Task 4: Studio bindings, state, and `gatherExportSpec()`

**Files:**
- Modify: `perlin-studio.js` (state block ~40-59; els block ~133-137; new function near `gatherParams` ~210)

- [ ] **Step 1: Add state fields** — in the `state` object (`perlin-studio.js:40`), add after `firstFrameRendered: false,`:

```javascript
  // Export background image (separate from the mask; falls back to the mask).
  bgSourceImage: null,
  bgName: null,
  exportCanvas: null,   // offscreen compositing canvas, created lazily
```

- [ ] **Step 2: Replace the Export els bindings** — replace the `// Export` block in `els` (`perlin-studio.js:133-137`) with:

```javascript
  // Export
  btnPng: $("btn-png"),
  btnWebm: $("btn-webm"),
  btnWebmDownload: $("btn-webm-download"),
  exportRes: $("p-export-res"),
  exportCustomRes: $("export-custom-res"),
  exportW: $("p-export-w"),
  exportH: $("p-export-h"),
  bgType: $("p-bg-type"),
  bgColorRow: $("bg-color-row"),
  bgColor: $("p-bg-color"),
  bgImageRow: $("bg-image-row"),
  btnBgLoad: $("btn-bg-load"),
  btnBgClear: $("btn-bg-clear"),
  bgFile: $("bg-file"),
  bgName: $("bg-name"),
  bgFit: $("p-bg-fit"),
  bgTransparentHint: $("bg-transparent-hint"),
  exportEstimate: $("export-estimate"),
```

- [ ] **Step 3: Add the resolution preset table + `gatherExportSpec`** — insert immediately after `gatherParams()` ends (after `perlin-studio.js:245`-ish; place it after the full `gatherParams` function body):

```javascript
const EXPORT_RES_PRESETS = {
  "1080x1920": [1080, 1920],
  "1920x1080": [1920, 1080],
  "1080x1080": [1080, 1080],
  "1440x2560": [1440, 2560],
  "2160x3840": [2160, 3840],
};

// Build the full export description from the UI. base.width/height are
// overridden to the EXPORT resolution (decoupled from the live canvas size).
function gatherExportSpec() {
  const base = gatherParams();
  let width, height;
  const sel = els.exportRes.value;
  if (sel === "canvas") {
    width = base.width; height = base.height;
  } else if (sel === "custom") {
    width = clampInt(els.exportW.value, 16, 4096, 1080);
    height = clampInt(els.exportH.value, 16, 4096, 1920);
  } else {
    const p = EXPORT_RES_PRESETS[sel] || [base.width, base.height];
    width = p[0]; height = p[1];
  }
  base.width = width;
  base.height = height;
  return {
    base, width, height,
    fps: clampInt(els.fps.value, 1, 60, 30),
    frames: clampInt(els.frames.value, 1, 600, 120),
    loop: base.loop,
    background: {
      type: els.bgType.value,
      color: els.bgColor.value || "#000000",
      image: state.bgSourceImage || state.maskSourceImage || null,
      fit: els.bgFit.value || "cover",
    },
    mask: state.maskApplied,
  };
}
```

- [ ] **Step 4: Verify syntax**

Run: `node scripts/check-syntax.mjs`
Expected: `SYNTAX OK — 8 script block(s) parse`.

- [ ] **Step 5: Commit**

```bash
git add perlin-studio.js
git commit -m "feat(export): export els/state bindings + gatherExportSpec()"
```

---

## Task 5: Compositor + render-at-resolution recording

**Files:**
- Modify: `perlin-studio.js` — `setupRecorder` (~940), add `compositeExportFrame`, rework `recordWebm` → `recordVideo` (~972-1064)

- [ ] **Step 1: Parametrize `setupRecorder` by canvas** — change the signature and the two `els.canvas` references in `setupRecorder` (`perlin-studio.js:940-944`):

```javascript
function setupRecorder(canvas, fps) {
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const canRequestFrame = !!(track && typeof track.requestFrame === "function");
  const finalStream = canRequestFrame ? stream : canvas.captureStream(fps);
```

(The rest of `setupRecorder` is unchanged.)

- [ ] **Step 2: Add the compositor** — insert `compositeExportFrame` just above `recordWebm` (`perlin-studio.js:972`):

```javascript
// Draw the background, then the rendered masked-noise frame (already on the
// engine canvas) on top, into the offscreen compositing canvas `cctx`.
// Color path uses the tested pure compositor for an exact, opaque result;
// image/transparent paths use canvas source-over (drawImage respects alpha).
function compositeExportFrame(cctx, spec) {
  const W = spec.width, H = spec.height, bg = spec.background;
  cctx.clearRect(0, 0, W, H);
  if (bg.type === "color") {
    const src = engine.ctx.getImageData(0, 0, W, H);
    const out = MTPerlinExport.compositeOverColor(src.data, MTPerlinExport.hexToRgb(bg.color));
    cctx.putImageData(new ImageData(out, W, H), 0, 0);
    return;
  }
  if (bg.type === "image" && bg.image) {
    const r = MTPerlinExport.computeFitRect(bg.image.width, bg.image.height, W, H, bg.fit);
    cctx.drawImage(bg.image, r.x, r.y, r.w, r.h);
  }
  // transparent: nothing drawn behind. image: bg already drawn. Now the noise:
  cctx.drawImage(engine.canvas, 0, 0);
}
```

- [ ] **Step 3: Rework `recordWebm` into `recordVideo`** — replace the entire `recordWebm` function (`perlin-studio.js:972-1064`) with:

```javascript
/**
 * Records the animation to video (MP4/H.264 where supported, else WebM).
 * Renders each frame at the EXPORT resolution via the engine (mask applied by
 * transformFrame), composites it over the chosen background onto an offscreen
 * canvas, and records THAT canvas. Restores the live canvas afterward.
 */
async function recordVideo() {
  if (state.recording) return;
  if (!window.MediaRecorder || supportedRecorderMimes().length === 0) {
    setStatus("Your browser can't record video here (no supported codec).", true);
    return;
  }

  const spec = gatherExportSpec();
  const wasPlaying = engine.playing;
  if (wasPlaying) pause();

  // Offscreen compositing canvas at export resolution — recorded instead of the
  // live canvas, so export size is independent of the on-screen canvas.
  const cc = state.exportCanvas || (state.exportCanvas = document.createElement("canvas"));
  cc.width = spec.width;
  cc.height = spec.height;
  const cctx = cc.getContext("2d");

  const startSlider = getTValue();
  const { recorder, mime, ext, track, canRequestFrame, stopped } = setupRecorder(cc, spec.fps);
  state.recorder = recorder;
  recorder.start();
  state.recording = true;
  state.recordingCancel = false;
  els.btnWebm.textContent = "Stop recording";
  els.btnWebmDownload.hidden = true;
  els.btnWebmDownload.disabled = true;
  setProgress(0);
  setFrameState("rec");

  const frameDelayMs = 1000 / spec.fps;
  let lastAnnounced = -1;

  try {
    for (let i = 0; i < spec.frames; i++) {
      if (state.recordingCancel) break;
      const params = paramsForRecordingFrame(spec.base, startSlider, i, spec.frames, spec.fps);
      await engine.renderFrameAndWait(params);
      compositeExportFrame(cctx, spec);
      if (canRequestFrame) track.requestFrame();
      const pct = Math.round(((i + 1) / spec.frames) * 100);
      setProgress(pct);
      const milestone = pct - (pct % 10);
      if (milestone !== lastAnnounced || i + 1 === spec.frames) {
        lastAnnounced = milestone;
        setStatus(`Recording: ${pct}% — frame ${i + 1}/${spec.frames}${spec.loop ? " (loop)" : ""}`);
      }
      await new Promise(r => setTimeout(r, frameDelayMs));
    }
    if (canRequestFrame) track.requestFrame();
    await new Promise(r => setTimeout(r, frameDelayMs));
  } finally {
    recorder.stop();
    await stopped;
    state.recording = false;
    els.btnWebm.textContent = "Record animation";
    setProgress(null);
  }

  const cancelled = state.recordingCancel;
  const blob = new Blob(state.recordedChunks, { type: mime });
  if (blob.size === 0) {
    setStatus("Recording stopped before any frame was captured.", true);
    renderOnce();
    if (wasPlaying) play(); else setFrameState("paused");
    return;
  }
  state.recordedBlob = blob;
  state.recordedExt = ext;
  els.btnWebmDownload.textContent = "Download " + (ext === "mp4" ? "MP4" : "WebM");
  els.btnWebmDownload.hidden = false;
  els.btnWebmDownload.disabled = false;
  const sizeKb = (blob.size / 1024).toFixed(1);

  // Restore the live canvas at the UI resolution (recording resized it to the
  // export size). renderOnce() also retires any stale <video> preview.
  renderOnce();

  if (wasPlaying) {
    play();
    setStatus(cancelled
      ? `Recording stopped — partial clip, ${sizeKb} KB (Download).`
      : `Animation done — ${spec.frames} frames @ ${spec.fps} fps, ${spec.width}×${spec.height}, ${sizeKb} KB (Download).`);
  } else {
    els.animPreview.src = URL.createObjectURL(blob);
    els.animPreview.classList.add("ready");
    els.canvas.classList.add("hidden");
    setFrameState("paused");
    setStatus(cancelled
      ? `Recording stopped — partial clip, ${sizeKb} KB.`
      : `Animation done — ${spec.frames} frames @ ${spec.fps} fps, ${spec.width}×${spec.height}, ${sizeKb} KB.`);
  }
}
```

Note: when not playing, the success branch shows the `<video>` preview, so the `renderOnce()` above runs first (restoring canvas size) and then the preview is layered over the hidden canvas — order matches the original control flow.

- [ ] **Step 4: Verify syntax**

Run: `node scripts/check-syntax.mjs`
Expected: `SYNTAX OK — 8 script block(s) parse`.

- [ ] **Step 5: Commit**

```bash
git add perlin-studio.js
git commit -m "feat(export): composite mask+background into video at export resolution"
```

---

## Task 6: Background UI behavior + wiring; remove RGB-only hint

**Files:**
- Modify: `perlin-studio.js` — remove `updateWebmMaskHint` (375-379) + its two callers (408, 431); add bg helpers; rewire the export button + new controls (~1164-1175)

- [ ] **Step 1: Remove the obsolete RGB-only hint** — delete the `updateWebmMaskHint` function (`perlin-studio.js:375-379`) and remove its **three** call sites: inside `loadMaskFile` (~408), inside `clearMask` (~431), and inside the `els.maskApply` change listener (~1195, the `updateWebmMaskHint();` line between `state.maskApplied = …` and `renderOnce();`). (The `els.webmMaskHint` binding was already removed in Task 4 Step 2, and the DOM element in Task 3.)

- [ ] **Step 2: Add background + resolution UI helpers** — insert near the other `update*Mode` helpers (e.g. after `updateWarpMode`, ~373):

```javascript
// Reveal the custom width/height inputs only for the "custom" resolution.
function updateExportResMode() {
  els.exportCustomRes.hidden = els.exportRes.value !== "custom";
}

// Some browsers can't record an alpha video. Probe a WebM/VP-with-alpha
// candidate; if absent, gray out "transparent" and explain.
function transparentRecordingSupported() {
  return !!(window.MediaRecorder && MediaRecorder.isTypeSupported &&
    (MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ||
     MediaRecorder.isTypeSupported("video/webm;codecs=vp8")));
}

// Show the right background controls for the selected type.
function updateBgMode() {
  const type = els.bgType.value;
  els.bgColorRow.hidden = type !== "color";
  els.bgImageRow.hidden = type !== "image";
  els.bgTransparentHint.hidden = !(type === "transparent" && !transparentRecordingSupported());
}

function loadBgFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const bitmap = await createImageBitmap(new Blob([e.target.result]));
      state.bgSourceImage = bitmap;
      state.bgName = file.name;
      els.bgName.textContent = `${file.name} · ${bitmap.width}×${bitmap.height}`;
      els.btnBgClear.disabled = false;
      setStatus(`Background image loaded: ${file.name}`);
    } catch (err) {
      setStatus(`Background load failed: ${err.message}`, true);
    }
  };
  reader.onerror = () => setStatus("Background load failed: file unreadable", true);
  reader.readAsArrayBuffer(file);
}

function clearBg() {
  if (state.bgSourceImage && state.bgSourceImage.close) state.bgSourceImage.close();
  state.bgSourceImage = null;
  state.bgName = null;
  els.bgName.textContent = "using mask image";
  els.btnBgClear.disabled = true;
  setStatus("Background image cleared.");
}

// Readout of export dimensions + duration, with a soft warning for very large
// jobs (long clips at high resolution are slow and memory-heavy under
// MediaRecorder).
function updateExportEstimate() {
  const spec = gatherExportSpec();
  const secs = (spec.frames / spec.fps).toFixed(1);
  const big = spec.width * spec.height * spec.frames > 1080 * 1920 * 300;
  els.exportEstimate.textContent =
    `${spec.width}×${spec.height} · ${spec.frames} frames · ${secs}s` +
    (big ? " · large job — may be slow / memory-heavy" : "");
}
```

- [ ] **Step 3: Rewire the export button + new controls** — in `wireEvents()` the existing `els.btnWebm` handler (`perlin-studio.js:1164-1174`) calls `recordWebm()`. Replace that handler block, and the `els.btnWebmDownload` line right after it, with the following (swaps `recordWebm` → `recordVideo`, keeps the existing cancel-via-flag stop behavior and the error catch, and adds the new control listeners):

```javascript
  els.btnWebm.addEventListener("click", () => {
    if (state.recording) { state.recordingCancel = true; return; }
    recordVideo().catch((err) => {
      console.error(err);
      setStatus(`Recording error: ${err.message}`, true);
      state.recording = false;
      els.btnWebm.textContent = "Record animation";
      setProgress(null);
      setFrameState(engine.playing ? "live" : "paused");
    });
  });
  els.btnWebmDownload.addEventListener("click", downloadWebm);

  els.exportRes.addEventListener("change", () => { updateExportResMode(); updateExportEstimate(); });
  els.bgType.addEventListener("change", updateBgMode);
  els.btnBgLoad.addEventListener("click", () => els.bgFile.click());
  els.bgFile.addEventListener("change", (e) => { if (e.target.files[0]) loadBgFile(e.target.files[0]); e.target.value = ""; });
  els.btnBgClear.addEventListener("click", clearBg);
  for (const el of [els.exportW, els.exportH, els.fps, els.frames]) {
    el.addEventListener("input", updateExportEstimate);
  }
```

- [ ] **Step 4: Initialize the background/resolution UI** — in the startup IIFE `(function init() { … })()` (`perlin-studio.js:1247`), which calls `updateColorSections()` / `updateLoopMode()` / `updateLayer2Mode()` / `updateWarpMode()` then `wireEvents()`, add these three calls immediately **before** the `wireEvents();` line:

```javascript
  updateExportResMode();
  updateBgMode();
  updateExportEstimate();
```

- [ ] **Step 5: Verify syntax**

Run: `node scripts/check-syntax.mjs`
Expected: `SYNTAX OK — 8 script block(s) parse`.

- [ ] **Step 6: Manual smoke (browser)** — serve and click through:

Run: `python3 -m http.server 8000` (if the sandbox forbids it, ask the user to run it), open `http://localhost:8000`.
Verify:
- Record with background = **color**: downloaded clip shows masked noise over the color (mask baked in).
- Record with background = **image** (load one; cover & contain): noise composites over the image through the mask.
- Background = **transparent**: option disabled with hint on a browser that can't record alpha; on Chromium, produces a WebM.
- Resolution **1080×1920** and **custom**: exported file has those pixel dimensions; live canvas returns to its prior size afterward.
- Loop on: the clip loops with no visible jump.

- [ ] **Step 7: Commit**

```bash
git add perlin-studio.js
git commit -m "feat(export): background mode UI + resolution wiring; drop RGB-only hint"
```

---

## Task 7: Docs + final gate

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Modify: `AGENTS.md` (module layering + file-layout tree)

- [ ] **Step 1: CHANGELOG entry** — under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, add:

```markdown
- **Video export bakes the mask + a background** (web) — the recorder now
  composites the active image mask and a chosen background (solid color,
  imported image with cover/contain, or best-effort transparent) into the
  exported frames, at a chosen export resolution (presets + custom) decoupled
  from the on-screen canvas. New zero-dependency `perlin-export.js` holds the
  compositing math.
```

- [ ] **Step 2: AGENTS.md** — in the "Module layering" list add `perlin-export.js` as a consumer-side utility, and add it to the file-layout tree near the other root scripts:

```
├── perlin-export.js       # pure compositing math for video export (window.MTPerlinExport)
```

In "Module layering", append a bullet:

```
5. `perlin-export.js` → `MTPerlinExport` — pure compositing helpers
   (`computeFitRect`, `compositeOverColor`, `hexToRgb`) used by the studio's
   video export. No DOM; Node-requirable (smoke-tested).
```

- [ ] **Step 3: Full gate**

Run: `node scripts/check-syntax.mjs && node scripts/smoke-test.js`
Expected: `SYNTAX OK — 8 script block(s) parse`, then all smoke-test lines `ok` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs(export): changelog + AGENTS for perlin-export module"
```

---

## Self-review notes (for the implementer)

- **Mask still works at export size:** `applyMaskToImageData` rebuilds its alpha cache whenever the render size changes (`maskCacheW/H` mismatch), so rendering at e.g. 1080×1920 re-rasterizes the mask correctly.
- **`engine.ctx` / `engine.canvas`** are the live canvas + 2D context the engine paints into; `compositeExportFrame` reads from them straight after `renderFrameAndWait` resolves.
- **Resolution restore:** rendering at export size resizes the live canvas (engine auto-resizes to `params.width/height`); the trailing `renderOnce()` re-renders at the UI `gatherParams()` size.
- **No new dependency:** `perlin-export.js` is in-repo vanilla JS (honors PROF-WEB-01 / AGENTS zero-dep rule).
- **Deferred to later phases (do NOT add here):** GIF/animated-WebP, WebCodecs frame-exact encoder + muxer, native MP4/H.264 + alpha, 4D-loop Metal port.
