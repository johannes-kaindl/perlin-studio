/**
 * perlin-studio.js — main-thread controller of Perlin Studio.
 *
 * Ties the UI, preset system, image mask, and video recorder to a PerlinEngine
 * (perlin-engine.js) that owns the worker + RAF render loop. Pure vanilla JS,
 * no dependencies beyond `perlin.js` and `perlin-presets.js`.
 *
 * Data flow:
 *   1. UI input / slider / preset → `gatherParams()` builds a plain object
 *      (with the gradient resolved to concrete stops).
 *   2. `engine.setParams(params)` + `engine.renderOnce()` / `engine.play()`.
 *   3. The engine renders in the worker and paints the canvas; it reports
 *      progress via `onTick` (drives the slider) and `onFrame` (FPS readout),
 *      and calls `transformFrame` so the image mask is applied before paint.
 *
 * For recording, `engine.renderFrameAndWait` is used so every frame lands
 * in the `MediaRecorder` stream — the normal skip logic would drop frames.
 *
 * @license AGPL-3.0-or-later
 */

// Gradients + built-in presets live in the shared perlin-presets.js module so
// the <perlin-noise> element resolves them identically. (Loaded before this
// script in index.html.)
const { GRADIENTS, BUILTIN_PRESETS } = window.MTPerlinPresets;

// ============= STATE =============
// Custom gradient — survives switches between named presets and "Custom"
// in the same session. JSON preset save/load round-trips it through the
// `gradient` field. Seeded with viridis so first activation has something
// editable rather than an empty list.
const DEFAULT_CUSTOM_STOPS = [
  { pos: 0.0, color: [68, 1, 84] },
  { pos: 0.5, color: [33, 145, 140] },
  { pos: 1.0, color: [253, 231, 37] },
];

// Rendering/animation state (worker, RAF, FPS) is owned by the PerlinEngine
// instance below; this object holds only studio-specific UI state.
const state = {
  customStops: DEFAULT_CUSTOM_STOPS.map(s => ({ pos: s.pos, color: s.color.slice() })),

  // Image mask — see initMaskControls below.
  maskSourceImage: null,        // ImageBitmap drawn from the loaded file
  maskName: null,               // filename for the UI readout
  maskAlphaCache: null,         // Uint8Array of alpha values at current canvas size
  maskCacheW: 0,
  maskCacheH: 0,
  maskApplied: false,
  maskInvert: false,

  recording: false,
  recordingCancel: false,
  recordedChunks: [],
  recordedBlob: null,
  recordedExt: "webm",          // container of the last recording (drives the download name)
  recorder: null,
  firstFrameRendered: false,
};

// ============= DOM =============
const $ = (id) => document.getElementById(id);
const els = {
  // Resolution / noise
  w: $("p-w"), h: $("p-h"),
  tileX: $("p-tile-x"), tileY: $("p-tile-y"),
  sx: $("p-sx"), sy: $("p-sy"), st: $("p-st"),
  base: $("p-base"), oct: $("p-oct"), pers: $("p-pers"), lac: $("p-lac"),

  // Warp
  warpStrength: $("p-warp-strength"),
  warpScale:    $("p-warp-scale"),
  warpExtra:    $("warp-extra"),

  // Layer 2
  layer2On:       $("p-layer2-on"),
  layer2Controls: $("layer2-controls"),
  layer2Sx:       $("p-layer2-sx"),
  layer2Sy:       $("p-layer2-sy"),
  layer2Oct:      $("p-layer2-oct"),
  layer2Base:     $("p-layer2-base"),
  layer2Blend:    $("p-layer2-blend"),
  layer2Mix:      $("p-layer2-mix"),

  // Loop
  loop: $("p-loop"),
  loopDuration: $("p-loop-duration"),
  loopRadius: $("p-loop-radius"),
  loopControls: $("loop-controls"),

  // Color mode
  colorMode: $("p-color-mode"),
  btnCustomPalette: $("btn-custom-palette"),
  // rgb
  rs: $("p-rs"), gs: $("p-gs"), bs: $("p-bs"),
  ri: $("p-ri"), gi: $("p-gi"), bi: $("p-bi"),
  rgbMulti: $("p-rgb-multi"),
  // gradient
  gradientPreset: $("p-gradient-preset"),
  gradientPreview: $("p-gradient-preview"),
  customStopsWrap: $("custom-stops"),
  customStopsList: $("custom-stops-list"),
  btnAddStop: $("btn-add-stop"),
  paletteInput: $("palette-input"),
  btnApplyPalette: $("btn-apply-palette"),
  // hsv
  hueShift: $("p-hue-shift"), hueRange: $("p-hue-range"),
  sat: $("p-sat"), val: $("p-val"),
  // flow
  flowHueShift: $("p-flow-hue-shift"),
  flowSat:      $("p-flow-sat"),
  flowGain:     $("p-flow-gain"),
  flowFloor:    $("p-flow-floor"),
  flowEps:      $("p-flow-eps"),
  // posterize
  posterSteps: $("p-poster-steps"),
  posterGradient: $("p-poster-gradient"),

  // Mask
  btnMaskLoad: $("btn-mask-load"),
  btnMaskClear: $("btn-mask-clear"),
  maskFile: $("mask-file"),
  maskName: $("mask-name"),
  maskApply: $("p-mask-apply"),
  maskInvert: $("p-mask-invert"),

  // Presets
  btnPresetSave: $("btn-preset-save"),
  btnPresetLoad: $("btn-preset-load"),
  presetFile: $("preset-file"),
  chips: document.querySelectorAll(".preset-chip"),

  // Export
  btnPng: $("btn-png"),
  btnWebm: $("btn-webm"),
  btnWebmDownload: $("btn-webm-download"),
  webmMaskHint: $("webm-mask-hint"),

  // Main output
  canvas: $("canvas-output"),
  animPreview: $("anim-preview"),
  frameTag: $("frame-tag-tr"),
  tagVal: $("tag-val"),
  canvasLoading: $("canvas-loading"),

  // Transport
  btnPlay: $("btn-play"),
  btnResetT: $("btn-reset-t"),
  t: $("p-t"),
  tDisplay: $("t-display"),
  tLabelName: $("t-label-name"),
  fps: $("p-fps"),
  frames: $("p-frames"),

  status: $("status"),
  fpsCounter: $("fps-counter"),
  engineMode: $("engine-mode"),
  progress: $("progress"),
  progressBar: $("progress-bar"),

  colorSections: document.querySelectorAll(".color-section"),
};

// ============= UTIL =============
/** Parse + clamp an input to an integer; on NaN/empty → fallback. */
function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
/** Parse + clamp an input to a float; on NaN/empty → fallback. */
function clampFloat(value, lo, hi, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
function setStatus(msg, isError = false) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("error", !!isError);
  // Errors interrupt (assertive); routine progress is announced politely.
  els.status.setAttribute("aria-live", isError ? "assertive" : "polite");
}
function setProgress(pct) {
  if (pct == null) {
    els.progress.classList.remove("active");
    els.progressBar.style.width = "0%";
    els.progress.removeAttribute("aria-valuenow");
  } else {
    const v = Math.max(0, Math.min(100, pct));
    els.progress.classList.add("active");
    els.progressBar.style.width = `${v}%`;
    els.progress.setAttribute("aria-valuenow", String(Math.round(v)));
  }
}

/** Format a slider value for display: integers as-is, else 2 decimals. */
function formatRangeVal(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ============= PARAMS COLLECT =============
/**
 * Reads the current UI state and builds a plain object that goes to either
 * `generatePerlinImage` (synchronous) or to the worker via `postMessage`.
 * Every field is validated via `clampInt`/`clampFloat` with default
 * fallbacks — the worker needs no further validation.
 *
 * @returns {Object} Studio parameters (see the `perlin.js` module header)
 */
function gatherParams() {
  const colorMode = els.colorMode.value;
  const base = {
    width:       clampInt(els.w.value, 4, 1024, 256),
    height:      clampInt(els.h.value, 4, 1024, 256),
    tileX:       clampInt(els.tileX.value, 0, 64, 0),
    tileY:       clampInt(els.tileY.value, 0, 64, 0),
    scaleX:      clampFloat(els.sx.value, 0.0001, 10, 0.02),
    scaleY:      clampFloat(els.sy.value, 0.0001, 10, 0.02),
    scaleT:      clampFloat(els.st.value, 0, 10, 0.15),
    base:        parseInt(els.base.value, 10) || 0,
    octaves:     clampInt(els.oct.value, 1, 10, 6),
    persistence: clampFloat(els.pers.value, 0, 2, 0.5),
    lacunarity:  clampFloat(els.lac.value, 1, 8, 2.0),
    warpStrength: clampFloat(els.warpStrength.value, 0, 8, 0),
    warpScale:    clampFloat(els.warpScale.value, 0.05, 16, 1),
    layer2On:        els.layer2On.checked,
    layer2ScaleX:    clampFloat(els.layer2Sx.value, 0.0001, 10, 0.06),
    layer2ScaleY:    clampFloat(els.layer2Sy.value, 0.0001, 10, 0.06),
    layer2Octaves:   clampInt(els.layer2Oct.value, 1, 10, 4),
    layer2Base:      parseInt(els.layer2Base.value, 10) || 0,
    layer2BlendMode: els.layer2Blend.value,
    layer2Mix:       clampFloat(els.layer2Mix.value, 0, 1, 0.5),
    colorMode,
    loop:         els.loop.checked,
    loopDuration: clampFloat(els.loopDuration.value, 0.5, 60, 4),
    loopRadius:   clampFloat(els.loopRadius.value, 0, 4, 1.0),
  };
  if (colorMode === "rgb") {
    base.rScale = clampFloat(els.rs.value, 0, 4, 0);
    base.gScale = clampFloat(els.gs.value, 0, 4, 1);
    base.bScale = clampFloat(els.bs.value, 0, 4, 0);
    base.rInvert = els.ri.checked;
    base.gInvert = els.gi.checked;
    base.bInvert = els.bi.checked;
    base.rgbMultiChannel = els.rgbMulti.checked;
  } else if (colorMode === "flow") {
    base.flowHueShift = clampFloat(els.flowHueShift.value, 0, 1, 0);
    base.flowSat      = clampFloat(els.flowSat.value, 0, 1, 0.85);
    base.flowGain     = clampFloat(els.flowGain.value, 0.05, 50, 4);
    base.flowFloor    = clampFloat(els.flowFloor.value, 0, 1, 0.05);
    base.flowEps      = clampFloat(els.flowEps.value, 0.05, 10, 0.6);
  } else if (colorMode === "gradient") {
    const name = els.gradientPreset.value;
    base.gradientName = name;
    base.gradient = (name === "custom")
      ? state.customStops.map(s => ({ pos: s.pos, color: s.color.slice() }))
      : (GRADIENTS[name] || GRADIENTS.viridis);
  } else if (colorMode === "hsv") {
    base.hsvHueShift = clampFloat(els.hueShift.value, 0, 1, 0);
    base.hsvHueRange = clampFloat(els.hueRange.value, 0, 1, 0.6);
    base.hsvSat = clampFloat(els.sat.value, 0, 1, 0.8);
    base.hsvVal = clampFloat(els.val.value, 0, 1, 1);
  } else if (colorMode === "posterize") {
    base.posterizeSteps = clampInt(els.posterSteps.value, 2, 16, 5);
    const name = els.posterGradient.value;
    base.gradientName = name;
    base.gradient = (name === "custom")
      ? state.customStops.map(s => ({ pos: s.pos, color: s.color.slice() }))
      : (GRADIENTS[name] || GRADIENTS.viridis);
  }
  return base;
}

// ============= APPLY PARAMS (preset → UI) =============
/**
 * Inverse of `gatherParams`: writes a parameter snapshot back into the UI
 * inputs. Used by built-in presets and JSON import. Fields absent from the
 * snapshot are left unchanged.
 *
 * @param {Object} p  Parameter snapshot (may be partial)
 */
function applyParamsToUi(p) {
  if (p.width != null) els.w.value = p.width;
  if (p.height != null) els.h.value = p.height;
  if (p.tileX != null) els.tileX.value = p.tileX;
  if (p.tileY != null) els.tileY.value = p.tileY;
  if (p.scaleX != null) els.sx.value = p.scaleX;
  if (p.scaleY != null) els.sy.value = p.scaleY;
  if (p.scaleT != null) els.st.value = p.scaleT;
  if (p.base != null) els.base.value = p.base;
  if (p.octaves != null) els.oct.value = p.octaves;
  if (p.persistence != null) els.pers.value = p.persistence;
  if (p.lacunarity != null) els.lac.value = p.lacunarity;
  if (p.warpStrength != null) els.warpStrength.value = p.warpStrength;
  if (p.warpScale != null) els.warpScale.value = p.warpScale;
  updateWarpMode();

  if (p.layer2On != null) els.layer2On.checked = p.layer2On;
  if (p.layer2ScaleX != null) els.layer2Sx.value = p.layer2ScaleX;
  if (p.layer2ScaleY != null) els.layer2Sy.value = p.layer2ScaleY;
  if (p.layer2Octaves != null) els.layer2Oct.value = p.layer2Octaves;
  if (p.layer2Base != null) els.layer2Base.value = p.layer2Base;
  if (p.layer2BlendMode) els.layer2Blend.value = p.layer2BlendMode;
  if (p.layer2Mix != null) els.layer2Mix.value = p.layer2Mix;
  updateLayer2Mode();

  if (p.loop != null) { els.loop.checked = p.loop; }
  if (p.loopDuration != null) els.loopDuration.value = p.loopDuration;
  if (p.loopRadius != null) els.loopRadius.value = p.loopRadius;
  updateLoopMode();

  if (p.colorMode) {
    els.colorMode.value = p.colorMode;
    updateColorSections();
  }
  if (p.rScale != null) els.rs.value = p.rScale;
  if (p.gScale != null) els.gs.value = p.gScale;
  if (p.bScale != null) els.bs.value = p.bScale;
  if (p.rInvert != null) els.ri.checked = p.rInvert;
  if (p.gInvert != null) els.gi.checked = p.gInvert;
  if (p.bInvert != null) els.bi.checked = p.bInvert;
  if (p.rgbMultiChannel != null) els.rgbMulti.checked = p.rgbMultiChannel;
  if (p.flowHueShift != null) els.flowHueShift.value = p.flowHueShift;
  if (p.flowSat != null) els.flowSat.value = p.flowSat;
  if (p.flowGain != null) els.flowGain.value = p.flowGain;
  if (p.flowFloor != null) els.flowFloor.value = p.flowFloor;
  if (p.flowEps != null) els.flowEps.value = p.flowEps;
  if (p.gradientName) {
    els.gradientPreset.value = p.gradientName;
    els.posterGradient.value = p.gradientName;
    // A saved custom gradient travels in `p.gradient`. Pull it into state
    // so the editor reflects what was loaded — otherwise switching to
    // "Custom" would silently show the previous in-memory stops.
    if (p.gradientName === "custom" && Array.isArray(p.gradient) && p.gradient.length >= 2) {
      state.customStops = p.gradient.map(s => ({
        pos: typeof s.pos === "number" ? s.pos : 0,
        color: Array.isArray(s.color) ? s.color.slice(0, 3) : [0, 0, 0],
      }));
      renderCustomStops();
    }
  }
  if (p.hsvHueShift != null) els.hueShift.value = p.hsvHueShift;
  if (p.hsvHueRange != null) els.hueRange.value = p.hsvHueRange;
  if (p.hsvSat != null) els.sat.value = p.hsvSat;
  if (p.hsvVal != null) els.val.value = p.hsvVal;
  if (p.posterizeSteps != null) els.posterSteps.value = p.posterizeSteps;
  // Editor visibility + gradient preview, after the mode and gradient name are
  // applied. Must run for ALL modes: now that #custom-stops is a section-level
  // sibling, updateColorSections() no longer hides it via the gradient section,
  // so a preset without a gradientName (RGB/HSV/Flow) must hide it here.
  updateGradientPreview();
  refreshRangeReadouts();
}

function updateColorSections() {
  const active = els.colorMode.value;
  for (const sec of els.colorSections) {
    const isActive = sec.dataset.for === active;
    sec.hidden = !isActive;
  }
}

// Layer 2's sub-fields do nothing while the toggle is off (the engine ignores
// them), so disable them — matching how the Loop / Color / Mask sections gate
// their own controls.
function updateLayer2Mode() {
  // Progressive disclosure: reveal the Layer-2 controls only when enabled.
  els.layer2Controls.hidden = !els.layer2On.checked;
}
function updateWarpMode() {
  // Warp scale is inert until strength > 0 — reveal it only when it matters.
  els.warpExtra.hidden = clampFloat(els.warpStrength.value, 0, 8, 0) <= 0;
}

// Video recording is RGB-only and ignores the alpha mask. Surface that caveat
// right at the export button (not just in the distant Mask section) while on.
function updateWebmMaskHint() {
  if (els.webmMaskHint) els.webmMaskHint.hidden = !state.maskApplied;
}

// ============= IMAGE MASK =============
// The mask is loaded once from a user-supplied PNG / JPG and re-rasterised
// to the current canvas resolution on demand. The cached Uint8Array of
// alpha bytes is what the render pipeline consumes per pixel — cheap.
// PNG export inherits the alpha automatically; video recording does not (the
// canvas stream is RGB-only), so masked frames render onto whatever's
// behind the canvas at recording time.

function loadMaskFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const blob = new Blob([e.target.result]);
      const bitmap = await createImageBitmap(blob);
      state.maskSourceImage = bitmap;
      state.maskName = file.name;
      state.maskAlphaCache = null;
      state.maskCacheW = 0;
      state.maskCacheH = 0;
      if (els.maskName) els.maskName.textContent = `${file.name} · ${bitmap.width}×${bitmap.height}`;
      if (els.maskApply) els.maskApply.disabled = false;
      if (els.btnMaskClear) els.btnMaskClear.disabled = false;
      // Auto-enable on load so users see the effect immediately.
      if (els.maskApply && !els.maskApply.checked) {
        els.maskApply.checked = true;
        state.maskApplied = true;
      }
      updateWebmMaskHint();
      setStatus(`Mask loaded: ${file.name} (${bitmap.width}×${bitmap.height})`);
      renderOnce();
    } catch (err) {
      console.error(err);
      setStatus(`Mask load failed: ${err.message}`, true);
    }
  };
  reader.onerror = () => setStatus("Mask load failed: file unreadable", true);
  reader.readAsArrayBuffer(file);
}

function clearMask() {
  if (state.maskSourceImage && state.maskSourceImage.close) state.maskSourceImage.close();
  state.maskSourceImage = null;
  state.maskName = null;
  state.maskAlphaCache = null;
  state.maskCacheW = 0;
  state.maskCacheH = 0;
  state.maskApplied = false;
  if (els.maskName) els.maskName.textContent = "no mask loaded";
  if (els.maskApply) { els.maskApply.checked = false; els.maskApply.disabled = true; }
  if (els.btnMaskClear) els.btnMaskClear.disabled = true;
  updateWebmMaskHint();
  setStatus("Mask cleared.");
  renderOnce();
}

function rebuildMaskAlphaCache(targetW, targetH) {
  if (!state.maskSourceImage) return;
  const c = document.createElement("canvas");
  c.width = targetW;
  c.height = targetH;
  const cx = c.getContext("2d");
  // Stretch the mask to the canvas size. Users picking a masking image
  // are responsible for aspect-matching it; otherwise it warps.
  cx.drawImage(state.maskSourceImage, 0, 0, targetW, targetH);
  const imgData = cx.getImageData(0, 0, targetW, targetH);
  const alphas = new Uint8Array(targetW * targetH);
  // Use the alpha channel of the source. For opaque source images (most
  // JPEGs and PNGs) this is always 255 — fall back to luminance so a
  // black-and-white silhouette still works.
  let anyTransparent = false;
  for (let i = 0; i < alphas.length; i++) {
    const a = imgData.data[i * 4 + 3];
    if (a < 255) anyTransparent = true;
    alphas[i] = a;
  }
  if (!anyTransparent) {
    // Fully opaque file → use luminance as mask. Bright = visible.
    for (let i = 0; i < alphas.length; i++) {
      const r = imgData.data[i * 4];
      const g = imgData.data[i * 4 + 1];
      const b = imgData.data[i * 4 + 2];
      // Rec. 709 luminance.
      alphas[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }
  state.maskAlphaCache = alphas;
  state.maskCacheW = targetW;
  state.maskCacheH = targetH;
}

function applyMaskToImageData(imgData) {
  if (!state.maskApplied || !state.maskSourceImage) return;
  if (state.maskCacheW !== imgData.width || state.maskCacheH !== imgData.height) {
    rebuildMaskAlphaCache(imgData.width, imgData.height);
  }
  const cache = state.maskAlphaCache;
  if (!cache) return;
  const data = imgData.data;
  const invert = state.maskInvert;
  for (let i = 0; i < cache.length; i++) {
    const a = invert ? 255 - cache[i] : cache[i];
    data[i * 4 + 3] = a;
  }
}

// Loop mode changes the behaviour of the t slider:
// loop=on  → slider is loop progress in [0, 1)
// loop=off → slider is a free time coordinate in [-200, 2000]
function updateLoopMode() {
  const isLoop = els.loop.checked;
  els.loopControls.style.display = isLoop ? "" : "none";
  if (isLoop) {
    els.t.min = "0";
    els.t.max = "1";
    els.t.step = "0.001";
    els.tLabelName.textContent = "Loop progress";
    if (parseFloat(els.t.value) > 1 || parseFloat(els.t.value) < 0) els.t.value = "0";
  } else {
    els.t.min = "-200";
    els.t.max = "2000";
    els.t.step = "0.01";
    els.tLabelName.textContent = "t";
  }
  els.tDisplay.textContent = parseFloat(els.t.value).toFixed(2);
}

function activeGradientStops() {
  const mode = els.colorMode.value;
  const name = mode === "posterize" ? els.posterGradient.value : els.gradientPreset.value;
  if (name === "custom") return state.customStops;
  return GRADIENTS[name] || GRADIENTS.viridis;
}

function updateGradientPreview() {
  const stops = activeGradientStops();
  const css = stops
    .map(s => `rgb(${s.color.join(",")}) ${(s.pos * 100).toFixed(1)}%`)
    .join(", ");
  els.gradientPreview.style.background = `linear-gradient(to right, ${css})`;
  // Show the custom-stops editor only when the active gradient mode is custom.
  const mode = els.colorMode.value;
  const name = mode === "posterize" ? els.posterGradient.value : els.gradientPreset.value;
  els.customStopsWrap.hidden = !((mode === "gradient" || mode === "posterize") && name === "custom");
}

// ---- Custom gradient editor ----
// state.customStops is the single source of truth. The DOM is rebuilt from
// it on every change (cheap — at most ~10 stops) so we never have to keep
// the editor's row order in sync with the array by hand.
function rgbToHex(rgb) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}
// Liberal hex parse for typed/pasted input: optional "#", 3- or 6-digit.
// Returns [r,g,b] or null. (The native color picker always yields #rrggbb.)
function parseHex(str) {
  let s = String(str).trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[\da-f]{6}$/i.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function hexToRgb(hex) { return parseHex(hex) || [0, 0, 0]; }
// Scan free text for hex colour tokens (palette paste); ignores non-hex.
function parseHexList(str) {
  const out = [];
  const re = /#?([\da-f]{6}|[\da-f]{3})\b/gi;
  let m;
  while ((m = re.exec(String(str))) !== null) {
    const rgb = parseHex(m[1]);
    if (rgb) out.push(rgb);
  }
  return out;
}
function renderCustomStops() {
  const list = els.customStopsList;
  list.textContent = "";
  // Sort by position so the editor reads left-to-right and the gradient
  // lookup also gets a monotonically ordered list.
  state.customStops.sort((a, b) => a.pos - b.pos);
  for (let i = 0; i < state.customStops.length; i++) {
    const stop = state.customStops[i];
    const row = document.createElement("div");
    row.className = "custom-stop";

    const pos = document.createElement("input");
    pos.type = "range"; pos.min = "0"; pos.max = "1"; pos.step = "0.01";
    pos.value = String(stop.pos);
    pos.className = "stop-pos";
    pos.setAttribute("aria-label", "Stop " + (i + 1) + " position");

    const val = document.createElement("output");
    val.className = "stop-val";
    val.textContent = formatRangeVal(stop.pos);

    pos.addEventListener("input", () => {
      stop.pos = parseFloat(pos.value);
      val.textContent = formatRangeVal(pos.value);
      updateGradientPreview();
      schedulePreview();
    });
    pos.addEventListener("change", () => {
      // On release: re-sort and rebuild so the row reorders if positions crossed.
      renderCustomStops();
    });

    const color = document.createElement("input");
    color.type = "color";
    color.value = rgbToHex(stop.color);
    color.className = "stop-color";
    color.setAttribute("aria-label", "Stop " + (i + 1) + " color");

    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "stop-hex";
    hex.value = rgbToHex(stop.color);
    hex.spellcheck = false;
    hex.setAttribute("maxlength", "7");
    hex.setAttribute("aria-label", "Stop " + (i + 1) + " hex value");

    color.addEventListener("input", () => {
      stop.color = hexToRgb(color.value);
      hex.value = rgbToHex(stop.color);
      updateGradientPreview();
      schedulePreview();
    });
    hex.addEventListener("input", () => {
      const rgb = parseHex(hex.value);
      if (!rgb) return;  // ignore while invalid; blur normalises it back
      stop.color = rgb;
      color.value = rgbToHex(rgb);
      updateGradientPreview();
      schedulePreview();
    });
    hex.addEventListener("blur", () => { hex.value = rgbToHex(stop.color); });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "stop-remove";
    remove.setAttribute("aria-label", "Remove stop");
    remove.title = "Remove stop";
    remove.textContent = "×";
    remove.disabled = state.customStops.length <= 2;
    remove.addEventListener("click", () => {
      if (state.customStops.length <= 2) return;
      state.customStops.splice(i, 1);
      renderCustomStops();
      updateGradientPreview();
      schedulePreview();
    });

    row.appendChild(pos);
    row.appendChild(val);
    row.appendChild(color);
    row.appendChild(hex);
    row.appendChild(remove);
    list.appendChild(row);
  }
}
function addCustomStop() {
  // Insert at the midpoint of the largest gap so the new stop appears
  // somewhere visible by default. Color = linear interpolation between
  // the neighbouring stops.
  const s = state.customStops.slice().sort((a, b) => a.pos - b.pos);
  let bestGap = 0, leftIdx = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const gap = s[i + 1].pos - s[i].pos;
    if (gap > bestGap) { bestGap = gap; leftIdx = i; }
  }
  const a = s[leftIdx], b = s[leftIdx + 1];
  const pos = (a.pos + b.pos) / 2;
  const color = [
    Math.round((a.color[0] + b.color[0]) / 2),
    Math.round((a.color[1] + b.color[1]) / 2),
    Math.round((a.color[2] + b.color[2]) / 2),
  ];
  state.customStops.push({ pos, color });
  renderCustomStops();
  updateGradientPreview();
  schedulePreview();
}

// Build/replace the custom stops from a pasted list of hex colours, spread
// evenly across [0,1]. The paste box only shows when custom is already the
// active gradient (gradient or posterize), so no mode switch is needed.
const MAX_PALETTE_STOPS = 16;
function applyPalette() {
  const all = parseHexList(els.paletteInput.value);
  if (all.length < 2) {
    setStatus("Paste at least 2 hex colours (e.g. #1ea84a, #4ac8d8).", true);
    return;
  }
  const colors = all.slice(0, MAX_PALETTE_STOPS);
  state.customStops = colors.map((color, i) => ({ pos: i / (colors.length - 1), color }));
  renderCustomStops();
  updateGradientPreview();
  schedulePreview();
  setStatus(all.length > MAX_PALETTE_STOPS
    ? `Applied the first ${MAX_PALETTE_STOPS} of ${all.length} pasted colours.`
    : `Applied a ${colors.length}-colour palette.`);
}

// Always-visible entry point to the custom hex palette: jump straight to the
// gradient editor in custom mode from any colour mode (it is otherwise two
// dropdowns deep). UI sugar over the existing controls — no state of its own.
function goToCustomPalette() {
  els.colorMode.value = "gradient";
  updateColorSections();
  els.gradientPreset.value = "custom";
  updateGradientPreview();
  schedulePreview();
  els.customStopsWrap.scrollIntoView({ block: "nearest" });
}

// ============= SLIDER READOUTS =============
// Every sidebar range gets a live numeric readout (the transport t slider
// already has one). For a tool built on shareable parameter sets, a slider
// with no visible value is guesswork. Built once over the static markup; the
// custom-gradient stop sliders carry their own readout (see renderCustomStops).
const rangeReadouts = [];
function attachRangeReadouts() {
  const ranges = document.querySelectorAll('.sidebar input[type="range"]');
  for (const input of ranges) {
    if (input.classList.contains("stop-pos")) continue;  // per-stop readout instead
    const label = input.closest("label");
    if (!label) continue;
    // A plain <span>, not <output>: <output> is a labelable element, so as the
    // label's first labelable descendant it would steal the slider's implicit
    // association (accessible name + click-to-focus). The readout is display-only.
    const out = document.createElement("span");
    out.className = "range-val";
    // Lift the label caption next to the value in a header row, slider below.
    const head = document.createElement("span");
    head.className = "range-head";
    while (label.firstChild && label.firstChild !== input) head.appendChild(label.firstChild);
    head.appendChild(out);
    label.insertBefore(head, input);
    const sync = () => { out.textContent = formatRangeVal(input.value); };
    input.addEventListener("input", sync);
    sync();
    rangeReadouts.push(sync);
  }
}
// Preset / JSON load set values programmatically (no `input` event), so the
// readouts are refreshed explicitly from applyParamsToUi.
function refreshRangeReadouts() { for (const sync of rangeReadouts) sync(); }

// ============= ENGINE =============
// The worker lifecycle, RAF loop, and FPS smoothing live in PerlinEngine
// (perlin-engine.js, loaded before this script). The studio wires three
// callbacks: onTick drives the time slider at display rate, onFrame drives
// the FPS readout, and transformFrame applies the image mask before paint.
const engine = new PerlinEngine(els.canvas, {
  onTick: (position) => setTValue(position),
  onFrame: ({ fps, isMain }) => {
    if (!state.firstFrameRendered) {
      state.firstFrameRendered = true;
      els.canvasLoading.hidden = true;
    }
    // Worker couldn't start → surface the main-thread fallback persistently,
    // not just transiently in the FPS readout.
    if (isMain && els.engineMode.hidden) els.engineMode.hidden = false;
    if (engine.playing) {
      els.fpsCounter.textContent = `${fps.toFixed(1)} fps`;
    }
  },
  transformFrame: (imgData) => applyMaskToImageData(imgData),
});

// ============= LIVE PREVIEW + ANIMATION =============
function getTValue() {
  return parseFloat(els.t.value) || 0;
}
function setTValue(v) {
  els.t.value = v;
  els.tDisplay.textContent = v.toFixed(2);
}

// After a recording the live canvas is hidden behind the <video> preview.
// Any fresh render (param edit, preset, reset) or return to playback must
// retire that stale preview and bring the live canvas back — otherwise the
// only escape is a page reload.
function showLiveCanvas() {
  els.canvas.classList.remove("hidden");
  if (els.animPreview.classList.contains("ready")) {
    els.animPreview.classList.remove("ready");
    els.animPreview.pause();
  }
}

// Reflect the real transport state in the canvas corner tag.
function setFrameState(s) {
  const labels = { live: "LIVE", paused: "PAUSED", rec: "REC" };
  els.tagVal.textContent = labels[s] || "PAUSED";
  els.frameTag.classList.remove("is-live", "is-paused", "is-rec");
  els.frameTag.classList.add("is-" + s);
}

function renderOnce() {
  showLiveCanvas();
  engine.setParams(gatherParams());
  engine.seek(getTValue());
  engine.renderOnce();
}

let livePreviewTimer = 0;
function schedulePreview() {
  if (engine.playing) {
    // Live edits during playback: push the new params so the running loop
    // picks them up (the engine caches params between ticks; the old rafTick
    // re-read gatherParams every frame).
    engine.setParams(gatherParams());
    return;
  }
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(renderOnce, 20);
}

function play() {
  if (engine.playing) return;
  showLiveCanvas();
  engine.setParams(gatherParams());
  engine.seek(getTValue());
  engine.play();
  els.btnPlay.textContent = "⏸";
  els.btnPlay.setAttribute("aria-label", "Pause");
  els.btnPlay.classList.add("is-playing");
  setFrameState("live");
}
function pause() {
  if (!engine.playing) return;
  engine.pause();
  els.btnPlay.textContent = "▶";
  els.btnPlay.setAttribute("aria-label", "Play");
  els.btnPlay.classList.remove("is-playing");
  els.fpsCounter.textContent = "";
  setFrameState("paused");
}
function togglePlay() { engine.playing ? pause() : play(); }

// ============= PRESETS =============
function applyPreset(name) {
  const preset = BUILTIN_PRESETS[name];
  if (!preset) return;
  applyParamsToUi(preset);
  setTValue(0);
  renderOnce();
  setStatus(`Preset "${name}" loaded.`);
}

function savePreset() {
  const params = gatherParams();
  // Strip the resolved gradient stops list for named presets — the name
  // is enough to reconstruct them. For `custom` the stops ARE the user's
  // data, so they must travel with the preset.
  if (params.gradient && params.gradientName !== "custom") delete params.gradient;
  params.t = getTValue();
  const json = JSON.stringify(params, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.download = `perlin-preset-${Date.now()}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setStatus("Preset saved.");
}

function loadPresetFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      applyParamsToUi(data);
      if (data.t != null) setTValue(data.t);
      renderOnce();
      setStatus(`Preset loaded: ${file.name}`);
    } catch (err) {
      setStatus(`Preset error: ${err.message}`, true);
    }
  };
  reader.readAsText(file);
}

// ============= EXPORT =============
function exportPng() {
  if (!els.canvas.width) {
    setStatus("Render an image first.", true);
    return;
  }
  const a = document.createElement("a");
  a.download = `perlin-${Date.now()}.png`;
  a.href = els.canvas.toDataURL("image/png");
  a.click();
  setStatus(`PNG saved — ${els.canvas.width}×${els.canvas.height}.`);
}

// Ordered MIME candidates for the canvas recorder, MP4/H.264 first. Why MP4
// leads (it used to be WebM-only, which is the bug this fixes):
//   - Safari/iOS recorded *only* MP4/H.264 before 18.4, so a WebM-only list made
//     recording impossible there. MP4/H.264 also plays everywhere (Apple
//     devices, QuickTime, editors) and remuxes cheaply — no re-encode — into the
//     H.264 .mov an iOS Live Photo needs.
//   - WebM stays as the required fallback: the only format Firefox can record,
//     and the fallback on a Chrome build whose OS lacks an H.264 encoder.
// Bare "video/mp4" (no codec pin) lets each browser pick an H.264 level that
// fits the canvas (up to 1024²); pinning e.g. avc1.42E01E (Baseline L3.0) would
// cap below that. Video-only strings — the canvas stream carries no audio.
const RECORDER_MIME_CANDIDATES = [
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

// Every candidate the browser accepts, in priority order. isTypeSupported() can
// false-positive, so setupRecorder() still falls through if construction fails.
function supportedRecorderMimes() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return [];
  return RECORDER_MIME_CANDIDATES.filter((m) => MediaRecorder.isTypeSupported(m));
}

// File extension / blob type follow the container that was actually recorded.
function extForMime(mime) {
  return /mp4/i.test(mime || "") ? "mp4" : "webm";
}

/**
 * Builds the parameters for a single recording frame.
 * Loop mode: `progress = i / totalFrames` in `[0, 1)` — frame `totalFrames`
 * would have progress=1 (== progress=0) and is therefore not rendered.
 * Linear: `t = i / fps` (consistent with live: 1 t unit per second).
 *
 * @param {Object} base         Snapshot from `gatherParams()` at recording start
 * @param {number} startSlider  t / progress value at recording start
 * @param {number} frameIndex   0-based frame index
 * @param {number} totalFrames
 * @param {number} fps
 * @returns {Object} Frame-specific parameters
 */
function paramsForRecordingFrame(base, startSlider, frameIndex, totalFrames, fps) {
  const params = { ...base };
  if (params.loop) {
    params.loopProgress = (startSlider + frameIndex / totalFrames) % 1;
    params.t = 0;
  } else {
    params.t = startSlider + frameIndex / fps;
    params.loopProgress = 0;
  }
  return params;
}

/**
 * Initialises a `MediaRecorder` on the output canvas. Prefers
 * `captureStream(0)` + `track.requestFrame()` (exact frame control);
 * falls back to `captureStream(fps)` with browser-driven timing. Picks the
 * first supported MIME candidate that actually constructs and reports back the
 * real container so callers can name the file correctly.
 *
 * @param {number} fps
 * @returns {{ recorder: MediaRecorder, mime: string, ext: string, track: MediaStreamTrack|null, canRequestFrame: boolean, stopped: Promise<void> }}
 */
function setupRecorder(fps) {
  const stream = els.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const canRequestFrame = !!(track && typeof track.requestFrame === "function");
  const finalStream = canRequestFrame ? stream : els.canvas.captureStream(fps);

  // Walk the supported candidates until one constructs — isTypeSupported() may
  // report a type the platform then refuses to instantiate (a known quirk).
  let recorder = null, requestedMime = "", lastErr = null;
  for (const m of supportedRecorderMimes()) {
    try { recorder = new MediaRecorder(finalStream, { mimeType: m }); requestedMime = m; break; }
    catch (e) { lastErr = e; }
  }
  if (!recorder) throw lastErr || new Error("No supported video recorder MIME type.");

  // The real container can be more specific than what we asked for (or empty
  // pre-start on some engines); trust the recorder, then the requested string.
  const mime = recorder.mimeType || requestedMime;
  state.recordedChunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) state.recordedChunks.push(e.data);
  };
  const stopped = new Promise(res => recorder.onstop = res);
  return { recorder, mime, ext: extForMime(mime), track, canRequestFrame, stopped };
}

/**
 * Records the animation to video (MP4/H.264 where supported, else WebM — see
 * RECORDER_MIME_CANDIDATES). Pauses the live animation, deterministically
 * renders one frame after the other synchronously in the worker, returns
 * the blob at the end, and displays it as a `<video>` in the output.
 */
async function recordWebm() {
  if (state.recording) return;
  if (!window.MediaRecorder || supportedRecorderMimes().length === 0) {
    setStatus("Your browser can't record video here (no supported codec).", true);
    return;
  }

  const wasPlaying = engine.playing;
  if (wasPlaying) pause();

  const totalFrames = clampInt(els.frames.value, 1, 600, 120);
  const fps = clampInt(els.fps.value, 1, 60, 30);
  const startSlider = getTValue();
  const baseParams = gatherParams();

  const { recorder, mime, ext, track, canRequestFrame, stopped } = setupRecorder(fps);
  state.recorder = recorder;
  recorder.start();
  state.recording = true;
  state.recordingCancel = false;
  // Repurpose the button as a Stop control for the duration of the capture,
  // and retire any prior download until this clip finishes.
  els.btnWebm.textContent = "Stop recording";
  els.btnWebmDownload.hidden = true;
  els.btnWebmDownload.disabled = true;
  setProgress(0);
  setFrameState("rec");

  // The frame delay ensures `captureStream` sees the canvas state; without a
  // pause some browsers capture before the repaint.
  const frameDelayMs = 1000 / fps;
  let lastAnnounced = -1;

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (state.recordingCancel) break;
      const params = paramsForRecordingFrame(baseParams, startSlider, i, totalFrames, fps);
      await engine.renderFrameAndWait(params);
      if (canRequestFrame) track.requestFrame();
      const pct = Math.round(((i + 1) / totalFrames) * 100);
      setProgress(pct);
      // Throttle the live-region status to ~10% steps so assistive tech isn't
      // flooded with a per-frame announcement; the bar still moves every frame.
      const milestone = pct - (pct % 10);
      if (milestone !== lastAnnounced || i + 1 === totalFrames) {
        lastAnnounced = milestone;
        setStatus(`Recording: ${pct}% — frame ${i + 1}/${totalFrames}${params.loop ? " (loop)" : ""}`);
      }
      await new Promise(r => setTimeout(r, frameDelayMs));
    }
    // Tail frame so the stream definitely captures the last image.
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
    if (wasPlaying) play(); else setFrameState("paused");
    return;
  }
  state.recordedBlob = blob;
  state.recordedExt = ext;
  els.btnWebmDownload.textContent = "Download " + (ext === "mp4" ? "MP4" : "WebM");
  els.btnWebmDownload.hidden = false;
  els.btnWebmDownload.disabled = false;
  const sizeKb = (blob.size / 1024).toFixed(1);
  // If the animation was running, resume live playback (the clip is available
  // via Download). Otherwise show it inline as a <video> preview. The two are
  // mutually exclusive: play() -> showLiveCanvas() retires the preview, so they
  // must never both run on the same path.
  if (wasPlaying) {
    play();
    setStatus(cancelled
      ? `Recording stopped — partial clip, ${sizeKb} KB (Download).`
      : `Animation done — ${totalFrames} frames @ ${fps} fps, ${sizeKb} KB (Download).`);
  } else {
    els.animPreview.src = URL.createObjectURL(blob);
    els.animPreview.classList.add("ready");
    els.canvas.classList.add("hidden");
    setFrameState("paused");
    setStatus(cancelled
      ? `Recording stopped — partial clip, ${sizeKb} KB.`
      : `Animation done — ${totalFrames} frames @ ${fps} fps, ${sizeKb} KB.`);
  }
}

function downloadWebm() {
  if (!state.recordedBlob) return;
  const a = document.createElement("a");
  a.download = `perlin-animation-${Date.now()}.${state.recordedExt || extForMime(state.recordedBlob.type)}`;
  a.href = URL.createObjectURL(state.recordedBlob);
  a.click();
}

// ============= EVENTS =============
const PARAM_INPUTS = [
  "w", "h", "tileX", "tileY", "sx", "sy", "st", "base", "oct", "pers", "lac",
  "warpStrength", "warpScale",
  "layer2On", "layer2Sx", "layer2Sy", "layer2Oct", "layer2Base", "layer2Mix",
  "loopDuration", "loopRadius",
  "rs", "gs", "bs", "ri", "gi", "bi", "rgbMulti",
  "hueShift", "hueRange", "sat", "val",
  "flowHueShift", "flowSat", "flowGain", "flowFloor", "flowEps",
  "posterSteps",
];

// Numeric fields whose values gatherParams() silently clamps. On commit
// (change), snap the visible value into range so the field can never disagree
// with what the engine renders or what a saved preset records — a typed value
// or spinner overshoot would otherwise show e.g. 9999 while 1024 is rendered.
// Mirrors the gatherParams clamps; runs on `change`, not `input`, so it never
// fights mid-typing. Integer seeds (base, layer2Base) have no range → omitted.
const CLAMPED_FIELDS = [
  ["w", 4, 1024, true], ["h", 4, 1024, true],
  ["tileX", 0, 64, true], ["tileY", 0, 64, true],
  ["sx", 0.0001, 10, false], ["sy", 0.0001, 10, false], ["st", 0, 10, false],
  ["oct", 1, 10, true], ["pers", 0, 2, false], ["lac", 1, 8, false],
  ["layer2Sx", 0.0001, 10, false], ["layer2Sy", 0.0001, 10, false],
  ["layer2Oct", 1, 10, true], ["loopDuration", 0.5, 60, false],
  ["loopRadius", 0, 4, false], ["posterSteps", 2, 16, true],
  ["fps", 1, 60, true], ["frames", 1, 600, true],
];
function wireClampedFields() {
  for (const [key, lo, hi, isInt] of CLAMPED_FIELDS) {
    const el = els[key];
    if (!el) continue;
    el.addEventListener("change", () => {
      const n = (isInt ? clampInt : clampFloat)(el.value, lo, hi, null);
      if (n != null) el.value = n;  // empty/invalid → leave for the engine fallback
    });
  }
}

function wireEvents() {
  for (const key of PARAM_INPUTS) {
    els[key].addEventListener("input", schedulePreview);
  }
  wireClampedFields();
  els.colorMode.addEventListener("change", () => {
    updateColorSections();
    updateGradientPreview();
    schedulePreview();
  });
  els.gradientPreset.addEventListener("change", () => {
    updateGradientPreview();
    schedulePreview();
  });
  els.layer2Blend.addEventListener("change", schedulePreview);
  els.layer2On.addEventListener("change", updateLayer2Mode);
  els.warpStrength.addEventListener("input", updateWarpMode);
  els.posterGradient.addEventListener("change", () => {
    updateGradientPreview();
    schedulePreview();
  });
  els.btnAddStop.addEventListener("click", addCustomStop);
  els.btnApplyPalette.addEventListener("click", applyPalette);
  els.btnCustomPalette.addEventListener("click", goToCustomPalette);

  els.t.addEventListener("input", () => {
    els.tDisplay.textContent = parseFloat(els.t.value).toFixed(2);
    schedulePreview();
  });

  els.loop.addEventListener("change", () => {
    updateLoopMode();
    // On a mode change, reset the slider sensibly and re-render. renderOnce
    // pushes the new loop flag and seeks to 0, which re-anchors the engine if
    // it's currently playing.
    setTValue(0);
    renderOnce();
  });

  els.btnPlay.addEventListener("click", togglePlay);
  els.btnResetT.addEventListener("click", () => { setTValue(0); renderOnce(); });

  // Space = play/pause (except when typing in an input)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      togglePlay();
    }
  });

  els.btnPng.addEventListener("click", exportPng);
  els.btnWebm.addEventListener("click", () => {
    if (state.recording) { state.recordingCancel = true; return; }
    recordWebm().catch((err) => {
      console.error(err);
      setStatus(`Recording error: ${err.message}`, true);
      state.recording = false;
      els.btnWebm.textContent = "Record animation";
      setProgress(null);
      setFrameState(engine.playing ? "live" : "paused");
    });
  });
  els.btnWebmDownload.addEventListener("click", downloadWebm);

  els.btnPresetSave.addEventListener("click", savePreset);
  els.btnPresetLoad.addEventListener("click", () => els.presetFile.click());
  els.presetFile.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadPresetFromFile(f);
  });

  // Mask controls
  els.btnMaskLoad.addEventListener("click", () => els.maskFile.click());
  els.maskFile.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadMaskFile(f);
    // Reset so the same filename can be re-loaded.
    e.target.value = "";
  });
  els.btnMaskClear.addEventListener("click", clearMask);
  els.maskApply.addEventListener("change", () => {
    state.maskApplied = els.maskApply.checked;
    updateWebmMaskHint();
    renderOnce();
  });
  els.maskInvert.addEventListener("change", () => {
    state.maskInvert = els.maskInvert.checked;
    renderOnce();
  });

  for (const chip of els.chips) {
    chip.addEventListener("click", () => applyPreset(chip.dataset.preset));
  }
}

// ============= THEME TOGGLE =============
// Default behavior follows the OS via `prefers-color-scheme`. Clicking
// the toggle sets an explicit override on <html data-theme> and persists
// it to localStorage. CSS handles both icon and palette swap; this
// module manages the attribute, the persistence, the aria-label, and
// the PWA / address-bar theme-color meta tag (the initial paint of
// which is handled by the inline <head> script for FOUC-free start).
const THEME_KEY = "perlin-studio:theme";
const THEME_BG = { dark: "#060709", light: "#f3f0e6" };
function effectiveTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function syncThemeChrome(btn) {
  const eff = effectiveTheme();
  const next = eff === "dark" ? "light" : "dark";
  btn.setAttribute("aria-label", "Switch to " + next + " theme");
  btn.setAttribute("title",      "Switch to " + next + " theme");
  const meta = $("meta-theme-color");
  if (meta) meta.setAttribute("content", THEME_BG[eff]);
}
function initThemeToggle() {
  const btn = $("theme-toggle");
  if (!btn) return;
  syncThemeChrome(btn);
  btn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    syncThemeChrome(btn);
  });
  // Keep the chrome correct when the OS theme flips and no override is set.
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) syncThemeChrome(btn);
  });
}

// ============= INIT =============
(function init() {
  updateColorSections();
  renderCustomStops();
  updateGradientPreview();
  updateLoopMode();
  attachRangeReadouts();
  updateLayer2Mode();
  updateWarpMode();
  wireEvents();
  initThemeToggle();
  setFrameState("paused");
  // Apply and render the first preset; the loading overlay clears on the first
  // painted frame (see onFrame). Status is set deterministically here so it
  // doesn't differ between worker and main-thread modes.
  applyPreset("default");
  setStatus("Ready. Press ▶ or Space to animate.");
})();
