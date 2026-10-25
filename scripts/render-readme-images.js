// Renders the README showcase images (assets/hero.png + gallery-*.png) from
// the ACTUAL built-in presets (perlin-presets.js) through the full render
// pipeline (perlin.js generatePerlinImage — domain warp, layer 2, flow,
// posterize and per-channel noise all supported). PNG encoding is pure Node
// (zlib + crc32), no external dependencies.
//
//   node scripts/render-readme-images.js
//
// Writes into assets/ — overwrites existing PNGs.
"use strict";

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const { spawnSync } = require("child_process");

// perlin.js + perlin-presets.js export via window.* — build the sandbox as in
// AGENTS.md so the renderer uses the real presets with no duplicated data.
const REPO = path.resolve(__dirname, "..");
global.window = {};
require(path.join(REPO, "perlin.js"));
require(path.join(REPO, "perlin-presets.js"));
const { generatePerlinImage } = global.window.MTPerlin;
const { BUILTIN_PRESETS, resolveParams } = global.window.MTPerlinPresets;

// Headless 2D-context shim: generatePerlinImage only needs createImageData +
// putImageData — no canvas, no deps (same trick as scripts/smoke-test.js).
// Returns a packed RGB buffer (alpha dropped; presets don't use the mask).
function renderRGB(params) {
  const ctx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    _img: null,
    putImageData(img) { this._img = img; },
  };
  generatePerlinImage(params, ctx);
  const rgba = ctx._img.data;
  const rgb = Buffer.alloc(params.width * params.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
  }
  return rgb;
}

// A single still frame from a named preset at a chosen loop position + size.
function presetFrame(name, width, height, loopProgress) {
  const preset = BUILTIN_PRESETS[name];
  if (!preset) throw new Error("unknown preset: " + name);
  return renderRGB(resolveParams({ ...preset, width, height, loop: true, loopProgress }));
}

// ---------- PNG encoder (pure Node) ----------
// CRC32 table per the PNG spec (Annex D, IEEE 802.3 polynomial).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgb) {
  // IHDR: width, height, bit depth=8, colour type=2 (RGB), no interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // Prefix each scanline with filter byte 0 (None).
  const stride = width * 3;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgb.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered, { level: 9 });

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Render jobs ----------
// Hero is the iconic Lava fire; the gallery shows the range of colour modes /
// features: HSV (aurora), per-channel RGB (nebula), domain warp (marble),
// flow field (flow), Layer 2 composite, and posterize (terrain).
// Gallery: 560 px = 2x the 280 px README cell (readme_lint assumes dpr 2), the
// largest size at which the high-entropy presets (flow, nebula) still fit the
// 400 KB PNG budget (readme-spec images.budget.png_kb) after oxipng. Hero:
// 1200x630 is the og:image size (index.html) and stays there, so at ~560 KB it
// is a known budget exception. Don't raise any size without re-measuring.
const ASSETS = path.join(REPO, "assets");
const JOBS = [
  { out: "hero.png",              preset: "lava",      width: 1200, height: 630, loopProgress: 0.42 },
  { out: "gallery-aurora.png",    preset: "aurora",    width: 560,  height: 373, loopProgress: 0.27 },
  { out: "gallery-nebula.png",    preset: "nebula",    width: 560,  height: 373, loopProgress: 0.55 },
  { out: "gallery-marble.png",    preset: "marble",    width: 560,  height: 373, loopProgress: 0.33 },
  { out: "gallery-flow.png",      preset: "flow",      width: 560,  height: 373, loopProgress: 0.18 },
  { out: "gallery-composite.png", preset: "composite", width: 560,  height: 373, loopProgress: 0.60 },
  { out: "gallery-terrain.png",   preset: "terrain",   width: 560,  height: 373, loopProgress: 0.50 },
];

if (!fs.existsSync(ASSETS)) {
  console.error("assets/ not found:", ASSETS);
  process.exit(1);
}

// Lossless recompression. The hand-rolled encoder above is deliberately
// simple (zlib only), so oxipng saves 30-50 % on top without touching a pixel.
// Optional: without it the images are valid but may exceed the PNG budget.
function optimize(file) {
  const r = spawnSync("oxipng", ["-o", "max", "-Z", "--strip", "all", "-q", file]);
  if (r.error && r.error.code === "ENOENT") {
    console.warn("  ! oxipng not on PATH (brew install oxipng) — image left unoptimized");
    return false;
  }
  return r.status === 0;
}

for (const job of JOBS) {
  const t0 = Date.now();
  const rgb = presetFrame(job.preset, job.width, job.height, job.loopProgress);
  const png = encodePng(job.width, job.height, rgb);
  const file = path.join(ASSETS, job.out);
  fs.writeFileSync(file, png);
  optimize(file);
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`✓ ${job.out.padEnd(24)} ${job.preset.padEnd(10)} ${job.width}×${job.height}  ${kb} KB  ${Date.now() - t0} ms`);
}
console.log("all images written →", ASSETS);
