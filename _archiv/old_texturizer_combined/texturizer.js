/*
  Minecraft Texturizer & Perlin Studio — Browser-Logik.

  Zwei Modi:
    - Texturizer:  Eingangsbild → Mosaik aus Atlas-Texturen.
    - Perlin Studio: parametrisches 3D-Perlin-Rauschen → Standbild oder WebM-Animation,
                     optional durch den Texturizer geleitet (texturisierte Animation).

  Mosaik-Pipeline (für ein einzelnes Frame):
    1. Atlas in N×N Tiles zerlegen → Palette {canvas, avg, lab}
    2. Quellbild auf (outputWidth × outputHeight) Blöcke downsamplen
    3. Pro Block: Palette-Eintrag mit minimaler Farbdistanz wählen
    4. Tile in (blockSize × blockSize) auf Output-Canvas zeichnen

  Animation:
    canvas.captureStream(fps) + MediaRecorder → WebM-Blob → Download.
*/

const DEFAULT_ATLAS_DATA_URL =
  "data:image/webp;base64,UklGRqgBAABXRUJQVlA4TJsBAAAvn8AnAD/BJgCANHgChyBc9C/kDlsJBZFsJR8t4RCBNvRmKEAGV6WRbDXk5NA4HP3XQhF0kLn5F5ommGy7I8RW2wzvhHsH5MqJYofOJ2ndh3EHYQUiiVCDMiuW4XxEhv0+Vo/zcT7Ox37ff18/4QfUMbW5AI4kSYqknmVmxuP7/yfDMqvUEiL6z7htG0lmA858MntUcAA7cAQfkgv4BTewBjTHA7zBE3yDf3AF9Tl7QLNNwBZsQAMv8AXorOZgCujE6TRoXjq1O6jPGQOadwk+Ae1ByhlQF9rTKzADC0BN/8APoFZlOZIBaJITaCbaq9TlCqhLB6i91qo+pw+0LiNAnbWm7pTa2WtTVuq4E1HcU2uSuNk60wiU5Ug60xDEzeG2itvs9TlxU7q71t26GZ3rczKaal3c56242dz29Tm532fwLV2YjGe1mp2M93XamY4k7rOa9u6wPifjTZu7BweAnsvcJzm3VX2O2zTwhFK5W7xSx92wPRD35Ud7QtP2pfvvQlVOxkRxz0y5u7F6J2MTu99xtDPI2MnlOQ0A";
const DEFAULT_ATLAS_URL = "assets/default-atlas.webp";

// ===================== STATE =====================
const state = {
  mode: "texturize",       // "texturize" | "perlin"
  inputImage: null,
  atlasImage: null,
  palette: null,
  lastOutputCanvas: null,  // letztes statisches Ergebnis (Texturizer oder Perlin-Standbild)
  lastWebmBlob: null,
  perlinPerm: null,        // gecachte Permutation für aktuellen seed
  perlinSeed: null,
  animating: false,
  livePreviewTimer: 0,
};

// ===================== DOM =====================
const $ = (id) => document.getElementById(id);
const els = {
  // Tabs / Panels
  tabs: document.querySelectorAll(".tab"),
  panelTex: $("panel-texturize"),
  panelPerlin: $("panel-perlin"),
  modeSubtitle: $("mode-subtitle"),
  outputTitle: $("output-title"),

  // Texturizer
  dzImage: $("dropzone-image"),
  dzAtlas: $("dropzone-atlas"),
  fileImage: $("file-image"),
  fileAtlas: $("file-atlas"),
  previewImage: $("preview-image"),
  previewAtlas: $("preview-atlas"),
  atlasTiles: $("atlas-tiles"),
  outputWidth: $("output-width"),
  blockSize: $("block-size"),
  metric: $("metric"),
  solidMode: $("solid-mode"),
  btnRender: $("btn-render"),
  btnReset: $("btn-reset"),

  // Shared output area
  canvasOut: $("canvas-output"),
  canvasPerlin: $("canvas-perlin"),
  animPreview: $("anim-preview"),
  canvasWrap: $("canvas-wrap"),
  hint: $("output-hint"),
  status: $("status"),
  progress: $("progress"),
  progressBar: $("progress-bar"),
  btnDownload: $("btn-download"),
  btnDownloadCsv: $("btn-download-csv"),
  btnDownloadWebm: $("btn-download-webm"),
  paletteGrid: $("palette-grid"),

  // Perlin
  perlin: {
    w: $("perlin-w"), h: $("perlin-h"),
    t: $("perlin-t"), tDisplay: $("perlin-t-display"),
    sx: $("perlin-sx"), sy: $("perlin-sy"), st: $("perlin-st"),
    oct: $("perlin-oct"), pers: $("perlin-pers"), lac: $("perlin-lac"),
    base: $("perlin-base"),
    rs: $("perlin-rs"), gs: $("perlin-gs"), bs: $("perlin-bs"),
    ri: $("perlin-ri"), gi: $("perlin-gi"), bi: $("perlin-bi"),
    frames: $("perlin-frames"), fps: $("perlin-fps"),
    texturize: $("perlin-texturize"),
    btnGen: $("btn-perlin-gen"),
    btnAnim: $("btn-perlin-anim"),
    btnUse: $("btn-perlin-use"),
  },
};

// ===================== UTIL =====================
const $$ = (sel) => document.querySelectorAll(sel);
function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}
function clampFloat(v, lo, hi, fallback) {
  const n = parseFloat(v);
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

function showOutput(which /* "tex" | "perlin" | "anim" | "none" */) {
  els.canvasOut.classList.toggle("ready", which === "tex");
  els.canvasPerlin.classList.toggle("ready", which === "perlin");
  els.animPreview.classList.toggle("ready", which === "anim");
  els.hint.style.display = which === "none" ? "" : "none";
}

// ===================== DROPZONE / IMAGE LOADING =====================
function wireDropzone(dz, fileInput, onLoaded) {
  dz.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadImageFile(f, onLoaded);
  });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const f = e.dataTransfer.files?.[0];
    if (f) loadImageFile(f, onLoaded);
  });
}
function loadImageFile(file, cb) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => cb(img, ev.target.result);
    img.onerror = () => setStatus("Bild konnte nicht geladen werden.", true);
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith("data:") && !url.startsWith("file:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ===================== ATLAS → PALETTE =====================
function buildPalette(atlasImg, tilesPerSide) {
  const aw = atlasImg.naturalWidth;
  const ah = atlasImg.naturalHeight;
  const tileW = Math.floor(aw / tilesPerSide);
  const tileH = Math.floor(ah / tilesPerSide);
  if (tileW < 1 || tileH < 1) {
    throw new Error(`Atlas zu klein für ${tilesPerSide}×${tilesPerSide} Tiles.`);
  }
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = aw;
  atlasCanvas.height = ah;
  const actx = atlasCanvas.getContext("2d", { willReadFrequently: true });
  actx.imageSmoothingEnabled = false;
  actx.drawImage(atlasImg, 0, 0);

  const palette = [];
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const data = actx.getImageData(tx * tileW, ty * tileH, tileW, tileH);
      const avg = averageColor(data);
      if (avg === null) continue;
      const tc = document.createElement("canvas");
      tc.width = tileW; tc.height = tileH;
      tc.getContext("2d").putImageData(data, 0, 0);
      palette.push({ canvas: tc, avg, lab: rgbToLab(avg[0], avg[1], avg[2]), tx, ty });
    }
  }
  if (palette.length === 0) throw new Error("Palette ist leer.");
  return palette;
}
function averageColor(imgData) {
  const { data } = imgData;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (n === 0) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// ===================== COLOR DISTANCE =====================
function distRGB(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}
function distWeighted(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}
function distLab(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}
function rgbToLab(r, g, b) {
  const srgb = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const x = (srgb[0] * 0.4124 + srgb[1] * 0.3576 + srgb[2] * 0.1805) / 0.95047;
  const y = (srgb[0] * 0.2126 + srgb[1] * 0.7152 + srgb[2] * 0.0722) / 1.00000;
  const z = (srgb[0] * 0.0193 + srgb[1] * 0.1192 + srgb[2] * 0.9505) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function pickMetric(name) {
  if (name === "rgb") return { fn: distRGB, useLab: false };
  if (name === "lab") return { fn: distLab, useLab: true };
  return { fn: distWeighted, useLab: false };
}

// ===================== TEXTURIZER (single frame) =====================
function downsampleSource(src, outW, outH) {
  // src kann ein HTMLImageElement, HTMLCanvasElement oder ImageBitmap sein.
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

/**
 * Rendert ein einzelnes Frame: src → Mosaik in `outCanvas`.
 * `texCtx` ist ein vorbereitetes Kontextobjekt (Palette, Distanzmetrik etc.),
 * sodass Animationen das nicht für jedes Frame neu aufbauen müssen.
 */
function renderMosaicFrame(src, outCanvas, texCtx) {
  const { outW, outH, block, palette, palVecs, distFn, useLab, solid } = texCtx;
  const srcData = downsampleSource(src, outW, outH);

  outCanvas.width = outW * block;
  outCanvas.height = outH * block;
  const ctx = outCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 4;
      const r = srcData.data[i], g = srcData.data[i + 1], b = srcData.data[i + 2], a = srcData.data[i + 3];
      if (a < 16) continue;
      const target = useLab ? rgbToLab(r, g, b) : [r, g, b];
      let bestIdx = 0, bestDist = Infinity;
      for (let p = 0; p < palVecs.length; p++) {
        const d = distFn(palVecs[p], target);
        if (d < bestDist) { bestDist = d; bestIdx = p; }
      }
      const chosen = palette[bestIdx];
      if (solid) {
        ctx.fillStyle = `rgb(${chosen.avg[0]},${chosen.avg[1]},${chosen.avg[2]})`;
        ctx.fillRect(x * block, y * block, block, block);
      } else {
        ctx.drawImage(chosen.canvas, x * block, y * block, block, block);
      }
    }
  }
}

function buildTexCtxFromUI() {
  if (!state.atlasImage) throw new Error("Atlas nicht geladen.");
  const tilesPerSide = clampInt(els.atlasTiles.value, 1, 64, 16);
  const outW = clampInt(els.outputWidth.value, 4, 512, 64);
  const block = clampInt(els.blockSize.value, 2, 64, 16);
  const metric = els.metric.value;
  const solid = els.solidMode.checked;

  const palette = buildPalette(state.atlasImage, tilesPerSide);
  state.palette = palette;
  renderPaletteGrid(palette);

  const { fn: distFn, useLab } = pickMetric(metric);
  const palVecs = useLab ? palette.map(p => p.lab) : palette.map(p => p.avg);
  return { outW, outH: 0, block, palette, palVecs, distFn, useLab, solid };
}

async function renderTexturizer() {
  if (!state.inputImage) { setStatus("Bitte erst ein Eingangsbild laden.", true); return; }
  if (!state.atlasImage) { setStatus("Atlas nicht geladen.", true); return; }

  setStatus("Baue Palette …"); await frame();
  const texCtx = buildTexCtxFromUI();
  const inAR = state.inputImage.naturalHeight / state.inputImage.naturalWidth;
  texCtx.outH = Math.max(1, Math.round(texCtx.outW * inAR));

  setStatus(`Rendern (${texCtx.outW}×${texCtx.outH}) …`);
  await frame();
  renderMosaicFrame(state.inputImage, els.canvasOut, texCtx);

  showOutput("tex");
  state.lastOutputCanvas = els.canvasOut;
  els.btnDownload.disabled = false;
  els.btnDownloadCsv.disabled = false;
  setStatus(`Fertig — ${texCtx.outW}×${texCtx.outH} Blöcke, ${texCtx.palette.length} Palette-Einträge.`);
}

function renderPaletteGrid(palette) {
  els.paletteGrid.innerHTML = "";
  for (const p of palette) {
    const div = document.createElement("div");
    div.className = "swatch";
    div.style.backgroundImage = `url(${p.canvas.toDataURL()})`;
    div.title = `rgb(${p.avg.join(",")})`;
    els.paletteGrid.appendChild(div);
  }
}

// ===================== PERLIN =====================
function readPerlinParams() {
  const p = els.perlin;
  return {
    width:      clampInt(p.w.value, 4, 1024, 256),
    height:     clampInt(p.h.value, 4, 1024, 256),
    t:          clampFloat(p.t.value, -1e9, 1e9, 0),
    scaleX:     clampFloat(p.sx.value, 0.0001, 10, 0.02),
    scaleY:     clampFloat(p.sy.value, 0.0001, 10, 0.02),
    scaleT:     clampFloat(p.st.value, 0, 10, 0.5),
    octaves:    clampInt(p.oct.value, 1, 10, 6),
    persistence:clampFloat(p.pers.value, 0, 2, 0.5),
    lacunarity: clampFloat(p.lac.value, 1, 8, 2.0),
    base:       parseInt(p.base.value, 10) || 0,
    rScale:     clampFloat(p.rs.value, 0, 4, 0),
    gScale:     clampFloat(p.gs.value, 0, 4, 1),
    bScale:     clampFloat(p.bs.value, 0, 4, 0),
    rInvert:    p.ri.checked,
    gInvert:    p.gi.checked,
    bInvert:    p.bi.checked,
  };
}

function renderPerlinFrame(params, canvas) {
  canvas.width = params.width;
  canvas.height = params.height;
  const ctx = canvas.getContext("2d");
  window.MTPerlin.generatePerlinImage(params, ctx);
}

async function renderPerlinStandalone() {
  if (!window.MTPerlin) { setStatus("Perlin-Modul nicht geladen.", true); return; }
  const params = readPerlinParams();
  setStatus(`Generiere Perlin-Bild (${params.width}×${params.height}) …`);
  await frame();
  renderPerlinFrame(params, els.canvasPerlin);
  showOutput("perlin");
  state.lastOutputCanvas = els.canvasPerlin;
  els.btnDownload.disabled = false;
  setStatus(`Perlin-Standbild fertig (t=${params.t.toFixed(2)}).`);
}

function updateTDisplay() {
  els.perlin.tDisplay.textContent = parseFloat(els.perlin.t.value).toFixed(2);
}

// Live-Preview: t-Slider rendert nach kurzem Debounce in canvas-perlin.
function schedulePerlinLivePreview() {
  if (state.mode !== "perlin") return;
  clearTimeout(state.livePreviewTimer);
  state.livePreviewTimer = setTimeout(() => {
    try {
      const params = readPerlinParams();
      renderPerlinFrame(params, els.canvasPerlin);
      showOutput("perlin");
      state.lastOutputCanvas = els.canvasPerlin;
      els.btnDownload.disabled = false;
      setStatus(`Live-Vorschau (t=${params.t.toFixed(2)}).`);
    } catch (e) { /* still typing */ }
  }, 30);
}

function usePerlinAsTextureInput() {
  const c = els.canvasPerlin;
  if (!c.width || !c.height) {
    setStatus("Erst ein Perlin-Bild generieren.", true);
    return;
  }
  const dataUrl = c.toDataURL("image/png");
  const img = new Image();
  img.onload = () => {
    state.inputImage = img;
    els.previewImage.src = dataUrl;
    els.dzImage.classList.add("has-image");
    maybeEnableRender();
    setStatus("Perlin-Bild als Eingang gesetzt — wechsle zum Texturizer-Tab.");
    switchMode("texturize");
  };
  img.src = dataUrl;
}

// ===================== ANIMATION (WebM) =====================

function chooseRecorderMime() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

async function recordAnimation() {
  if (state.animating) return;
  if (!window.MTPerlin) { setStatus("Perlin-Modul nicht geladen.", true); return; }
  const mime = chooseRecorderMime();
  if (!mime) {
    setStatus("Dein Browser unterstützt keinen WebM-Recorder.", true);
    return;
  }

  const params = readPerlinParams();
  const frames = clampInt(els.perlin.frames.value, 1, 600, 120);
  const fps = clampInt(els.perlin.fps.value, 1, 60, 24);
  const texturize = els.perlin.texturize.checked;

  let texCtx = null;
  let recordCanvas;     // das Canvas, das aufgenommen wird
  let drawCanvas;       // das Canvas, in das per Frame gemalt wird (≠ recordCanvas bei Skalierung)

  // Recorded-canvas vorbereiten
  if (texturize) {
    if (!state.atlasImage) { setStatus("Atlas fehlt — Animation abgebrochen.", true); return; }
    setStatus("Baue Atlas-Palette …"); await frame();
    texCtx = buildTexCtxFromUI();
    texCtx.outH = Math.max(1, Math.round(texCtx.outW * (params.height / params.width)));
    recordCanvas = els.canvasOut;
    recordCanvas.width = texCtx.outW * texCtx.block;
    recordCanvas.height = texCtx.outH * texCtx.block;
    drawCanvas = recordCanvas;
    showOutput("tex");
  } else {
    recordCanvas = els.canvasPerlin;
    recordCanvas.width = params.width;
    recordCanvas.height = params.height;
    drawCanvas = recordCanvas;
    showOutput("perlin");
  }

  // captureStream(0) + manuelles requestFrame() ist robuster als Polling-FPS,
  // weil wir den Stream exakt mit unseren gemalten Frames syncen können.
  // Fallback: captureStream(fps) mit Sleep-Loop.
  const stream = recordCanvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];
  const canRequestFrame = videoTrack && typeof videoTrack.requestFrame === "function";
  const fallbackStream = canRequestFrame ? null : recordCanvas.captureStream(fps);
  const finalStream = canRequestFrame ? stream : fallbackStream;

  const recorder = new MediaRecorder(finalStream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();
  state.animating = true;
  els.perlin.btnAnim.disabled = true;
  setProgress(0);

  const frameDelayMs = 1000 / fps;
  // Perlin-Frame in Zwischen-Canvas malen, dann (optional) durch Texturizer ins draw-Canvas.
  const perlinFrame = document.createElement("canvas");
  perlinFrame.width = params.width;
  perlinFrame.height = params.height;

  try {
    for (let i = 0; i < frames; i++) {
      const tStart = performance.now();
      const localParams = { ...params, t: params.t + i };
      window.MTPerlin.generatePerlinImage(localParams, perlinFrame.getContext("2d"));

      if (texturize) {
        renderMosaicFrame(perlinFrame, drawCanvas, texCtx);
      } else {
        const dctx = drawCanvas.getContext("2d");
        dctx.imageSmoothingEnabled = false;
        dctx.drawImage(perlinFrame, 0, 0);
      }

      // Frame an den Recorder pushen.
      if (canRequestFrame) videoTrack.requestFrame();

      const pct = Math.round(((i + 1) / frames) * 100);
      setStatus(`Frame ${i + 1}/${frames}${texturize ? " (texturisiert)" : ""}`);
      setProgress(pct);

      // Mindestabstand zwischen Frames sicherstellen — Browser können sonst Frames droppen.
      const elapsed = performance.now() - tStart;
      const wait = Math.max(0, frameDelayMs - elapsed);
      await sleep(wait);
    }
    // Letztes Frame nochmal anstoßen, damit der Recorder es definitiv aufnimmt.
    if (canRequestFrame) videoTrack.requestFrame();
    await sleep(frameDelayMs);
  } finally {
    recorder.stop();
    await done;
    state.animating = false;
    els.perlin.btnAnim.disabled = false;
    setProgress(null);
  }

  const blob = new Blob(chunks, { type: mime });
  state.lastWebmBlob = blob;
  const url = URL.createObjectURL(blob);
  els.animPreview.src = url;
  els.animPreview.load();
  showOutput("anim");
  els.btnDownloadWebm.hidden = false;
  els.btnDownloadWebm.disabled = false;
  setStatus(
    `Animation fertig — ${frames} Frames @ ${fps} fps, ${(blob.size / 1024).toFixed(1)} KB, ${mime}.`
  );
}

// ===================== TAB SWITCH =====================
function switchMode(mode) {
  state.mode = mode;
  for (const t of els.tabs) {
    const active = t.dataset.mode === mode;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  }
  els.panelTex.classList.toggle("active", mode === "texturize");
  els.panelPerlin.classList.toggle("active", mode === "perlin");

  if (mode === "texturize") {
    els.modeSubtitle.textContent =
      "Verwandle ein beliebiges Bild in ein Mosaik aus Minecraft-Texturen — komplett im Browser.";
    els.outputTitle.textContent = "Ergebnis";
  } else {
    els.modeSubtitle.textContent =
      "Generiere parametrisches 3D-Perlin-Rauschen, exportiere als PNG oder WebM-Animation — optional durch den Texturizer.";
    els.outputTitle.textContent = "Perlin-Vorschau";
    // Beim ersten Wechsel sofort eine Vorschau zeigen.
    if (!els.canvasPerlin.width) schedulePerlinLivePreview();
  }
}

// ===================== INIT / EVENTS =====================
function maybeEnableRender() {
  els.btnRender.disabled = !(state.inputImage && state.atlasImage);
}

// Dropzones
wireDropzone(els.dzImage, els.fileImage, (img, dataUrl) => {
  state.inputImage = img;
  els.previewImage.src = dataUrl;
  els.dzImage.classList.add("has-image");
  maybeEnableRender();
  setStatus(`Eingangsbild: ${img.naturalWidth}×${img.naturalHeight}px geladen.`);
});
wireDropzone(els.dzAtlas, els.fileAtlas, (img, dataUrl) => {
  state.atlasImage = img;
  els.previewAtlas.src = dataUrl;
  els.dzAtlas.classList.add("has-image");
  maybeEnableRender();
  setStatus(`Atlas: ${img.naturalWidth}×${img.naturalHeight}px geladen.`);
});

// Texturizer-Buttons
els.btnRender.addEventListener("click", () => {
  renderTexturizer().catch((err) => {
    console.error(err);
    setStatus(`Fehler: ${err.message}`, true);
  });
});
els.btnReset.addEventListener("click", () => {
  state.inputImage = null;
  state.lastOutputCanvas = null;
  els.previewImage.src = "";
  els.dzImage.classList.remove("has-image");
  els.canvasOut.width = 0; els.canvasOut.height = 0;
  showOutput("none");
  els.btnDownload.disabled = true;
  els.btnDownloadCsv.disabled = true;
  setStatus("");
  maybeEnableRender();
});

// Downloads
els.btnDownload.addEventListener("click", () => {
  const c = state.lastOutputCanvas;
  if (!c) return;
  const a = document.createElement("a");
  a.download = state.mode === "perlin" ? "perlin.png" : "minecraft-mosaic.png";
  a.href = c.toDataURL("image/png");
  a.click();
});
els.btnDownloadCsv.addEventListener("click", () => {
  if (!state.palette) return;
  const rows = [["tx", "ty", "red", "green", "blue", "hex"]];
  for (const p of state.palette) {
    const [r, g, b] = p.avg;
    const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
    rows.push([p.tx, p.ty, r, g, b, hex]);
  }
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.download = "palette.csv";
  a.href = URL.createObjectURL(blob);
  a.click();
});
els.btnDownloadWebm.addEventListener("click", () => {
  if (!state.lastWebmBlob) return;
  const a = document.createElement("a");
  a.download = "perlin-animation.webm";
  a.href = URL.createObjectURL(state.lastWebmBlob);
  a.click();
});

// Tabs
for (const t of els.tabs) {
  t.addEventListener("click", () => switchMode(t.dataset.mode));
}
$$('a[data-jump-to]').forEach(a => {
  a.addEventListener("click", (e) => { e.preventDefault(); switchMode(a.dataset.jumpTo); });
});

// Perlin events
els.perlin.btnGen.addEventListener("click", () => {
  renderPerlinStandalone().catch(err => setStatus(`Perlin-Fehler: ${err.message}`, true));
});
els.perlin.btnAnim.addEventListener("click", () => {
  recordAnimation().catch(err => {
    console.error(err);
    setStatus(`Animation-Fehler: ${err.message}`, true);
    state.animating = false;
    els.perlin.btnAnim.disabled = false;
    setProgress(null);
  });
});
els.perlin.btnUse.addEventListener("click", usePerlinAsTextureInput);

// Live-Preview-Trigger: alle Perlin-Inputs lösen schedulePerlinLivePreview aus.
const liveInputs = [
  els.perlin.w, els.perlin.h, els.perlin.sx, els.perlin.sy, els.perlin.st,
  els.perlin.oct, els.perlin.pers, els.perlin.lac, els.perlin.base,
  els.perlin.rs, els.perlin.gs, els.perlin.bs,
  els.perlin.ri, els.perlin.gi, els.perlin.bi,
];
for (const inp of liveInputs) inp.addEventListener("input", schedulePerlinLivePreview);
els.perlin.t.addEventListener("input", () => { updateTDisplay(); schedulePerlinLivePreview(); });
updateTDisplay();

// Default-Atlas laden
(async () => {
  let img;
  let usedFallback = false;
  try {
    img = await loadImageFromUrl(DEFAULT_ATLAS_URL);
  } catch {
    try {
      img = await loadImageFromUrl(DEFAULT_ATLAS_DATA_URL);
      usedFallback = true;
    } catch {
      setStatus("Default-Atlas konnte nicht geladen werden — bitte eigenen Atlas hochladen.", true);
      return;
    }
  }
  state.atlasImage = img;
  els.previewAtlas.src = img.src;
  els.dzAtlas.classList.add("has-image");
  maybeEnableRender();
  setStatus(
    `Default-Atlas geladen (${img.naturalWidth}×${img.naturalHeight}px${usedFallback ? ", inline-Fallback" : ""}).`
  );
})();
