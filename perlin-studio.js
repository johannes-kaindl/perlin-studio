/**
 * perlin-studio.js — main-thread controller of Perlin Studio.
 *
 * Ties the UI, worker, RAF loop, preset system, and WebM recorder together.
 * Pure vanilla JS, no dependencies other than `perlin.js`.
 *
 * Architecture for smooth animation:
 *
 *     Main thread:        Worker:
 *       ┌─────────┐         ┌──────────┐
 *       │ RAF     │ params  │ Perlin   │
 *       │ loop    │────────▶│ + color  │
 *       │         │         │          │
 *       │ putImg  │◀────────│ ImageData│   (transferable, zero-copy)
 *       └─────────┘         └──────────┘
 *
 * Only one frame is in flight in the worker at a time — no queue. If the
 * computation is slower than the display refresh rate, the finished frame
 * is simply drawn whenever it arrives. Wall-clock time drives the
 * animation, not the frame index → consistent speed regardless of load.
 *
 * Data flow:
 *   1. UI input / slider / preset → `gatherParams()` builds a plain object
 *   2. `requestFrame(params)` → `worker.postMessage({id, params})`
 *   3. The worker computes `fbm3`/`fbm4` + `colorize`, posts an `ArrayBuffer` back
 *   4. `onWorkerMessage` builds `ImageData` and calls `putImageData` on the canvas
 *
 * For WebM recording, `renderFrameAndWait` (synchronous) is used so every
 * frame lands in the `MediaRecorder` stream — the normal skip logic would
 * drop frames.
 *
 * @license AGPL-3.0-or-later
 */

// ============= GRADIENTS =============
const GRADIENTS = {
  viridis: [
    { pos: 0.0, color: [68, 1, 84] },
    { pos: 0.25, color: [59, 82, 139] },
    { pos: 0.5, color: [33, 145, 140] },
    { pos: 0.75, color: [94, 201, 98] },
    { pos: 1.0, color: [253, 231, 37] },
  ],
  magma: [
    { pos: 0.0, color: [0, 0, 4] },
    { pos: 0.25, color: [80, 18, 123] },
    { pos: 0.5, color: [183, 55, 121] },
    { pos: 0.75, color: [251, 136, 97] },
    { pos: 1.0, color: [252, 253, 191] },
  ],
  fire: [
    { pos: 0.0, color: [0, 0, 0] },
    { pos: 0.3, color: [136, 0, 0] },
    { pos: 0.6, color: [255, 89, 0] },
    { pos: 0.85, color: [255, 213, 0] },
    { pos: 1.0, color: [255, 255, 240] },
  ],
  ocean: [
    { pos: 0.0, color: [3, 11, 41] },
    { pos: 0.3, color: [5, 56, 107] },
    { pos: 0.6, color: [0, 144, 178] },
    { pos: 0.85, color: [120, 220, 220] },
    { pos: 1.0, color: [240, 248, 255] },
  ],
  forest: [
    { pos: 0.0, color: [25, 35, 20] },
    { pos: 0.3, color: [40, 80, 30] },
    { pos: 0.6, color: [80, 140, 50] },
    { pos: 0.85, color: [180, 200, 110] },
    { pos: 1.0, color: [240, 245, 200] },
  ],
  grayscale: [
    { pos: 0.0, color: [0, 0, 0] },
    { pos: 1.0, color: [255, 255, 255] },
  ],
  sunset: [
    { pos: 0.0, color: [12, 12, 60] },
    { pos: 0.3, color: [110, 30, 100] },
    { pos: 0.6, color: [240, 110, 80] },
    { pos: 0.85, color: [255, 200, 90] },
    { pos: 1.0, color: [255, 245, 200] },
  ],
  ice: [
    { pos: 0.0, color: [10, 20, 50] },
    { pos: 0.4, color: [80, 130, 200] },
    { pos: 0.8, color: [180, 220, 250] },
    { pos: 1.0, color: [255, 255, 255] },
  ],
};

// ============= BUILTIN PRESETS =============
// All presets default to loop=on with a small scaleT for a gentle ripple.
// loopRadius = 1 traces a full circle in noise space; scaleT shrinks it so
// the loop stays within a single cell-sized region.
const LOOP_DEFAULTS = { loop: true, loopDuration: 4, loopRadius: 1.0 };

const BUILTIN_PRESETS = {
  default: {
    width: 256, height: 256,
    scaleX: 0.02, scaleY: 0.02, scaleT: 0.15,
    octaves: 6, persistence: 0.5, lacunarity: 2.0, base: 0,
    colorMode: "rgb",
    rScale: 0, gScale: 1, bScale: 0,
    rInvert: false, gInvert: true, bInvert: true,
    ...LOOP_DEFAULTS,
  },
  lava: {
    width: 384, height: 256,
    scaleX: 0.015, scaleY: 0.015, scaleT: 0.12,
    octaves: 5, persistence: 0.65, lacunarity: 2.2, base: 7,
    colorMode: "gradient", gradientName: "fire",
    ...LOOP_DEFAULTS, loopDuration: 6,
  },
  aurora: {
    width: 384, height: 256,
    scaleX: 0.012, scaleY: 0.03, scaleT: 0.18,
    octaves: 4, persistence: 0.55, lacunarity: 2.4, base: 19,
    colorMode: "hsv", hsvHueShift: 0.45, hsvHueRange: 0.25, hsvSat: 0.9, hsvVal: 1.0,
    ...LOOP_DEFAULTS, loopDuration: 5,
  },
  clouds: {
    width: 384, height: 256,
    scaleX: 0.008, scaleY: 0.008, scaleT: 0.1,
    octaves: 7, persistence: 0.5, lacunarity: 2.0, base: 3,
    colorMode: "gradient", gradientName: "grayscale",
    ...LOOP_DEFAULTS, loopDuration: 8,
  },
  terrain: {
    width: 384, height: 256,
    scaleX: 0.01, scaleY: 0.01, scaleT: 0.08,
    octaves: 6, persistence: 0.55, lacunarity: 2.0, base: 42,
    colorMode: "posterize", posterizeSteps: 6, gradientName: "forest",
    ...LOOP_DEFAULTS, loopDuration: 10,
  },
  circuit: {
    width: 384, height: 256,
    scaleX: 0.03, scaleY: 0.03, scaleT: 0.2,
    octaves: 3, persistence: 0.7, lacunarity: 3.0, base: 11,
    colorMode: "posterize", posterizeSteps: 3, gradientName: "ocean",
    ...LOOP_DEFAULTS, loopDuration: 3,
  },
};

// ============= STATE =============
const state = {
  worker: null,
  workerBusy: false,
  workerJobId: 0,
  latestJobId: 0,     // highest requested job id; older replies are ignored
  currentImage: null, // last ImageData for redrawing
  currentImageMeta: { w: 0, h: 0 },

  playing: false,
  rafHandle: 0,
  lastFrameTime: 0,
  fpsEMA: 0,          // exponentially smoothed mean for the FPS readout
  framesRendered: 0,

  recording: false,
  recordedChunks: [],
  recordedBlob: null,
  recorder: null,

  currentParams: null,
  pendingResolves: [],  // [{id, resolve}] — promises waiting on a specific frame
};

// ============= DOM =============
const $ = (id) => document.getElementById(id);
const els = {
  // Resolution / noise
  w: $("p-w"), h: $("p-h"),
  sx: $("p-sx"), sy: $("p-sy"), st: $("p-st"),
  base: $("p-base"), oct: $("p-oct"), pers: $("p-pers"), lac: $("p-lac"),

  // Loop
  loop: $("p-loop"),
  loopDuration: $("p-loop-duration"),
  loopRadius: $("p-loop-radius"),
  loopControls: $("loop-controls"),

  // Color mode
  colorMode: $("p-color-mode"),
  // rgb
  rs: $("p-rs"), gs: $("p-gs"), bs: $("p-bs"),
  ri: $("p-ri"), gi: $("p-gi"), bi: $("p-bi"),
  // gradient
  gradientPreset: $("p-gradient-preset"),
  gradientPreview: $("p-gradient-preview"),
  // hsv
  hueShift: $("p-hue-shift"), hueRange: $("p-hue-range"),
  sat: $("p-sat"), val: $("p-val"),
  // posterize
  posterSteps: $("p-poster-steps"),
  posterGradient: $("p-poster-gradient"),

  // Presets
  btnPresetSave: $("btn-preset-save"),
  btnPresetLoad: $("btn-preset-load"),
  presetFile: $("preset-file"),
  chips: document.querySelectorAll(".preset-chip"),

  // Export
  btnPng: $("btn-png"),
  btnWebm: $("btn-webm"),
  btnWebmDownload: $("btn-webm-download"),

  // Main output
  canvas: $("canvas-output"),
  animPreview: $("anim-preview"),

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
}
function setProgress(pct) {
  if (pct == null) {
    els.progress.classList.remove("active");
    els.progressBar.style.width = "0%";
  } else {
    els.progress.classList.add("active");
    els.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
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
    scaleX:      clampFloat(els.sx.value, 0.0001, 10, 0.02),
    scaleY:      clampFloat(els.sy.value, 0.0001, 10, 0.02),
    scaleT:      clampFloat(els.st.value, 0, 10, 0.15),
    base:        parseInt(els.base.value, 10) || 0,
    octaves:     clampInt(els.oct.value, 1, 10, 6),
    persistence: clampFloat(els.pers.value, 0, 2, 0.5),
    lacunarity:  clampFloat(els.lac.value, 1, 8, 2.0),
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
  } else if (colorMode === "gradient") {
    const name = els.gradientPreset.value;
    base.gradientName = name;
    base.gradient = GRADIENTS[name] || GRADIENTS.viridis;
  } else if (colorMode === "hsv") {
    base.hsvHueShift = clampFloat(els.hueShift.value, 0, 1, 0);
    base.hsvHueRange = clampFloat(els.hueRange.value, 0, 1, 0.6);
    base.hsvSat = clampFloat(els.sat.value, 0, 1, 0.8);
    base.hsvVal = clampFloat(els.val.value, 0, 1, 1);
  } else if (colorMode === "posterize") {
    base.posterizeSteps = clampInt(els.posterSteps.value, 2, 16, 5);
    const name = els.posterGradient.value;
    base.gradientName = name;
    base.gradient = GRADIENTS[name] || GRADIENTS.viridis;
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
  if (p.scaleX != null) els.sx.value = p.scaleX;
  if (p.scaleY != null) els.sy.value = p.scaleY;
  if (p.scaleT != null) els.st.value = p.scaleT;
  if (p.base != null) els.base.value = p.base;
  if (p.octaves != null) els.oct.value = p.octaves;
  if (p.persistence != null) els.pers.value = p.persistence;
  if (p.lacunarity != null) els.lac.value = p.lacunarity;

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
  if (p.gradientName) {
    els.gradientPreset.value = p.gradientName;
    els.posterGradient.value = p.gradientName;
    updateGradientPreview();
  }
  if (p.hsvHueShift != null) els.hueShift.value = p.hsvHueShift;
  if (p.hsvHueRange != null) els.hueRange.value = p.hsvHueRange;
  if (p.hsvSat != null) els.sat.value = p.hsvSat;
  if (p.hsvVal != null) els.val.value = p.hsvVal;
  if (p.posterizeSteps != null) els.posterSteps.value = p.posterizeSteps;
}

function updateColorSections() {
  const active = els.colorMode.value;
  for (const sec of els.colorSections) {
    const isActive = sec.dataset.for === active;
    sec.hidden = !isActive;
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

function updateGradientPreview() {
  const name = els.colorMode.value === "posterize"
    ? els.posterGradient.value
    : els.gradientPreset.value;
  const stops = GRADIENTS[name] || GRADIENTS.viridis;
  const css = stops
    .map(s => `rgb(${s.color.join(",")}) ${(s.pos * 100).toFixed(1)}%`)
    .join(", ");
  els.gradientPreview.style.background = `linear-gradient(to right, ${css})`;
}

// ============= WORKER (with main-thread fallback) =============
function initWorker() {
  if (!window.MTPerlin || !window.MTPerlin.WORKER_SOURCE) {
    setStatus("Perlin module not loaded.", true);
    return;
  }
  try {
    const blob = new Blob([window.MTPerlin.WORKER_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    state.worker = new Worker(url);
    state.worker.onmessage = onWorkerMessage;
    state.worker.onerror = (e) => {
      console.warn("Worker error — falling back to main-thread rendering.", e);
      state.worker = null;
    };
  } catch (e) {
    console.warn("Worker couldn't start — main-thread fallback.", e);
    state.worker = null;
  }
}

// Synchronous fallback: renders directly into the output canvas.
function renderInMain(params) {
  const ctx = els.canvas.getContext("2d");
  if (els.canvas.width !== params.width || els.canvas.height !== params.height) {
    els.canvas.width = params.width;
    els.canvas.height = params.height;
  }
  window.MTPerlin.generatePerlinImage(params, ctx);
  // FPS EMA for the readout
  const now = performance.now();
  if (state.lastFrameTime > 0) {
    const dt = now - state.lastFrameTime;
    state.fpsEMA = state.fpsEMA ? state.fpsEMA * 0.85 + (1000 / dt) * 0.15 : 1000 / dt;
    if (state.playing) els.fpsCounter.textContent = `${state.fpsEMA.toFixed(1)} fps (main)`;
  }
  state.lastFrameTime = now;
  state.framesRendered++;
}

function onWorkerMessage(e) {
  const { id, width, height, buffer } = e.data;
  state.workerBusy = false;

  // Drop stale jobs (e.g. after a parameter change).
  if (id < state.latestJobId) {
    // Buffer can be discarded — we only want the newest frame.
    return;
  }

  const data = new Uint8ClampedArray(buffer);
  const imgData = new ImageData(data, width, height);
  state.currentImage = imgData;
  state.currentImageMeta = { w: width, h: height };

  // Adjust the canvas size if it changed.
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  els.canvas.getContext("2d").putImageData(imgData, 0, 0);

  // Measure FPS (wall-clock time between completed frames).
  const now = performance.now();
  if (state.lastFrameTime > 0) {
    const dt = now - state.lastFrameTime;
    const instFps = 1000 / dt;
    state.fpsEMA = state.fpsEMA ? state.fpsEMA * 0.85 + instFps * 0.15 : instFps;
    if (state.playing) {
      els.fpsCounter.textContent = `${state.fpsEMA.toFixed(1)} fps`;
    }
  }
  state.lastFrameTime = now;
  state.framesRendered++;

  // Resolve any promises waiting on this frame.
  for (let i = state.pendingResolves.length - 1; i >= 0; i--) {
    if (state.pendingResolves[i].id === id) {
      state.pendingResolves[i].resolve();
      state.pendingResolves.splice(i, 1);
    }
  }
}

/**
 * Kicks off a new frame render. Skips if the worker is still busy (no
 * frame queue, no drift). With no worker available, renders synchronously
 * on the main thread (fallback e.g. for Safari under `file://`).
 *
 * @param {Object} params  From `gatherParams()`
 */
function requestFrame(params) {
  state.currentParams = params;
  if (!state.worker) {
    renderInMain(params);
    return;
  }
  if (state.workerBusy) return;
  state.workerBusy = true;
  state.latestJobId = ++state.workerJobId;
  state.worker.postMessage({ id: state.workerJobId, params });
}

// ============= LIVE PREVIEW + ANIMATION =============
function getTValue() {
  return parseFloat(els.t.value) || 0;
}
function setTValue(v) {
  els.t.value = v;
  els.tDisplay.textContent = v.toFixed(2);
}

// Write the slider value into params depending on the mode:
// loop=on  → loopProgress = slider
// loop=off → t = slider
function applySliderTo(params) {
  const v = getTValue();
  if (params.loop) {
    params.loopProgress = v;
    params.t = 0;
  } else {
    params.t = v;
    params.loopProgress = 0;
  }
}

function renderOnce() {
  const params = gatherParams();
  applySliderTo(params);
  requestFrame(params);
}

let livePreviewTimer = 0;
function schedulePreview() {
  if (state.playing) return; // in play mode the loop renders anyway
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(renderOnce, 20);
}

// Animation: wall-clock time drives either loopProgress (loop=on) or t (loop=off).
let animStartTime = 0;
let animStartSlider = 0;

function rafTick(now) {
  if (!state.playing) return;
  const elapsedSec = (now - animStartTime) / 1000;
  const params = gatherParams();

  if (params.loop) {
    // Loop progress traverses [0, 1) once every `loopDuration` seconds.
    // Modulo ensures a seamless wraparound after each loop.
    const progress = ((animStartSlider + elapsedSec / params.loopDuration) % 1 + 1) % 1;
    setTValue(progress);
    params.loopProgress = progress;
    params.t = 0;
  } else {
    // Linear: 1 t unit per second. scaleT scales it in noise space, so with
    // scaleT=0.15 and fps=30 a frame advances ~0.005 — a soft ripple.
    const tNow = animStartSlider + elapsedSec;
    setTValue(tNow);
    params.t = tNow;
    params.loopProgress = 0;
  }

  requestFrame(params);
  state.rafHandle = requestAnimationFrame(rafTick);
}

function play() {
  if (state.playing) return;
  state.playing = true;
  els.btnPlay.textContent = "⏸";
  els.btnPlay.setAttribute("aria-label", "Pause");
  animStartTime = performance.now();
  animStartSlider = getTValue();
  state.lastFrameTime = 0;
  state.fpsEMA = 0;
  state.rafHandle = requestAnimationFrame(rafTick);
}
function pause() {
  if (!state.playing) return;
  state.playing = false;
  els.btnPlay.textContent = "▶";
  els.btnPlay.setAttribute("aria-label", "Play");
  cancelAnimationFrame(state.rafHandle);
  els.fpsCounter.textContent = "";
}
function togglePlay() { state.playing ? pause() : play(); }

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
  // Don't serialise the gradient stops list — the name is enough.
  if (params.gradient) delete params.gradient;
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
}

function chooseRecorderMime() {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
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
 * falls back to `captureStream(fps)` with browser-driven timing.
 *
 * @param {string} mime
 * @param {number} fps
 * @returns {{ recorder: MediaRecorder, track: MediaStreamTrack|null, canRequestFrame: boolean, stopped: Promise<void> }}
 */
function setupRecorder(mime, fps) {
  const stream = els.canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const canRequestFrame = !!(track && typeof track.requestFrame === "function");
  const finalStream = canRequestFrame ? stream : els.canvas.captureStream(fps);

  const recorder = new MediaRecorder(finalStream, { mimeType: mime });
  state.recordedChunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) state.recordedChunks.push(e.data);
  };
  const stopped = new Promise(res => recorder.onstop = res);
  return { recorder, track, canRequestFrame, stopped };
}

/**
 * Records a WebM animation. Pauses the live animation, deterministically
 * renders one frame after the other synchronously in the worker, returns
 * the blob at the end, and displays it as a `<video>` in the output.
 */
async function recordWebm() {
  if (state.recording) return;
  const mime = chooseRecorderMime();
  if (!mime) { setStatus("Your browser doesn't support a WebM recorder.", true); return; }

  const wasPlaying = state.playing;
  if (wasPlaying) pause();

  const totalFrames = clampInt(els.frames.value, 1, 600, 120);
  const fps = clampInt(els.fps.value, 1, 60, 30);
  const startSlider = getTValue();
  const baseParams = gatherParams();

  const { recorder, track, canRequestFrame, stopped } = setupRecorder(mime, fps);
  state.recorder = recorder;
  recorder.start();
  state.recording = true;
  els.btnWebm.disabled = true;
  setProgress(0);

  // The frame delay ensures `captureStream` sees the canvas state; without a
  // pause some browsers capture before the repaint.
  const frameDelayMs = 1000 / fps;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const params = paramsForRecordingFrame(baseParams, startSlider, i, totalFrames, fps);
      await renderFrameAndWait(params);
      if (canRequestFrame) track.requestFrame();
      setProgress(Math.round(((i + 1) / totalFrames) * 100));
      setStatus(`Recording: frame ${i + 1}/${totalFrames}${params.loop ? " (loop)" : ""}`);
      await new Promise(r => setTimeout(r, frameDelayMs));
    }
    // Tail frame so the stream definitely captures the last image.
    if (canRequestFrame) track.requestFrame();
    await new Promise(r => setTimeout(r, frameDelayMs));
  } finally {
    recorder.stop();
    await stopped;
    state.recording = false;
    els.btnWebm.disabled = false;
    setProgress(null);
  }

  const blob = new Blob(state.recordedChunks, { type: mime });
  state.recordedBlob = blob;
  els.animPreview.src = URL.createObjectURL(blob);
  els.animPreview.classList.add("ready");
  els.canvas.classList.add("hidden");
  els.btnWebmDownload.hidden = false;
  els.btnWebmDownload.disabled = false;
  setStatus(`Animation done — ${totalFrames} frames @ ${fps} fps, ${(blob.size / 1024).toFixed(1)} KB.`);

  if (wasPlaying) play();
}

// Wait for a frame synchronously (for recording — every frame must finish).
function renderFrameAndWait(params) {
  if (!state.worker) {
    renderInMain(params);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const id = ++state.workerJobId;
    state.latestJobId = id;
    state.pendingResolves.push({ id, resolve });
    state.workerBusy = true;
    state.worker.postMessage({ id, params });
  });
}

function downloadWebm() {
  if (!state.recordedBlob) return;
  const a = document.createElement("a");
  a.download = `perlin-animation-${Date.now()}.webm`;
  a.href = URL.createObjectURL(state.recordedBlob);
  a.click();
}

// ============= EVENTS =============
const PARAM_INPUTS = [
  "w", "h", "sx", "sy", "st", "base", "oct", "pers", "lac",
  "loopDuration", "loopRadius",
  "rs", "gs", "bs", "ri", "gi", "bi",
  "hueShift", "hueRange", "sat", "val",
  "posterSteps",
];

function wireEvents() {
  for (const key of PARAM_INPUTS) {
    els[key].addEventListener("input", schedulePreview);
  }
  els.colorMode.addEventListener("change", () => {
    updateColorSections();
    updateGradientPreview();
    schedulePreview();
  });
  els.gradientPreset.addEventListener("change", () => {
    updateGradientPreview();
    schedulePreview();
  });
  els.posterGradient.addEventListener("change", () => {
    updateGradientPreview();
    schedulePreview();
  });

  els.t.addEventListener("input", () => {
    els.tDisplay.textContent = parseFloat(els.t.value).toFixed(2);
    schedulePreview();
  });

  els.loop.addEventListener("change", () => {
    updateLoopMode();
    // On a mode change, reset the slider sensibly and re-render.
    setTValue(0);
    if (state.playing) {
      // Also re-anchor the running animation to the new mode.
      animStartTime = performance.now();
      animStartSlider = 0;
    }
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
    recordWebm().catch((err) => {
      console.error(err);
      setStatus(`WebM error: ${err.message}`, true);
      state.recording = false;
      els.btnWebm.disabled = false;
      setProgress(null);
    });
  });
  els.btnWebmDownload.addEventListener("click", downloadWebm);

  els.btnPresetSave.addEventListener("click", savePreset);
  els.btnPresetLoad.addEventListener("click", () => els.presetFile.click());
  els.presetFile.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadPresetFromFile(f);
  });

  for (const chip of els.chips) {
    chip.addEventListener("click", () => applyPreset(chip.dataset.preset));
  }
}

// ============= INIT =============
(function init() {
  initWorker();
  updateColorSections();
  updateGradientPreview();
  updateLoopMode();
  wireEvents();
  // Apply and render the first preset
  applyPreset("default");
  setStatus("Ready. Press ▶ or Space to animate.");
})();
