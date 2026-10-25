// Parity gate for the GPU renderer (perlin-gl.js): renders each case on the CPU
// path (perlin.js generatePerlinImage) and on the GPU path in a real browser and
// compares the pixels.
//
//   node scripts/check-gl-parity.mjs            # needs Playwright and a WebGL2 browser
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/check-gl-parity.mjs
//
// Not part of the deploy gates: it needs a browser (zero-dependency repo), so it is
// run by hand after touching perlin-gl.js or the maths in perlin.js. Exit 0 = pass,
// 1 = a case differs or a control did not fail, 2 = skipped (no Playwright / no WebGL2).
//
// Why a tolerance and not equality: the CPU path is float64, the shader float32, and
// the colour is rounded once on each side. Pixels whose noise value lands next to a
// rounding edge can differ by one level; anything beyond that is a bug.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright"];
  for (const name of fs.readdirSync(path.join(root, ".."))) {
    candidates.push(path.join(root, "..", name, "node_modules", "playwright"));
  }
  for (const c of candidates) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* try the next one */ }
  }
  return null;
}

// Per-case tolerance: at most MAX_LEVEL difference in any channel, and at most
// MAX_FRAC of channel values off by more than one level.
const MAX_LEVEL = 2;
const MAX_FRAC = 0.0005;

const base = {
  width: 192, height: 128, scaleX: 0.02, scaleY: 0.02, scaleT: 0.15, base: 0,
  octaves: 6, persistence: 0.5, lacunarity: 2, colorMode: "rgb",
  rScale: 0, gScale: 1, bScale: 0, t: 1.3, loop: false, loopProgress: 0, loopRadius: 1,
};
const cases = [
  ["linear, rgb green", {}],
  ["linear, negative t, negative seed", { t: -35.2, base: -3 }],
  ["linear, rgb with scales and inverts", { rScale: 1, gScale: 0.6, bScale: 2, rInvert: true, bInvert: true }],
  ["loop 0.37, gradient viridis", { loop: true, loopProgress: 0.37, colorMode: "gradient", gradient: "viridis", base: 7 }],
  ["loop, radius 2.5, scaleT 0.4", { loop: true, loopProgress: 0.81, loopRadius: 2.5, scaleT: 0.4, colorMode: "gradient", gradient: "magma" }],
  ["loop + warp", { loop: true, loopProgress: 0.2, warpStrength: 2, warpScale: 1.7, colorMode: "gradient", gradient: "viridis" }],
  ["linear + warp", { warpStrength: 3, warpScale: 0.6 }],
  ["tile 4x3, linear", { tileX: 4, tileY: 3, scaleX: 0.25, scaleY: 0.25 }],
  ["tile 4x3 + warp (scale rounds to 2)", { tileX: 4, tileY: 3, scaleX: 0.25, scaleY: 0.25, warpStrength: 1.5, warpScale: 1.6 }],
  ["tile, loop, non-integer lacunarity", { tileX: 2, tileY: 2, loop: true, loopProgress: 0.6, lacunarity: 2.3, scaleX: 0.1, scaleY: 0.1 }],
  ["hsv", { colorMode: "hsv", hsvHueShift: 0.3, hsvHueRange: 0.6, hsvSat: 0.8, hsvVal: 1 }],
  // A posterize band edge is a step function: a pixel whose noise value sits within float32
  // rounding of an edge may land in the neighbouring band (a large jump, on a handful of
  // pixels). The case therefore passes only if every such pixel really is at a band edge.
  ["cosine rainbow, linear", { colorMode: "cosine", cosineName: "rainbow" }],
  ["cosine neon (c = 2, 1, 0), loop", { colorMode: "cosine", cosineName: "neon", loop: true, loopProgress: 0.3 }],
  ["cosine coral with layer 2", { colorMode: "cosine", cosineName: "coral", layer2On: true, layer2Mix: 0.5, layer2Base: 3, layer2ScaleX: 0.07, layer2ScaleY: 0.07 }],
  ["cosine custom parameters", { colorMode: "cosine", cosine: { a: [0.2, 0.6, 0.9], b: [0.8, 0.3, 0.1], c: [3.0, 0.5, 1.5], d: [-0.4, 0.7, 0.05] } }],
  ["relief, linear, default light", { reliefOn: true, reliefGain: 4, colorMode: "gradient", gradient: "viridis" }],
  ["relief, loop + warp, low sun, no ambient", { reliefOn: true, reliefGain: 6, lightAzimuth: 40, lightElevation: 12, reliefAmbient: 0, loop: true, loopProgress: 0.55, warpStrength: 1.5, colorMode: "cosine", cosineName: "dusk" }],
  ["relief, layer 2 + tile", { reliefOn: true, reliefGain: 3, layer2On: true, layer2Mix: 0.5, layer2Base: 9, layer2ScaleX: 0.5, layer2ScaleY: 0.5, tileX: 4, tileY: 3, scaleX: 0.25, scaleY: 0.25 }],
  ["relief, strong highlight, rgb", { reliefOn: true, reliefGain: 10, reliefSpec: 1, reliefShine: 8, lightElevation: 70, rScale: 1, gScale: 0.8, bScale: 0.6 }],
  ["relief, hsv, wide stencil", { reliefOn: true, reliefGain: 2, reliefEps: 2.5, colorMode: "hsv", hsvHueShift: 0.1, hsvHueRange: 0.5, hsvSat: 0.7, hsvVal: 0.9 }],
  ["posterize 5, linear", { colorMode: "posterize", posterizeSteps: 5, gradient: "viridis" }, { bandEdges: true }],
  ["high octaves, large scale", { octaves: 10, scaleX: 1.7, scaleY: 1.7, persistence: 0.6 }],
  ...["multiply", "add", "screen", "darken", "lighten", "difference"].map((m) => [
    "layer 2 " + m,
    { layer2On: true, layer2BlendMode: m, layer2Mix: 0.6, layer2Base: 5, layer2ScaleX: 0.06, layer2ScaleY: 0.05, layer2Octaves: 4, loop: true, loopProgress: 0.45, colorMode: "gradient", gradient: "magma" },
  ]),
];

const pw = loadPlaywright();
if (!pw) { console.log("SKIP: Playwright not found (set PLAYWRIGHT_PATH)"); process.exit(2); }

const browser = await pw.chromium.launch({
  args: process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("about:blank");
await page.addScriptTag({ path: path.join(root, "perlin.js") });
await page.addScriptTag({ path: path.join(root, "perlin-presets.js") });
await page.addScriptTag({ path: path.join(root, "perlin-gl.js") });

const out = await page.evaluate(async ({ cases, base, MAX_LEVEL, MAX_FRAC }) => {
  if (!window.MTPerlinGL.isAvailable()) return { skip: "no WebGL2" };
  const G = window.MTPerlinPresets.GRADIENTS;
  const gl = window.MTPerlinGL.createRenderer();
  if (!gl) return { skip: "renderer could not be created" };
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c.getContext("2d", { willReadFrequently: true }); };

  function both(params) {
    const p = Object.assign({}, base, params);
    if (typeof p.gradient === "string") p.gradient = G[p.gradient];
    if (p.colorMode === "cosine" && !p.cosine) p.cosine = window.MTPerlinPresets.COSINE_PALETTES[p.cosineName];
    const cpu = mk(p.width, p.height), gpu = mk(p.width, p.height);
    window.MTPerlin.generatePerlinImage(p, cpu);
    const supported = gl.supports(p);
    if (supported) gl.render(p, gpu);
    return { p, supported, a: cpu.getImageData(0, 0, p.width, p.height).data, b: gpu.getImageData(0, 0, p.width, p.height).data };
  }
  function diff(a, b) {
    let max = 0, sum = 0, over1 = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      if (d > 1) over1++;
    }
    return { max, mean: sum / a.length, frac: over1 / a.length };
  }

  // The CPU path exists twice (main thread and the worker's string copy); they must agree bytewise.
  function viaWorker(p) {
    return new Promise((resolve, reject) => {
      const w = new Worker(URL.createObjectURL(new Blob([window.MTPerlin.WORKER_SOURCE], { type: "application/javascript" })));
      w.onmessage = (e) => { w.terminate(); resolve(new Uint8ClampedArray(e.data.buffer)); };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
      w.postMessage({ id: 1, params: p });
    });
  }

  const rows = [];
  const workerMismatch = [];
  for (const [name, params, opts] of cases) {
    const r = both(params);
    const wbuf = await viaWorker(r.p);
    for (let i = 0; i < wbuf.length; i++) { if (wbuf[i] !== r.a[i]) { workerMismatch.push(name); break; } }
    if (!r.supported) { rows.push({ name, ok: false, note: "not supported by the GPU renderer" }); continue; }
    const d = diff(r.a, r.b);
    // Relief lighting scales the (already rounded) base colour by a shade of up to 1 / flat, where
    // flat is the shade of a flat surface; a base colour that rounds one level apart on the two
    // paths (float32 against float64) therefore shows up to ceil(1 / flat) + 1 levels apart. Low
    // sun and no ambient light is the extreme (measured: max 5 at 12 degrees, 0 ambient, and none
    // of the pixels differ without warp, or at default light, or at gain 0).
    let lim = MAX_LEVEL;
    if (r.p.reliefOn) {
      const amb = r.p.reliefAmbient != null ? r.p.reliefAmbient : 0.35;
      const el = (r.p.lightElevation != null ? r.p.lightElevation : 45) * Math.PI / 180;
      lim = Math.max(MAX_LEVEL, Math.ceil(1 / Math.max(1e-3, amb + (1 - amb) * Math.sin(el))) + 1);
    }
    let ok = d.max <= lim && d.frac <= MAX_FRAC;
    let note = "";
    if (!ok && opts && opts.bandEdges && !r.p.loop) {
      // Every pixel that differs by more than the tolerance must sit within 1e-4 of a band edge.
      const perm = window.MTPerlin.makePermutation(r.p.base);
      const steps = Math.max(2, r.p.posterizeSteps || 5);
      let bad = 0, edge = 0;
      for (let i = 0; i < r.a.length; i += 4) {
        const off = Math.max(Math.abs(r.a[i] - r.b[i]), Math.abs(r.a[i + 1] - r.b[i + 1]), Math.abs(r.a[i + 2] - r.b[i + 2]));
        if (off <= MAX_LEVEL) continue;
        const x = (i / 4) % r.p.width, y = Math.floor(i / 4 / r.p.width);
        const n = window.MTPerlin.warpedFbm3
          ? window.MTPerlin.warpedFbm3(perm, x * r.p.scaleX, y * r.p.scaleY, r.p.t * r.p.scaleT, r.p.octaves, r.p.persistence, r.p.lacunarity, 0, 1, 0, 0)
          : window.MTPerlin.fbm3(perm, x * r.p.scaleX, y * r.p.scaleY, r.p.t * r.p.scaleT, r.p.octaves, r.p.persistence, r.p.lacunarity);
        const dist = Math.abs(n * steps - Math.round(n * steps));
        if (dist < 1e-4) edge++; else bad++;
      }
      ok = bad === 0 && edge <= 8;
      note = `, ${edge} pixel(s) at a band edge, ${bad} elsewhere`;
    }
    rows.push({ name, ...d, ok, note });
  }

  // Negative control: a different seed on the GPU must NOT match the CPU image, or the
  // comparison above could not have failed in the first place.
  const ctl = both({ base: 0 });
  const other = mk(ctl.p.width, ctl.p.height);
  gl.render(Object.assign({}, ctl.p, { base: 1 }), other);
  const cd = diff(ctl.a, other.getImageData(0, 0, ctl.p.width, ctl.p.height).data);
  // The passing cases above sit at mean < 0.001; a different seed lands at ~5. Anything over 1
  // shows the comparison can tell two images apart.
  const control = { name: "control: seed 1 on GPU vs seed 0 on CPU (must differ)", ...cd, ok: cd.mean > 1 && cd.frac > 0.05 };

  // Loop closure on the GPU: progress 1 must be bytewise progress 0 (CPU guarantee).
  const g0 = mk(192, 128), g1 = mk(192, 128);
  const lp = Object.assign({}, base, { loop: true, colorMode: "gradient", gradient: G.viridis });
  gl.render(Object.assign({}, lp, { loopProgress: 0 }), g0);
  gl.render(Object.assign({}, lp, { loopProgress: 1 }), g1);
  const cl = diff(g0.getImageData(0, 0, 192, 128).data, g1.getImageData(0, 0, 192, 128).data);
  const closure = { name: "GPU loop closure, progress 1 vs 0 (must be bytewise equal)", ...cl, ok: cl.max === 0 };

  // Unsupported modes must be reported as such (the engine then uses the CPU path).
  const fallbacks = [
    ["flow", { colorMode: "flow" }],
    ["rgb multi-channel", { rgbMultiChannel: true }],
    ["gradient with 17 stops", { colorMode: "gradient", gradient: Array.from({ length: 17 }, (_, i) => ({ pos: i / 16, color: [i * 15, 0, 0] })) }],
  ].map(([name, params]) => ({ name: "falls back: " + name, ok: gl.supports(Object.assign({}, base, params)) === false }));

  const workerRow = { name: "worker copy equals main-thread CPU path (bytewise)" + (workerMismatch.length ? ": " + workerMismatch.join("; ") : ` in all ${cases.length} cases`), ok: workerMismatch.length === 0 };

  return { rows: rows.concat([control, closure, workerRow], fallbacks), renderer: (() => {
    const c = document.createElement("canvas").getContext("webgl2"); const e = c.getExtension("WEBGL_debug_renderer_info");
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown";
  })() };
}, { cases, base, MAX_LEVEL, MAX_FRAC });

await browser.close();
if (out.skip) { console.log("SKIP: " + out.skip); process.exit(2); }

console.log("renderer: " + out.renderer);
let failed = 0;
for (const r of out.rows) {
  const stats = r.max === undefined ? (r.note || "") : `max ${r.max}, mean ${r.mean.toFixed(4)}, >1 level ${(r.frac * 100).toFixed(4)}%${r.note || ""}`;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  ${stats}`);
  if (!r.ok) failed++;
}
console.log(failed ? `${failed} case(s) failed` : `all ${out.rows.length} checks passed`);
process.exit(failed ? 1 : 0);
