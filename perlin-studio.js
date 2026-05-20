/**
 * perlin-studio.js — Main-Thread-Controller des Perlin Studios.
 *
 * Bindet UI, Worker, RAF-Loop, Preset-System und WebM-Recorder zusammen.
 * Reines Vanilla-JS, keine Abhängigkeiten außer `perlin.js`.
 *
 * Architektur für fließende Animation:
 *
 *     Main-Thread:        Worker:
 *       ┌─────────┐         ┌──────────┐
 *       │ RAF-    │ params  │ Perlin   │
 *       │ Loop    │────────▶│ + Color  │
 *       │         │         │          │
 *       │ putImg  │◀────────│ ImageData│   (Transferable, zero-copy)
 *       └─────────┘         └──────────┘
 *
 * Nur ein Frame ist gleichzeitig im Worker — kein Stau. Wenn die Berechnung
 * langsamer als die Display-Refresh-Rate ist, wird einfach das fertige Frame
 * gezeichnet, sobald es kommt. Wall-Clock-Zeit treibt die Animation, nicht
 * der Frame-Index → konsistente Geschwindigkeit unabhängig von der Last.
 *
 * Datenfluss:
 *   1. UI-Input/Slider/Preset → `gatherParams()` baut Plain-Object
 *   2. `requestFrame(params)` → `worker.postMessage({id, params})`
 *   3. Worker rechnet `fbm3`/`fbm4` + `colorize`, postet `ArrayBuffer` zurück
 *   4. `onWorkerMessage` baut `ImageData` und macht `putImageData` auf das Canvas
 *
 * Für WebM-Aufnahme wird `renderFrameAndWait` (synchron) genutzt, damit jedes
 * Frame im `MediaRecorder`-Stream landet — die normale Skip-Logik würde
 * Frames droppen.
 *
 * @license MIT
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
// Alle Presets nutzen Loop default-an mit niedrigem scaleT für sanftes Wabern.
// Loop-Radius = 1 gibt einen voll umrundeten Kreis im Noise-Space; scaleT
// skaliert diesen, sodass der Loop in einer Cell-Größe stattfindet.
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
  latestJobId: 0,     // höchste angeforderte Job-ID; ältere Antworten werden ignoriert
  currentImage: null, // letzte ImageData zum erneuten Zeichnen
  currentImageMeta: { w: 0, h: 0 },

  playing: false,
  rafHandle: 0,
  lastFrameTime: 0,
  fpsEMA: 0,          // exponentielles Glättungsmittel für FPS-Anzeige
  framesRendered: 0,

  recording: false,
  recordedChunks: [],
  recordedBlob: null,
  recorder: null,

  currentParams: null,
  pendingResolves: [],  // [{id, resolve}] — Promises die auf ein bestimmtes Frame warten
};

// ============= DOM =============
const $ = (id) => document.getElementById(id);
const els = {
  // Resolution / Noise
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
/** Parse + Clamp eines Inputs zu Integer; bei NaN/leer → Fallback. */
function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
/** Parse + Clamp eines Inputs zu Float; bei NaN/leer → Fallback. */
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
 * Liest den aktuellen UI-Zustand und baut ein Plain-Object, das sowohl an
 * `generatePerlinImage` (synchron) als auch via `postMessage` an den Worker
 * geht. Alle Felder werden über `clampInt`/`clampFloat` validiert und mit
 * Default-Fallbacks versehen — der Worker braucht keine weitere Validierung.
 *
 * @returns {Object} Studio-Parameter (s. `perlin.js` Modul-Header)
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
 * Umkehr-Operation zu `gatherParams`: schreibt einen Parameter-Snapshot
 * zurück in die UI-Inputs. Wird von Builtin-Presets und JSON-Import genutzt.
 * Felder ohne Wert im Snapshot bleiben unverändert.
 *
 * @param {Object} p  Parameter-Snapshot (kann unvollständig sein)
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

// Loop-Mode wechselt das Verhalten des t-Sliders:
// Loop=an  → Slider ist Loop-Progress [0, 1)
// Loop=aus → Slider ist freie Zeitkoordinate [-200, 2000]
function updateLoopMode() {
  const isLoop = els.loop.checked;
  els.loopControls.style.display = isLoop ? "" : "none";
  if (isLoop) {
    els.t.min = "0";
    els.t.max = "1";
    els.t.step = "0.001";
    els.tLabelName.textContent = "Loop-Fortschritt";
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

// ============= WORKER (mit Main-Thread-Fallback) =============
function initWorker() {
  if (!window.MTPerlin || !window.MTPerlin.WORKER_SOURCE) {
    setStatus("Perlin-Modul nicht geladen.", true);
    return;
  }
  try {
    const blob = new Blob([window.MTPerlin.WORKER_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    state.worker = new Worker(url);
    state.worker.onmessage = onWorkerMessage;
    state.worker.onerror = (e) => {
      console.warn("Worker-Fehler — wechsle auf Main-Thread-Rendering.", e);
      state.worker = null;
    };
  } catch (e) {
    console.warn("Worker konnte nicht gestartet werden — Main-Thread-Fallback.", e);
    state.worker = null;
  }
}

// Synchroner Fallback: rendert direkt in den Output-Canvas.
function renderInMain(params) {
  const ctx = els.canvas.getContext("2d");
  if (els.canvas.width !== params.width || els.canvas.height !== params.height) {
    els.canvas.width = params.width;
    els.canvas.height = params.height;
  }
  window.MTPerlin.generatePerlinImage(params, ctx);
  // FPS-EMA für die Anzeige
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

  // Veraltete Jobs (z. B. nach Parameter-Wechsel) ignorieren.
  if (id < state.latestJobId) {
    // Buffer kann verworfen werden — wir wollen nur das neueste Frame.
    return;
  }

  const data = new Uint8ClampedArray(buffer);
  const imgData = new ImageData(data, width, height);
  state.currentImage = imgData;
  state.currentImageMeta = { w: width, h: height };

  // Canvas-Größe anpassen, falls geändert.
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  els.canvas.getContext("2d").putImageData(imgData, 0, 0);

  // FPS messen (Wall-Clock-Zeit zwischen abgeschlossenen Frames).
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

  // Auf dieses Frame wartende Promises auflösen.
  for (let i = state.pendingResolves.length - 1; i >= 0; i--) {
    if (state.pendingResolves[i].id === id) {
      state.pendingResolves[i].resolve();
      state.pendingResolves.splice(i, 1);
    }
  }
}

/**
 * Stößt einen neuen Frame-Render an. Skippt, wenn der Worker noch beschäftigt
 * ist (kein Frame-Stau, keine Drift). Ohne Worker rendert es synchron im
 * Main-Thread (Fallback z. B. unter Safari/`file://`).
 *
 * @param {Object} params  Aus `gatherParams()`
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

// Slider-Wert je nach Mode in params eintragen:
// Loop=an  → loopProgress = slider
// Loop=aus → t = slider
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
  if (state.playing) return; // im Play-Modus rendert die Loop sowieso
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(renderOnce, 20);
}

// Animation: Wall-Clock-Zeit treibt entweder Loop-Progress (Loop=an) oder t (Loop=aus).
let animStartTime = 0;
let animStartSlider = 0;

function rafTick(now) {
  if (!state.playing) return;
  const elapsedSec = (now - animStartTime) / 1000;
  const params = gatherParams();

  if (params.loop) {
    // Loop-Progress läuft in `loopDuration` Sekunden einmal durch [0, 1).
    // Modulo sichert nahtlosen Wraparound nach jedem Loop.
    const progress = ((animStartSlider + elapsedSec / params.loopDuration) % 1 + 1) % 1;
    setTValue(progress);
    params.loopProgress = progress;
    params.t = 0;
  } else {
    // Linear: 1 t-Einheit pro Sekunde. scaleT skaliert im Noise-Space,
    // sodass bei scaleT=0.15 und fps=30 ein Frame ~0.005 weiter geht — sanftes Wabern.
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
  setStatus(`Preset „${name}" geladen.`);
}

function savePreset() {
  const params = gatherParams();
  // Gradient-Stops-Liste nicht in Datei serialisieren — Name reicht.
  if (params.gradient) delete params.gradient;
  params.t = getTValue();
  const json = JSON.stringify(params, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.download = `perlin-preset-${Date.now()}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setStatus("Preset gespeichert.");
}

function loadPresetFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      applyParamsToUi(data);
      if (data.t != null) setTValue(data.t);
      renderOnce();
      setStatus(`Preset geladen: ${file.name}`);
    } catch (err) {
      setStatus(`Preset-Fehler: ${err.message}`, true);
    }
  };
  reader.readAsText(file);
}

// ============= EXPORT =============
function exportPng() {
  if (!els.canvas.width) {
    setStatus("Erst ein Bild rendern.", true);
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
 * Baut die Parameter für ein einzelnes Frame der Aufnahme.
 * Loop-Modus: `progress = i / totalFrames` in `[0, 1)` — Frame `totalFrames`
 * wäre progress=1 und identisch zu progress=0, wird daher nicht gerendert.
 * Linear: `t = i / fps` (konsistent mit Live: 1 t-Einheit pro Sekunde).
 *
 * @param {Object} base         Snapshot aus `gatherParams()` zu Aufnahme-Start
 * @param {number} startSlider  t- bzw. progress-Wert beim Aufnahmestart
 * @param {number} frameIndex   0-basierter Frame-Zähler
 * @param {number} totalFrames
 * @param {number} fps
 * @returns {Object} Frame-spezifische Parameter
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
 * Initialisiert einen `MediaRecorder` auf dem Output-Canvas. Bevorzugt
 * `captureStream(0)` + `track.requestFrame()` (exakte Frame-Kontrolle);
 * fallback auf `captureStream(fps)` mit Browser-internem Timing.
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
 * Nimmt eine WebM-Animation auf. Pausiert die Live-Animation, rendert
 * deterministisch Frame für Frame synchron im Worker, gibt am Ende den Blob
 * zurück und zeigt ihn als `<video>` im Output an.
 */
async function recordWebm() {
  if (state.recording) return;
  const mime = chooseRecorderMime();
  if (!mime) { setStatus("Dein Browser unterstützt keinen WebM-Recorder.", true); return; }

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

  // Frame-Delay sichert ab, dass `captureStream` den Canvas-Stand sieht;
  // ohne Pause können Browser Frames vor dem Repaint capturen.
  const frameDelayMs = 1000 / fps;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const params = paramsForRecordingFrame(baseParams, startSlider, i, totalFrames, fps);
      await renderFrameAndWait(params);
      if (canRequestFrame) track.requestFrame();
      setProgress(Math.round(((i + 1) / totalFrames) * 100));
      setStatus(`Aufnahme: Frame ${i + 1}/${totalFrames}${params.loop ? " (Loop)" : ""}`);
      await new Promise(r => setTimeout(r, frameDelayMs));
    }
    // Tail-Frame, damit der Stream das letzte Bild definitiv aufnimmt.
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
  setStatus(`Animation fertig — ${totalFrames} Frames @ ${fps} fps, ${(blob.size / 1024).toFixed(1)} KB.`);

  if (wasPlaying) play();
}

// Frame synchron warten (für Recording — jedes Frame muss sicher fertig sein).
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
    // Beim Mode-Wechsel den Slider sinnvoll resetten und neu rendern.
    setTValue(0);
    if (state.playing) {
      // Auch die laufende Animation auf den neuen Modus umstellen.
      animStartTime = performance.now();
      animStartSlider = 0;
    }
    renderOnce();
  });

  els.btnPlay.addEventListener("click", togglePlay);
  els.btnResetT.addEventListener("click", () => { setTValue(0); renderOnce(); });

  // Space = Play/Pause (außer in Inputs)
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
      setStatus(`WebM-Fehler: ${err.message}`, true);
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
  // Erstes Preset anwenden + rendern
  applyPreset("default");
  setStatus("Bereit. Drücke ▶ oder Space für Animation.");
})();
